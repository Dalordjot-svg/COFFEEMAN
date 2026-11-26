import { expect, test, type Page } from '@playwright/test'
import { createTableOrder, signIn, tab } from './flows'

async function signOut(page: Page) {
  await tab(page, 'Профиль')
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByLabel('Имя сотрудника')).toBeVisible()
}

test('вкладки повторно используют профиль по имени и независимо показывают присутствие', async ({ page, context }) => {
  const observer = await context.newPage()
  await signIn(observer, 'admin', false)
  await tab(observer, 'Сотрудники')

  const employee = observer.getByRole('button', { name: /Марина Соколова/i })
  await expect(employee).toHaveCount(0)
  await signIn(page, 'Марина Соколова', false)
  await expect(employee).toContainText('В сети')

  const second = await context.newPage()
  await signIn(second, '  марина   соколова  ', false)
  await expect(employee).toHaveCount(1)
  await createTableOrder(page, 12)
  await tab(second, 'Заказы')
  await expect(second.getByRole('button', { name: 'Мои', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(second.getByRole('button', { name: /^Стол 12 / })).toBeVisible()

  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Выберите стол', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await signOut(page)
  await observer.reload()
  await tab(observer, 'Сотрудники')
  await expect(employee).toContainText('В сети')

  await signOut(second)
  await expect(employee).toContainText('Не в сети')
})
