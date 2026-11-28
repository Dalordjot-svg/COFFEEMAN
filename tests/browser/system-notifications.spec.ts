import { expect, test } from '@playwright/test'
import { addProduct, createTableOrder, signIn, tab } from './flows'

test('запрашивает системное разрешение и отправляет тест и готовность заказа', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Сценарий Android')
  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default'
    Object.defineProperty(Notification, 'permission', { get: () => permission })
    Notification.requestPermission = async () => {
      document.documentElement.dataset.permissionRequested = 'true'
      return permission = 'granted'
    }
    Object.defineProperty(navigator, 'vibrate', { value: () => false })
    Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async () => ({
      active: true,
      scope: location.origin + '/',
      showNotification: async (_title: string, options: NotificationOptions & { vibrate?: number[] }) => {
        document.documentElement.dataset.notification = options.body
        document.documentElement.dataset.notificationVibration = String(options.vibrate)
      },
    }) })
  })
  await signIn(page)
  await tab(page, 'Профиль')
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  const root = page.locator('html')
  await expect(root).not.toHaveAttribute('data-permission-requested', 'true')
  await page.getByRole('button', { name: 'Разрешить системные уведомления' }).click()
  await expect(root).toHaveAttribute('data-permission-requested', 'true')
  await expect(root).toHaveAttribute('data-notification', 'Проверка системных уведомлений')
  await expect(page.getByRole('button', { name: 'Проверить системное уведомление' })).toBeEnabled()
  await createTableOrder(page, 12)
  await addProduct(page, 'Чизкейк')
  await page.getByRole('button', { name: 'Отправить на кухню' }).click()
  await page.getByRole('button', { name: 'Готово: Чизкейк' }).click()
  await expect(root).toHaveAttribute('data-notification', /Чизкейк готово к выдаче/)
  await expect(root).toHaveAttribute('data-notification-vibration', '120,70,120')
})

test('объясняет запуск с экрана «Домой» в браузере iPhone', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'Сценарий iPhone')
  await signIn(page)
  await tab(page, 'Профиль')
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  const system = page.getByRole('region', { name: 'Системные уведомления' })
  await expect(system.getByText(/откройте его с иконки/)).toBeVisible()
  await system.getByRole('button', { name: 'Как установить COFFEEMAN' }).click()
  await expect(page.getByRole('dialog', { name: 'Установить COFFEEMAN' })).toBeVisible()
})
