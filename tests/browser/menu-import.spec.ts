import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { addProduct, createTableOrder, signIn, tab } from './flows'

const menu = {
  categories: [{ name: 'Бариста QA' }],
  products: [{ name: 'Чай QA', category: 'Бариста QA', price: 120 }],
}

test('импорт меню скачивает задание для ИИ, проверяет JSON и пропускает дубликаты', async ({ page, context }, testInfo) => {
  await signIn(page, 'admin', false)
  await tab(page, 'Каталог')
  await page.getByRole('button', { name: 'Импорт меню', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Импорт меню', exact: true })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    form.getByRole('link', { name: 'Скачать инструкцию для ИИ', exact: true }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.txt$/i)
  expect(await readFile(await download.path(), 'utf8')).toMatch(/вкладкой каталога/)
  await form.getByRole('button', { name: 'Открыть текст инструкции' }).click()
  await expect(form.getByLabel('Текст инструкции для ИИ')).toHaveValue(/вкладкой каталога/)
  await form.getByRole('button', { name: 'Скрыть текст инструкции' }).click()

  const input = form.getByLabel('JSON меню', { exact: true })
  const check = form.getByRole('button', { name: 'Проверить меню', exact: true })
  const apply = form.getByRole('button', { name: 'Импортировать', exact: true })
  await input.fill('{broken')
  await check.click()
  await expect(form.getByRole('alert')).toBeVisible()

  await input.fill(JSON.stringify(menu))
  await check.click()
  await expect(apply).toBeEnabled()
  if (process.env.VISUAL_CHECK && testInfo.project.name === 'chromium-mobile') {
    await page.screenshot({ path: 'docs/screenshots/390x844/admin-03b-menu-import.png', animations: 'disabled', scale: 'css' })
  }
  await apply.click()
  await expect(form.getByRole('status').filter({ hasText: 'Меню добавлено' })).toBeVisible()

  const changedPrice = { ...menu, products: [{ name: ' чай   qa ', category: ' бариста   QA ', price: 930 }] }
  await input.fill(JSON.stringify(changedPrice))
  await check.click()
  await expect(form.getByText('Пропущено', { exact: true }).locator('..').locator('strong')).toHaveText('1')
  await expect(form.getByText(/уже есть в каталоге/)).toBeVisible()
  await expect(apply).toBeDisabled()
  await form.getByRole('button', { name: 'Закрыть', exact: true }).click()
  const row = page.getByRole('button', { name: /Чай QA/ })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(/120\s*₽/)

  const waiter = await context.newPage()
  await signIn(waiter, 'Паша', false)
  await createTableOrder(waiter, 12)
  await addProduct(waiter, 'Чай QA')
  await expect(waiter.getByRole('button', { name: /Чай QA.*120\s*₽/ })).toBeVisible()
})
