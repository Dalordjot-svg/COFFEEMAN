import { expect, test } from '@playwright/test'
import { addProduct, chooseTable, createTableOrder, signIn } from './flows'

test('пересадка с занятым заказом освобождает исходный стол и переносит гостей и позиции', async ({ page }) => {
  await signIn(page)
  await createTableOrder(page, 12, 2)
  await addProduct(page, 'Чизкейк', 2)
  await page.getByRole('button', { name: 'Отправить на кухню' }).click()
  await page.getByRole('button', { name: 'Действия заказа' }).click()
  await page.getByRole('button', { name: 'Пересадить за другой стол' }).click()
  const moveDialog = page.getByRole('dialog', { name: 'Пересадить за другой стол' })
  await expect(moveDialog.getByRole('button', { name: '11', exact: true })).toHaveCount(0)
  await expect(moveDialog.getByRole('button', { name: '12', exact: true })).toHaveCount(0)
  await moveDialog.getByRole('button', { name: '13', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Стол 13', exact: true })).toBeVisible()
  const guest = page.getByRole('region', { name: 'Гость 2', exact: true })
  await expect(guest.getByText('Чизкейк', { exact: true })).toBeVisible()
  await expect(guest.getByText('Готовится', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await chooseTable(page, 12)
  await expect(page.getByRole('dialog', { name: 'Количество гостей' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  await chooseTable(page, 13)
  await expect(page.getByRole('dialog', { name: 'Стол 13' })).toBeVisible()
})
