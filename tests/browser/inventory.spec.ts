import { expect, test, type Page } from '@playwright/test'
import { addProduct, createTableOrder, itemAction, signIn, tab } from './flows'

const stockButton = (page: Page) => page.getByRole('button', { name: 'Изменить остаток: Чизкейк', exact: true })

async function setPhysicalStock(page: Page, count: number) {
  await tab(page, 'Стоп-лист')
  await stockButton(page).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('spinbutton').first().fill(String(count))
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('два официанта резервируют последнюю порцию, отменяют и выдают', async ({ page, context }) => {
  const second = await context.newPage()
  await signIn(page, 'Паша', false)
  await setPhysicalStock(page, 1)
  await signIn(second, 'Алиса')
  await createTableOrder(page, 12)
  await createTableOrder(second, 13)
  await addProduct(page, 'Чизкейк')
  await addProduct(second, 'Чизкейк')

  const sent = (candidate: Page) => candidate.getByRole('button', { name: 'Отправить на кухню', exact: true })
  await Promise.all([sent(page).click(), sent(second).click()])

  // One of the transactions commits. The other leaves the item as a draft.
  await expect.poll(async () => Number(await sent(page).isVisible()) + Number(await sent(second).isVisible())).toBe(1)
  const loser = await sent(page).isVisible() ? page : second
  const winner = loser === page ? second : page
  await expect(loser.getByRole('alert').filter({ hasText: /остат|порци|Чизкейк|доступ/i }).first()).toBeVisible()
  const observer = await context.newPage()
  await observer.goto('/')
  await tab(observer, 'Стоп-лист')
  await expect(stockButton(observer)).toBeVisible()
  await expect(stockButton(observer)).toContainText('Закончился')

  await itemAction(winner, 'Чизкейк', 'Отменить позицию')
  await expect(stockButton(observer)).toContainText(/1\s*шт/)
  await sent(loser).click()
  await expect(sent(loser)).toHaveCount(0)
  await itemAction(loser, 'Чизкейк', 'Отметить готовым')
  await itemAction(loser, 'Чизкейк', 'Отметить выданным')
  await loser.getByRole('button', { name: /Чизкейк/ }).click()
  await expect(loser.getByRole('button', { name: 'Отметить выданным', exact: true })).toHaveCount(0)

  await stockButton(observer).click()
  const stock = observer.getByRole('dialog')
  await expect(stock.getByRole('spinbutton').first()).toHaveValue('0')
  await stock.getByRole('spinbutton').first().fill('3')
  await stock.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(stock).toHaveCount(0)
  await expect(stockButton(observer)).toContainText(/3\s*шт/)
})
