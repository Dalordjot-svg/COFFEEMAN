import { expect, type Page } from '@playwright/test'

const onboardingHandlers = new WeakSet<Page>()

export async function openLogin(page: Page) {
  if (!onboardingHandlers.has(page)) {
    const guide = page.getByRole('dialog', { name: 'Установить COFFEEMAN', exact: true })
    await page.addLocatorHandler(guide, async () => {
      await guide.getByRole('button', { name: 'Позже', exact: true }).click()
    })
    onboardingHandlers.add(page)
  }
  await page.goto('/')
}

export async function signIn(page: Page, name = 'Паша', remember = true) {
  await openLogin(page)
  await page.getByLabel('Имя сотрудника').fill(name)
  if (!remember) await page.getByLabel('Запомнить меня').uncheck()
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}

export async function tab(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

export async function chooseTable(page: Page, number: number) {
  await page.getByRole('button', { name: new RegExp(`^(Стол )?${number}(?:,|$)`) }).click()
}

export async function createTableOrder(page: Page, number: number, count = 1) {
  await tab(page, 'Заказы')
  await page.getByRole('button', { name: 'Новый заказ', exact: true }).click()
  await chooseTable(page, number)
  const guests = page.getByRole('textbox', { name: 'Количество гостей', exact: true })
  await expect(guests).toBeVisible()
  await guests.fill(String(count))
  await page.getByRole('button', { name: 'Создать заказ', exact: true }).click()
  await expect(page.getByRole('heading', { name: `Стол ${number}`, exact: true })).toBeVisible()
}

export async function openCatalog(page: Page, guest = 1) {
  await page.getByRole('button', { name: `Добавить позицию гостю ${guest}`, exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Поиск позиций' })).toBeVisible()
}

export async function configureProduct(page: Page, name: string) {
  await page.getByRole('searchbox', { name: 'Поиск позиций' }).fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible()
}

export async function chooseLatteModifiers(page: Page) {
  const product = page.getByRole('dialog', { name: 'Латте', exact: true })
  await product.getByRole('button', { name: /^Молоко/ }).click()
  await product.getByRole('button', { name: 'Обычное', exact: true }).click()
  await product.getByRole('button', { name: /^Сироп/ }).click()
  await product.getByRole('button', { name: /^Ваниль/ }).click()
}

export async function addProduct(page: Page, name: string, guest = 1) {
  await openCatalog(page, guest)
  await page.getByRole('searchbox', { name: 'Поиск позиций' }).fill(name)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByRole('status').filter({ hasText: /добавлено/ })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть меню', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

export async function itemAction(page: Page, item: string, action: string) {
  const dialog = page.getByRole('dialog')
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: new RegExp(item) }).click()
  await dialog.getByRole('button', { name: action, exact: true }).click()
  if (action !== 'Отметить готовым') await expect(dialog).toHaveCount(0)
}
