import { expect, test } from '@playwright/test'
import { createTableOrder, openCatalog, signIn } from './flows'

test('своя позиция из меню и поиска, отложенная цена и закрытие заказа', async ({ page }) => {
  await signIn(page)
  await createTableOrder(page, 12)
  await openCatalog(page)
  const firstTile = page.locator('.order-category-grid').getByRole('button').first()
  await expect(firstTile).toHaveText('Своя позиция')
  await firstTile.click()
  const custom = page.getByRole('dialog', { name: 'Своя позиция' })
  await custom.getByLabel('Название').fill('Комплимент гостю')
  await custom.getByLabel('Цена, ₽').fill('0')
  await custom.getByRole('button', { name: 'Добавить в заказ' }).click()

  await page.getByRole('searchbox', { name: 'Поиск позиций' }).fill('Тёплый лимонад')
  await expect(page.getByText('Похоже, такой позиции в меню нет. Добавить свою?')).toBeVisible()
  await page.getByRole('button', { name: 'Добавить свою позицию' }).click()
  await expect(custom.getByLabel('Название')).toHaveValue('Тёплый лимонад')
  await custom.getByLabel('Комментарий').fill('Без льда')
  await custom.getByRole('button', { name: 'Уточню позже' }).click()
  await page.getByRole('button', { name: 'Закрыть меню' }).click()

  const line = page.locator('.order-item-row').filter({ hasText: 'Тёплый лимонад' })
  await expect(line).toContainText('Без льда')
  await expect(line).toContainText('Цена не указана')
  await page.getByRole('button', { name: 'Отправить на кухню' }).click()
  for (const name of ['Тёплый лимонад', 'Комплимент гостю']) {
    await page.getByRole('button', { name: `Готово: ${name}` }).click()
    await page.getByRole('button', { name: `Выдать: ${name}` }).click()
  }
  await expect(page.getByRole('button', { name: 'К расчёту' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Указать цену' }).click()
  await page.getByLabel('Цена, ₽').fill('185,50')
  await page.getByRole('button', { name: 'Сохранить цену' }).click()
  await expect(line).toContainText('185,5')
  await page.getByRole('button', { name: 'К расчёту' }).click()
  const checkout = page.getByRole('dialog', { name: 'Позиции для кассы' })
  await expect(checkout).toContainText('Тёплый лимонад')
  await expect(checkout.getByText('185,5 ₽').first()).toBeVisible()
  await checkout.getByRole('button', { name: 'Закрыть заказ' }).press('Enter')
  await expect(page.getByText('Завершён', { exact: true })).toBeVisible()
})
