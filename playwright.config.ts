import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const preview = process.env.QA_PREVIEW === '1'
const port = preview ? 4174 : 4173
const appUrl = process.env.QA_BASE_URL || `http://127.0.0.1:${port}`
const systemChromium = '/usr/bin/chromium'
const executablePath = process.env.QA_CHROMIUM_PATH || (existsSync(systemChromium) ? systemChromium : undefined)

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: 'list',
  use: {
    baseURL: appUrl,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        launchOptions: { executablePath },
      },
    },
    ...(process.env.QA_WEBKIT === '1' ? [{ name: 'webkit-mobile', use: devices['iPhone 13'] }] : []),
  ],
  webServer: process.env.QA_BASE_URL
    ? undefined
    : {
        command: `npm run ${preview ? 'preview' : 'dev'} -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: appUrl,
        reuseExistingServer: !preview && !process.env.CI,
        timeout: 30_000,
      },
})
