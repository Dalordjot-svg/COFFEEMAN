import { expect, test } from '@playwright/test'
import { addProduct, createTableOrder, signIn, tab } from './flows'

test.use({ baseURL: async ({ baseURL }, use) => {
  const url = new URL(baseURL!)
  if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
  await use(url.href)
} })

test('оповещения срабатывают, а тестовое удаление требует подтверждения устройства', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Виртуальный биометрический ключ доступен через Chromium CDP')
  await page.addInitScript(() => {
    const createOscillator = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      const root = document.documentElement
      root.dataset.soundCount = String(Number(root.dataset.soundCount ?? '0') + 1)
      return createOscillator.call(this)
    }
    Object.defineProperty(navigator, 'vibrate', { value: (pattern: number | number[]) => {
      document.documentElement.dataset.vibration = String(pattern)
      return true
    } })
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
  } })
  await signIn(page)
  await tab(page, 'Профиль')
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  const removal = page.getByRole('switch', { name: 'Удаление выданных позиций' })
  await expect(removal).not.toBeChecked()
  await expect(page.getByText(/В тестировании · Face ID/)).toBeVisible()
  await page.getByRole('button', { name: 'Проверить оповещения' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-vibration', '120,70,120')
  await expect(page.locator('html')).toHaveAttribute('data-sound-count', '1')
  await removal.click()
  await expect(removal).toBeChecked()

  await createTableOrder(page, 12)
  await addProduct(page, 'Чизкейк')
  await page.getByRole('button', { name: 'Отправить на кухню' }).click()
  await page.getByRole('button', { name: 'Готово: Чизкейк' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-sound-count', '2')
  await page.getByRole('button', { name: 'Выдать: Чизкейк' }).click()
  await expect(page.locator('.order-editor-status')).toContainText('Все позиции выданы')
  const item = page.locator('.order-item-row').filter({ hasText: 'Чизкейк' })
  await item.click()
  await page.getByRole('button', { name: 'Удалить выданную позицию' }).click()
  await expect(item).toHaveCount(0)
  await page.getByRole('button', { name: 'К расчёту' }).click()
  await expect(page.getByText('Все позиции удалены. Сумма к расчёту 0 ₽.')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть заказ' }).press('Enter')
  await expect(page.getByText('Завершён', { exact: true })).toBeVisible()
})
