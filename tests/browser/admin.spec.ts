import { expect, test, type Page } from '@playwright/test'
import { signIn, tab } from './flows'

async function submitDialog(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

async function createProduct(page: Page, name: string, category: string, imageUrl?: string) {
  await page.getByRole('button', { name: 'Добавить товар', exact: true }).click()
  const form = page.getByRole('dialog')
  await form.getByLabel('Название', { exact: true }).fill(name)
  await form.getByLabel('Категория', { exact: true }).selectOption({ label: category })
  await form.getByLabel('Цена, ₽', { exact: true }).fill('125')
  if (imageUrl) await form.getByLabel('Фотография (URL)', { exact: true }).fill(imageUrl)
  await submitDialog(page)
  return page.getByRole('button', { name: new RegExp(name) })
}

test('административная панель, категории, товары, фото и план зала', async ({ page }) => {
  await signIn(page, 'admin')
  const photoUrl = new URL('icons/icon-192.png', page.url()).href
  await expect(page.getByRole('heading', { name: 'Управление' })).toBeVisible()
  await tab(page, 'Каталог')
  await page.getByRole('button', { name: 'Категории', exact: true }).click()
  await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Название', { exact: true }).fill('Сезонные напитки')
  await submitDialog(page)
  await expect(page.getByRole('button', { name: /Сезонные напитки/ })).toBeVisible()

  await page.getByRole('button', { name: 'Товары', exact: true }).click()
  const withoutPhoto = await createProduct(page, 'Фильтр кофе', 'Сезонные напитки')
  await expect(withoutPhoto.getByRole('img', { name: 'Нет изображения' })).toBeVisible()
  const withPhoto = await createProduct(page, 'Цитрусовый раф', 'Сезонные напитки', photoUrl)
  await withPhoto.scrollIntoViewIfNeeded()
  await expect(withPhoto.locator('img')).toHaveAttribute('src', photoUrl)
  await expect.poll(() => withPhoto.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(192)

  await tab(page, 'Залы')
  await page.getByRole('button', { name: 'Добавить зал', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Название', { exact: true }).fill('Крытая терраса')
  await submitDialog(page)
  await expect(page.getByText('Крытая терраса', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Добавить стол', exact: true }).first().click()
  const table = page.getByRole('dialog')
  await table.getByLabel('Название', { exact: true }).fill('Т91')
  await table.getByLabel('Зал', { exact: true }).selectOption({ label: 'Крытая терраса' })
  await table.getByLabel('Вместимость', { exact: true }).fill('4')
  await submitDialog(page)
  await expect(page.getByText('Т91', { exact: true })).toBeVisible()

  await tab(page, 'Сотрудники')
  await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Паша/ }).first()).toBeVisible()
  await tab(page, 'Ещё')
  await page.getByRole('button', { name: /^Заказы/ }).click()
  await page.getByRole('button', { name: /^Стол 11 / }).first().click()
  const order = page.getByRole('dialog')
  await order.getByLabel('Ответственный официант', { exact: true }).selectOption({ label: 'Анна' })
  await order.getByRole('button', { name: 'Отметить блюда готовыми', exact: true }).click()
  await expect(order.getByText('Блюда готовы', { exact: true })).toBeVisible()
  await expect(order.getByText('Назначение официанта', { exact: true })).toBeVisible()
  await order.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await tab(page, 'Ещё')
  await page.getByRole('button', { name: /Журнал операций/ }).click()
  await expect(page.getByRole('heading', { name: 'Журнал операций' })).toBeVisible()
  await expect(page.getByText('Изменение товара', { exact: true }).first()).toBeVisible()
})
