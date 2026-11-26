import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { chooseLatteModifiers, chooseTable, configureProduct, openCatalog, openLogin, signIn, tab } from './flows'

const sizes = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
]

function capture(directory: string) {
  return async (page: Page, name: string) => {
    const geometry = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth
      const visibleInputs = Array.from(document.querySelectorAll('input, textarea, select')).filter((element) =>
        element.getClientRects().length > 0 && !element.matches('[type=checkbox], [type=radio], [type=color], [type=range]'))
      return {
        viewport,
        document: document.documentElement.scrollWidth,
        smallestInput: Math.min(100, ...visibleInputs.map(element => Number.parseFloat(getComputedStyle(element).fontSize))),
      }
    })
    expect(geometry.document, `Горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(geometry.viewport)
    expect(geometry.smallestInput, `Размер символов при вводе на экране ${name}`).toBeGreaterThanOrEqual(16)
    await page.screenshot({ path: path.join(directory, `${name}.png`), animations: 'disabled', scale: 'css' })
  }
}

for (const size of sizes) {
  const resolution = `${size.width}x${size.height}`

  test(`скриншоты официанта ${resolution}`, async ({ page }, testInfo) => {
    test.skip(!process.env.VISUAL_CHECK || testInfo.project.name !== 'chromium-mobile', 'Скриншоты сохраняются по запросу в Chromium')
    test.setTimeout(120_000)
    const save = capture(path.join('docs', 'screenshots', resolution))
    await page.setViewportSize(size)
    await page.clock.setFixedTime(new Date('2026-11-26T12:48:00Z'))
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    await openLogin(page)
    await expect(page.getByLabel('Имя сотрудника')).toBeVisible()
    await save(page, '01-login')
    await page.getByLabel('Имя сотрудника').fill('Паша')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Главная', exact: true })).toBeVisible()
    await save(page, '02-home')

    await tab(page, 'Заказы')
    await page.getByRole('button', { name: 'Все', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Стол 11 / })).toBeVisible()
    await save(page, '03-orders')
    await page.getByRole('button', { name: /^Стол 11 / }).click()
    await expect(page.getByRole('heading', { name: 'Стол 11', exact: true })).toBeVisible()
    await save(page, '04-editor')
    await openCatalog(page)
    await save(page, '05-categories')
    await configureProduct(page, 'Латте')
    await chooseLatteModifiers(page)
    const add = page.getByRole('dialog').getByRole('button', { name: /^Добавить/ })
    await expect(add).toBeInViewport({ ratio: 0.95 })
    await save(page, '06-product')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await save(page, '06b-products')
    await page.getByRole('button', { name: 'Закрыть меню', exact: true }).click()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()

    await page.getByRole('button', { name: 'Новый заказ', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Выберите стол', exact: true })).toBeVisible()
    await save(page, '07-tables')
    await chooseTable(page, 12)
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, '07b-guest-count')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.getByRole('button', { name: 'Назад', exact: true }).click()

    await tab(page, 'Стоп-лист')
    await expect(page.getByRole('heading', { name: 'Стоп-лист', exact: true })).toBeVisible()
    await save(page, '08-stop-list')
    await page.getByRole('button', { name: 'Изменить остаток: Креветки и руккола', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, '09-stock-editor')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await tab(page, 'Профиль')
    await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible()
    await save(page, '10-profile')
    await page.getByRole('button', { name: 'Моя статистика', exact: true }).click()
    await save(page, '10b-profile-stats')
    await page.getByRole('button', { name: 'Назад в профиль', exact: true }).click()
    await page.getByRole('button', { name: 'История заказов', exact: true }).click()
    await save(page, '10c-history')
    await page.getByRole('button', { name: 'Назад в профиль', exact: true }).click()
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible()
    await save(page, '11-settings')
    await tab(page, 'Главная')
    await page.getByRole('button', { name: 'Уведомления', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Уведомления', exact: true })).toBeVisible()
    await save(page, '11b-notifications')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await tab(page, 'Заказы')
    await page.getByRole('button', { name: 'Быстрые действия', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Быстрые действия' })).toBeVisible()
    await save(page, '12-quick-actions')
    expect(errors).toEqual([])
  })

  test(`скриншоты администратора ${resolution}`, async ({ page }, testInfo) => {
    test.skip(!process.env.VISUAL_CHECK || testInfo.project.name !== 'chromium-mobile', 'Скриншоты сохраняются по запросу в Chromium')
    test.setTimeout(120_000)
    const save = capture(path.join('docs', 'screenshots', resolution))
    await page.setViewportSize(size)
    await page.clock.setFixedTime(new Date('2026-11-26T12:48:00Z'))
    await signIn(page, 'admin')

    await expect(page.getByRole('heading', { name: 'Управление' })).toBeVisible()
    await save(page, 'admin-01-overview')
    await tab(page, 'Каталог')
    await save(page, 'admin-02-products')
    await page.getByRole('button', { name: 'Добавить товар', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, 'admin-03-product-editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.getByRole('button', { name: 'Категории', exact: true }).click()
    await save(page, 'admin-04-categories')
    await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, 'admin-04b-category-editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await tab(page, 'Залы')
    await save(page, 'admin-05-floor')
    await page.getByRole('button', { name: 'Добавить зал', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, 'admin-05b-hall-editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.getByRole('button', { name: 'Добавить стол', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, 'admin-05c-table-editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await tab(page, 'Сотрудники')
    await save(page, 'admin-06-staff')
    await page.getByRole('button', { name: /Паша/ }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, 'admin-06b-staff-editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await tab(page, 'Ещё')
    await save(page, 'admin-07-menu')
    await page.getByRole('button', { name: /^Заказы/ }).click()
    await expect(page.getByRole('heading', { name: 'Все заказы' })).toBeVisible()
    await save(page, 'admin-08-orders')
    await page.getByRole('button', { name: /^Стол 11 / }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await save(page, 'admin-09-order-editor')
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click()
    await tab(page, 'Ещё')
    await page.getByRole('button', { name: /^Настройки/ }).click()
    await expect(page.getByRole('heading', { name: 'Настройки системы' })).toBeVisible()
    await save(page, 'admin-10-settings')
    await tab(page, 'Ещё')
    await page.getByRole('button', { name: /^Журнал операций/ }).click()
    await save(page, 'admin-11-audit')
  })
}
