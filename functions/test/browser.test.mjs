import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { chromium, expect } from '@playwright/test'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const port = '4267'
const appUrl = `http://127.0.0.1:${port}`
const projectId = 'demo-coffeeman'
const root = fileURLToPath(new URL('../../', import.meta.url))
const password = 'browser-emulator-test-password'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

initializeApp({ projectId })

async function account(role) {
  const email = `${randomUUID()}@coffeeman.test`
  const created = await getAuth().createUser({ email, password, displayName: 'Проверка Firebase' })
  await getAuth().setCustomUserClaims(created.uid, { coffeemanRole: role })
  return email
}

async function startApp() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', port, '--strictPort'], {
    cwd: root,
    env: {
      ...process.env,
      VITE_APP_MODE: 'firebase',
      VITE_FIREBASE_API_KEY: 'emulator-test-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-coffeeman.firebaseapp.com',
      VITE_FIREBASE_DATABASE_URL: 'https://demo-coffeeman-default-rtdb.firebaseio.com',
      VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_APP_ID: '1:123:web:coffeeman',
      VITE_FIREBASE_FUNCTIONS_REGION: 'us-central1',
      VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    },
    stdio: 'ignore',
  })
  try {
    for (let attempt = 0; attempt < 45 && server.exitCode === null; attempt++) {
      try {
        if ((await fetch(appUrl)).ok) return server
      } catch {
        await delay(200)
      }
    }
    throw new Error('Vite did not start for the Firebase browser test')
  } catch (error) {
    server.kill()
    throw error
  }
}

async function login(context, email) {
  const page = await context.newPage()
  await page.goto(appUrl)
  await page.getByRole('textbox', { name: 'Электронная почта' }).fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByText('Firebase · Синхронизация активна')).toBeVisible({ timeout: 20000 })
  return page
}

test('Firebase browser sessions synchronize and recover after going offline', { timeout: 60000 }, async () => {
  const server = await startApp()
  try {
    const systemChromium = '/usr/bin/chromium'
    const executablePath = process.env.QA_CHROMIUM_PATH || (existsSync(systemChromium) ? systemChromium : undefined)
    const browser = await chromium.launch({ executablePath })
    try {
      const [adminEmail, waiterEmail] = await Promise.all([account('admin'), account('waiter')])
      const [adminContext, waiterContext] = await Promise.all([
        browser.newContext({ viewport: { width: 390, height: 844 } }),
        browser.newContext({ viewport: { width: 390, height: 844 } }),
      ])
      const [admin, waiter] = await Promise.all([login(adminContext, adminEmail), login(waiterContext, waiterEmail)])
      await admin.getByRole('button', { name: 'Каталог', exact: true }).click()
      await admin.getByRole('button', { name: 'Категории', exact: true }).click()
      await admin.getByRole('button', { name: 'Добавить категорию' }).click()
      const category = `Категория ${randomUUID().slice(0, 8)}`
      await admin.getByLabel('Название', { exact: true }).fill(category)
      await admin.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(admin.getByText(category, { exact: true })).toBeVisible()
      await admin.getByRole('button', { name: 'Товары', exact: true }).click()
      await admin.getByRole('button', { name: 'Добавить товар' }).click()
      const product = `Товар ${randomUUID().slice(0, 8)}`
      await admin.getByLabel('Название', { exact: true }).fill(product)
      await admin.getByLabel('Категория', { exact: true }).selectOption({ label: category })
      await admin.getByLabel('Цена, ₽', { exact: true }).fill('110')
      await admin.getByLabel('Учитывать количество').check()
      await admin.getByLabel('Физический остаток').fill('3')

      await waiter.reload()
      await expect(waiter.getByRole('heading', { name: 'Главная' })).toBeVisible({ timeout: 20000 })
      await waiterContext.setOffline(true)
      await expect(waiter.getByText(/Firebase.*Соединение|Нет интернета/)).toBeVisible()
      await waiter.getByRole('button', { name: 'Стоп-лист', exact: true }).click()
      await admin.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await expect(admin.getByText(product, { exact: true })).toBeVisible()
      await expect(waiter.getByText(product, { exact: true })).toHaveCount(0)
      await waiterContext.setOffline(false)
      await expect(waiter.getByText(product, { exact: true })).toBeVisible({ timeout: 20000 })
      await waiter.getByRole('button', { name: 'Главная', exact: true }).click()
      await expect(waiter.getByText('Firebase · Синхронизация активна')).toBeVisible()
    } finally {
      await browser.close()
    }
  } finally {
    server.kill()
  }
})
