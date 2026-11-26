import { expect, test, type Page } from '@playwright/test'
import { tab } from './flows'

const installGuide = (page: Page) => page.getByRole('dialog', { name: 'Установить COFFEEMAN', exact: true })
const replayGuide = (page: Page) => page.getByRole('button', { name: /^Как установить приложение/ })

test('мобильный браузер показывает свою инструкцию, затем помнит решение', async ({ page }, testInfo) => {
  const iphone = testInfo.project.name === 'webkit-mobile'
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const guide = installGuide(page)
  await expect(guide).toBeVisible()
  await expect(guide.getByRole('heading', { name: iphone ? 'На iPhone' : 'На Android', exact: true })).toBeVisible()
  const browser = iphone ? /Safari/ : /Chrome/
  const instruction = iphone ? /На экран «Домой»|На экран Домой/ : /Установить приложение|Добавить на главный экран/
  await expect(guide.getByText(browser).first()).toBeVisible()
  await expect(guide.getByText(instruction).first()).toBeVisible()

  if (process.env.VISUAL_CHECK) {
    await page.screenshot({
      path: `docs/screenshots/390x844/00-install-${iphone ? 'iphone' : 'android'}.png`,
      animations: 'disabled', scale: 'css',
    })
  }

  await guide.getByRole('button', { name: 'Позже', exact: true }).click()
  await expect(guide).toHaveCount(0)
  await expect(page.getByLabel('Имя сотрудника')).toBeVisible()
  await page.reload()
  await expect(replayGuide(page)).toBeVisible()
  await expect(guide).toHaveCount(0)
  await replayGuide(page).click()
  await expect(guide).toBeVisible()
  await guide.getByRole('button', { name: iphone ? 'Android' : 'iPhone', exact: true }).click()
  await expect(guide.getByRole('heading', { name: iphone ? 'На Android' : 'На iPhone', exact: true })).toBeVisible()
  await guide.getByRole('button', { name: 'Позже', exact: true }).click()

  await page.getByLabel('Имя сотрудника').fill('Паша')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await tab(page, 'Профиль')
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await replayGuide(page).click()
  await expect(guide).toBeVisible()
})

test('установленное приложение скрывает инструкцию', async ({ page }, testInfo) => {
  await page.addInitScript((iphone) => {
    if (iphone) {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
      return
    }
    const matchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query) => {
      const result = matchMedia(query)
      if (query !== '(display-mode: standalone)') return result
      return new Proxy(result, {
        get(target, property) {
          if (property === 'matches') return true
          const member = Reflect.get(target, property, target)
          return typeof member === 'function' ? member.bind(target) : member
        },
      })
    }
  }, testInfo.project.name === 'webkit-mobile')

  await page.goto('/')
  await expect(page.getByLabel('Имя сотрудника')).toBeVisible()
  await expect(installGuide(page)).toHaveCount(0)
  await expect(replayGuide(page)).toHaveCount(0)
  await page.getByLabel('Имя сотрудника').fill('Паша')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await tab(page, 'Профиль')
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
  await expect(replayGuide(page)).toHaveCount(0)
})

test('Android передаёт запрос установки браузеру и скрывает подсказку после успеха', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', 'Нативный запрос передаёт браузер Android')
  await page.goto('/')
  const guide = installGuide(page)
  await expect(guide).toBeVisible()
  await page.evaluate(() => {
    const nativeInstall = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(nativeInstall, {
      prompt: async () => { document.documentElement.dataset.installRequested = 'true' },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    })
    window.dispatchEvent(nativeInstall)
  })
  await guide.getByRole('button', { name: 'Установить', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-install-requested', 'true')
  await expect(guide).toHaveCount(0)
  await expect(replayGuide(page)).toHaveCount(0)
})
