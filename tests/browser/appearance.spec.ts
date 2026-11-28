import { expect, test } from '@playwright/test'
import { createTableOrder, signIn, tab } from './flows'

test('переключает темы в настройках, сохраняет выбор и учитывает уменьшение движения', async ({ page }) => {
  await signIn(page)
  const root = page.locator('html')
  const snow = page.locator('.winter-snow')
  const settings = async () => {
    await tab(page, 'Профиль')
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    return page.getByRole('group', { name: 'Тема оформления' })
  }

  const themes = await settings()
  const dark = themes.getByRole('button', { name: 'Тёмная', exact: true })
  const light = themes.getByRole('button', { name: 'Светло-серая', exact: true })
  const winter = themes.getByRole('button', { name: 'Зимняя', exact: true })
  await expect(dark).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('В тестировании.', { exact: true })).toBeVisible()
  await light.click()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await expect(root).toHaveCSS('background-color', 'rgb(232, 234, 238)')
  await expect(snow).toBeHidden()

  await createTableOrder(page, 12)
  await page.getByRole('button', { name: 'Действия заказа' }).click()
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(249, 250, 251)')
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await page.getByRole('button', { name: 'Назад', exact: true }).click()
  await settings()
  await winter.click()
  await expect(root).toHaveAttribute('data-theme', 'winter')
  await expect(snow).toBeVisible()
  await expect(snow).toHaveCSS('pointer-events', 'none')
  expect(await snow.evaluate(element => getComputedStyle(element, '::before').animationName)).toBe('winter-snowfall')

  await page.reload()
  await settings()
  await expect(winter).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(snow).toBeHidden()
  await dark.click()
  await expect(root).toHaveCSS('background-color', 'rgb(0, 0, 0)')
})

test('переключает оформление в настройках администратора', async ({ page }) => {
  await signIn(page, 'admin')
  await tab(page, 'Ещё')
  await page.getByRole('button', { name: /^Настройки/ }).click()
  await page.getByRole('group', { name: 'Тема оформления' }).getByRole('button', { name: 'Светло-серая' }).click()
  await expect(page.locator('.admin-shell')).toHaveCSS('background-color', 'rgb(232, 234, 238)')
  await expect(page.getByRole('textbox', { name: 'Название заведения' })).toBeVisible()
})
