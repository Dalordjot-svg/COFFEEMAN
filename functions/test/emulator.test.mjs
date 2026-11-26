import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const projectId = 'demo-coffeeman'
const databaseNamespace = 'demo-coffeeman-default-rtdb'
const password = 'test-only-fixture-password'

// Force a local endpoint and synthetic project for every fixture.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
initializeApp({ projectId })
const auth = getAuth()

async function user(role) {
  const email = `${randomUUID()}@coffeeman.test`
  const account = await auth.createUser({ email, password, displayName: `Test ${role}` })
  if (role !== 'outsider') await auth.setCustomUserClaims(account.uid, { coffeemanRole: role })
  const login = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-test-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  assert.equal(login.status, 200)
  return { uid: account.uid, token: (await login.json()).idToken, deviceId: randomUUID() }
}

async function command(actor, action, operationId = randomUUID()) {
  const response = await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/coffeemanCommand`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
    },
    body: JSON.stringify({ data: { deviceId: actor?.deviceId, operationId, command: action } }),
  })
  return { status: response.status, ...(await response.json()) }
}

async function run(actor, action, operationId) {
  const outcome = await command(actor, action, operationId)
  assert.equal(outcome.status, 200, JSON.stringify(outcome))
  assert.ok(outcome.result.operationId)
  return outcome.result.operationId
}

async function realtime(actor, path, payload) {
  const url = new URL(`http://127.0.0.1:9000/${path}.json`)
  url.searchParams.set('ns', databaseNamespace)
  if (actor) url.searchParams.set('auth', actor.token)
  return fetch(url, payload === undefined ? undefined : {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function read(actor, path) {
  const response = await realtime(actor, path)
  const data = await response.json()
  assert.equal(response.status, 200, JSON.stringify(data))
  return data
}

test('Firebase enforces staff roles and reserves the last unit across distinct accounts', async () => {
  const [admin, waiter1, waiter2, outsider] = await Promise.all([user('admin'), user('waiter'), user('waiter'), user('outsider')])
  assert.equal((await command(null, { type: 'registerUser' })).status, 401)
  assert.equal((await command(outsider, { type: 'registerUser' })).status, 403)
  assert.equal((await realtime(null, 'coffeeman/orders')).status, 401)
  assert.equal((await realtime(outsider, 'coffeeman/orders')).status, 401)
  await Promise.all([admin, waiter1, waiter2].map(actor => run(actor, { type: 'registerUser' })))
  assert.equal((await realtime(admin, 'coffeeman/orders', 'unsafe write')).status, 401)
  assert.equal((await realtime(waiter1, 'coffeeman/auditLogs')).status, 401)

  const category = { id: randomUUID(), name: 'Тестовая категория', color: '#2778ff', sort: 1 }
  const product = { id: randomUUID(), name: 'Последний десерт', categoryId: category.id, price: 120, available: true, sort: 1 }
  assert.notEqual((await command(waiter1, { type: 'saveCategory', category })).status, 200)
  await run(admin, { type: 'saveCategory', category })
  await run(admin, { type: 'saveProduct', product, inventory: { quantity: 1, min: 1 } })
  assert.equal((await read(waiter1, `coffeeman/products/${product.id}`)).name, product.name)

  const carts = await Promise.all([waiter1, waiter2].map(async (actor, index) => {
    const orderId = randomUUID()
    const itemId = randomUUID()
    await run(actor, { type: 'createOrder', orderId, tabName: `Таб ${index + 1}`, guestCount: 1 })
    const order = await read(actor, `coffeeman/orders/${orderId}`)
    await run(actor, { type: 'addItem', orderId, itemId, guestId: order.guestIds[0], productId: product.id, quantity: 1 })
    return { actor, orderId, itemId }
  }))
  const simultaneous = await Promise.all(carts.map(cart => command(cart.actor, { type: 'sendOrder', orderId: cart.orderId })))
  const winningIndex = simultaneous.findIndex(outcome => outcome.status === 200)
  assert.ok(winningIndex >= 0)
  assert.equal(simultaneous.filter(outcome => outcome.status === 200).length, 1)
  const winning = carts[winningIndex]
  const losing = carts[1 - winningIndex]
  assert.equal((await read(waiter2, `coffeeman/orders/${winning.orderId}/items/${winning.itemId}`)).status, 'preparing')
  assert.equal((await read(waiter1, `coffeeman/inventory/${product.id}`)).quantity, 1)

  await run(winning.actor, { type: 'cancelItem', orderId: winning.orderId, itemId: winning.itemId })
  await run(losing.actor, { type: 'sendOrder', orderId: losing.orderId })
  await run(admin, { type: 'readyOrder', orderId: losing.orderId })
  const serve = { type: 'serveItem', orderId: losing.orderId, itemId: losing.itemId }
  const replayId = await run(losing.actor, serve)
  await run(losing.actor, serve, replayId)
  const secondServe = await command(losing.actor, serve)
  assert.ok([200, 400].includes(secondServe.status), JSON.stringify(secondServe))
  assert.equal((await read(waiter1, `coffeeman/inventory/${product.id}`)).quantity, 0)
  assert.equal((await read(waiter1, `coffeeman/orders/${losing.orderId}/items/${losing.itemId}`)).status, 'served')
  const transactions = Object.values(await read(admin, 'coffeeman/inventoryTransactions'))
    .filter(event => event.productId === product.id && event.type === 'serve')
  assert.equal(transactions.length, 1)

  await run(admin, { type: 'updateUser', userId: waiter1.uid, active: false })
  assert.equal((await realtime(waiter1, 'coffeeman/orders')).status, 401)
  assert.notEqual((await command(waiter1, { type: 'registerUser' })).status, 200)
})
