import { describe, expect, it } from 'vitest'
import {
  applyCommand, availableQuantity, configureLocalVenue, createDemoState, DomainError, emptyState, isActiveOrder,
  normalizeState, removeSampleData, orderAlerts, orderStatus, orderTotal, stats, stockStatus,
} from '../src/domain'
import type { Command, Product, Session, State } from '../src/domain'

const timestamp = new Date(2026, 5, 15, 12).getTime()
const minute = 60_000
const pasha: Session = { userId: 'demo-pasha', deviceId: 'device-one', name: 'Паша', role: 'waiter', demo: true }
const anna: Session = { userId: 'demo-anna', deviceId: 'device-two', name: 'Анна', role: 'waiter', demo: true }
const admin: Session = { userId: 'admin-a', deviceId: 'device-admin', name: 'Администратор', role: 'admin', demo: true }

function fixture() {
  let state = createDemoState(timestamp)
  let counter = 0
  const execute = (command: Command, actor = pasha, options?: { id?: string; now?: number }) => {
    state = applyCommand(state, actor, command, {
      id: options?.id ?? `operation-${++counter}`,
      now: options?.now ?? timestamp + counter,
    })
    return state
  }
  execute({ type: 'registerUser' }, admin)
  return { state: () => state, execute }
}

function addCheesecake(execute: ReturnType<typeof fixture>['execute'], orderId: string, actor = pasha, quantity = 1, itemId = 'cheesecake-one') {
  execute({ type: 'addItem', orderId, guestId: 'guest-1', itemId, productId: 'cheesecake', quantity }, actor)
}

describe('резервирование и списание', () => {
  it('позволяет резервировать последнюю порцию только один раз и списывает её только после выдачи', () => {
    const { execute, state } = fixture()
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 1 })
    execute({ type: 'createOrder', orderId: 'order-a', tableId: 'table-12', guestCount: 1 }, pasha)
    execute({ type: 'createOrder', orderId: 'order-b', tableId: 'table-13', guestCount: 1 }, anna)
    addCheesecake(execute, 'order-a', pasha)
    addCheesecake(execute, 'order-b', anna)

    expect(availableQuantity(state(), 'cheesecake')).toBe(1)
    execute({ type: 'sendOrder', orderId: 'order-a' }, pasha, { id: 'reserve-last' })
    expect(state().inventory.cheesecake.quantity).toBe(1)
    expect(availableQuantity(state(), 'cheesecake')).toBe(0)
    expect(stockStatus(state(), 'cheesecake')).toBe('out')
    expect(() => execute({ type: 'sendOrder', orderId: 'order-b' }, anna)).toThrow(/Недостаточно порций/)
    expect(orderStatus(state().orders['order-b'])).toBe('new')

    const reserved = state()
    expect(execute({ type: 'sendOrder', orderId: 'order-a' }, pasha, { id: 'reserve-last' })).toBe(reserved)
    execute({ type: 'readyItem', orderId: 'order-a', itemId: 'cheesecake-one' })
    execute({ type: 'serveItem', orderId: 'order-a', itemId: 'cheesecake-one' }, pasha, { id: 'serve-once' })
    const served = state()
    expect(served.inventory.cheesecake.quantity).toBe(0)
    expect(availableQuantity(served, 'cheesecake')).toBe(0)
    expect(execute({ type: 'serveItem', orderId: 'order-a', itemId: 'cheesecake-one' })).toBe(served)
    expect(execute({ type: 'serveItem', orderId: 'order-a', itemId: 'cheesecake-one' }, pasha, { id: 'serve-once' })).toBe(served)
    expect(Object.values(state().inventoryTransactions).filter(row => row.type === 'serve' && row.productId === 'cheesecake')).toHaveLength(1)
  })

  it('не резервирует частичный заказ и освобождает резерв при отмене готового блюда', () => {
    const { execute, state } = fixture()
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 1, min: 0 })
    execute({ type: 'createOrder', orderId: 'order-a', tabName: 'Алина', guestCount: 1 })
    addCheesecake(execute, 'order-a')
    addCheesecake(execute, 'order-a', pasha, 1, 'cheesecake-two')
    const before = state()
    expect(() => execute({ type: 'sendOrder', orderId: 'order-a' })).toThrow(DomainError)
    expect(state()).toBe(before)
    expect(availableQuantity(state(), 'cheesecake')).toBe(1)
    execute({ type: 'cancelItem', orderId: 'order-a', itemId: 'cheesecake-two' })
    execute({ type: 'sendOrder', orderId: 'order-a' })
    expect(() => execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 0 })).toThrow(/зарезервировано/)
    execute({ type: 'readyOrder', orderId: 'order-a' }, admin)
    execute({ type: 'cancelItem', orderId: 'order-a', itemId: 'cheesecake-one' })
    expect(state().inventory.cheesecake.quantity).toBe(1)
    expect(availableQuantity(state(), 'cheesecake')).toBe(1)
    expect(stockStatus(state(), 'cheesecake')).toBe('in')
    expect(Object.values(state().inventoryTransactions).filter(row => row.type === 'release' && row.productId === 'cheesecake')).toHaveLength(1)
  })

  it('сохраняет ручную блокировку после пополнения и корректно включает учёт при открытом резерве', () => {
    const { execute, state } = fixture()
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 0, available: false })
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 10 })
    expect(stockStatus(state(), 'cheesecake')).toBe('out')
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: null, available: true })
    expect(stockStatus(state(), 'cheesecake')).toBe('in')
    execute({ type: 'createOrder', orderId: 'order-a', tabName: 'Доставка', guestCount: 1 })
    addCheesecake(execute, 'order-a', pasha, 2)
    execute({ type: 'sendOrder', orderId: 'order-a' })
    expect(() => execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 1 })).toThrow(/зарезервировано 2/)
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 5 })
    expect(availableQuantity(state(), 'cheesecake')).toBe(3)
    execute({ type: 'readyOrder', orderId: 'order-a' })
    execute({ type: 'serveItem', orderId: 'order-a', itemId: 'cheesecake-one' })
    expect(state().inventory.cheesecake.quantity).toBe(3)
    expect(availableQuantity(state(), 'cheesecake')).toBe(3)
  })

  it('отклоняет сохранение устаревшего физического остатка даже для операций одной миллисекунды', () => {
    const { execute, state } = fixture()
    const initial = state().inventory.cheesecake.revision ?? 0
    execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 5, expectedRevision: initial })
    execute({ type: 'createOrder', orderId: 'order-a', tabName: 'Таб', guestCount: 1 })
    addCheesecake(execute, 'order-a')
    execute({ type: 'sendOrder', orderId: 'order-a' })
    execute({ type: 'readyOrder', orderId: 'order-a' })
    const oldRevision = state().inventory.cheesecake.revision
    execute({ type: 'serveItem', orderId: 'order-a', itemId: 'cheesecake-one' }, pasha, { now: timestamp })
    expect(() => execute({ type: 'updateInventory', productId: 'cheesecake', quantity: 7, expectedRevision: oldRevision },
      pasha, { now: timestamp })).toThrow(/Остаток изменился/)
    expect(() => execute({ type: 'saveProduct', product: state().products.cheesecake,
      inventory: { quantity: 5, expectedRevision: oldRevision } }, admin, { now: timestamp })).toThrow(/Остаток изменился/)
    expect(state().inventory.cheesecake.quantity).toBe(4)
    expect(normalizeState(state()).inventory.cheesecake.revision).toBe((oldRevision ?? 0) + 1)
  })
})

describe('обслуживание и отчётность', () => {
  it('сохраняет состав истории после изменения каталога и считает только закрытые заказы', () => {
    const { execute, state } = fixture()
    const initial = stats(state(), 'day', pasha.userId, timestamp)
    execute({ type: 'createOrder', orderId: 'tea-order', tableId: 'table-12', guestCount: 2 })
    execute({ type: 'addGuest', orderId: 'tea-order', guestId: 'friend' })
    execute({ type: 'removeGuest', orderId: 'tea-order', guestId: 'guest-2' })
    execute({ type: 'addItem', orderId: 'tea-order', guestId: 'guest-1', itemId: 'cup', productId: 'latte',
      quantity: 1, sizeId: 'latte-450', optionIds: ['milk-oat', 'syrup-vanilla'], comment: 'Тёплый' })
    execute({ type: 'editItem', orderId: 'tea-order', itemId: 'cup', quantity: 2, guestId: 'friend' })
    expect(orderTotal(state().orders['tea-order'])).toBe(600)
    expect(() => execute({ type: 'sendOrder', orderId: 'tea-order' }, anna)).toThrow(/другому официанту/)
    execute({ type: 'sendOrder', orderId: 'tea-order' })
    expect(() => execute({ type: 'closeOrder', orderId: 'tea-order' })).toThrow(/Выдайте все позиции/)
    execute({ type: 'readyOrder', orderId: 'tea-order' }, admin)
    execute({ type: 'serveItem', orderId: 'tea-order', itemId: 'cup' })
    execute({ type: 'precheckOrder', orderId: 'tea-order' })
    expect(orderStatus(state().orders['tea-order'])).toBe('precheck')
    execute({ type: 'reopenOrder', orderId: 'tea-order' })
    execute({ type: 'addItem', orderId: 'tea-order', guestId: 'friend', itemId: 'extra', productId: 'tea', quantity: 1 })
    execute({ type: 'sendOrder', orderId: 'tea-order' })
    execute({ type: 'readyItem', orderId: 'tea-order', itemId: 'extra' })
    execute({ type: 'serveItem', orderId: 'tea-order', itemId: 'extra' })
    expect(stats(state(), 'day', pasha.userId, timestamp + minute).sales).toBe(initial.sales)
    execute({ type: 'closeOrder', orderId: 'tea-order' })
    execute({ type: 'saveProduct', product: { ...state().products.latte, price: 999, archived: true } }, admin)

    const closed = state().orders['tea-order']
    expect(isActiveOrder(closed)).toBe(false)
    expect(closed.items.cup.options).toEqual([{ name: 'Овсяное', price: 40 }, { name: 'Ваниль', price: 30 }])
    expect(closed.items.cup.comment).toBe('Тёплый')
    const after = stats(state(), 'day', pasha.userId, timestamp + minute)
    expect(after).toMatchObject({ sales: initial.sales + 770, guests: initial.guests + 2, orders: initial.orders + 1 })
    expect(after.series.reduce((sum, data) => sum + data.value, 0)).toBe(after.sales)
    expect(stats(state(), 'month', pasha.userId, timestamp + minute).sales).toBeGreaterThan(after.sales)
  })

  it('соблюдает пороги и пересчитывает предупреждения при изменении настроек', () => {
    const { execute, state } = fixture()
    const alerts = orderAlerts(state(), timestamp)
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ orderId: 'demo-order-27', tone: 'red' }),
      expect.objectContaining({ orderId: 'demo-order-29', tone: 'green' }),
      expect.objectContaining({ orderId: 'demo-order-14', tone: 'yellow' }),
      expect.objectContaining({ orderId: 'demo-order-tab', tone: 'yellow' }),
    ]))
    execute({ type: 'saveSettings', settings: { ...state().settings, prepMinutes: 10, criticalMinutes: 12 } }, admin)
    expect(orderAlerts(state(), timestamp).find(alert => alert.orderId === 'demo-order-14')).toMatchObject({ tone: 'red' })
  })
})

describe('администрирование и формат Firebase', () => {
  it('запрещает архив активного стола и защищает доступ к администрированию', () => {
    const { execute, state } = fixture()
    expect(() => execute({ type: 'saveTable', table: { ...state().tables['table-11'], archived: true } }, admin)).toThrow(/активный заказ/)
    expect(() => execute({ type: 'saveHall', hall: { ...state().halls['hall-1'], archived: true } }, admin)).toThrow(/незавершённые заказы/)
    expect(() => execute({ type: 'saveCategory', category: { id: 'new', name: 'Новая', color: '#ffffff', sort: 10 } })).toThrow(/администратору/)
    execute({ type: 'assignOrder', orderId: 'demo-order-11', waiterId: anna.userId }, admin)
    expect(() => execute({ type: 'readyOrder', orderId: 'demo-order-11' })).toThrow(/другому официанту/)
    execute({ type: 'readyOrder', orderId: 'demo-order-11' }, anna)
    expect(state().orders['demo-order-11'].waiterId).toBe(anna.userId)
    execute({ type: 'updateUser', userId: anna.userId, active: false }, admin)
    expect(() => execute({ type: 'registerUser' }, anna)).toThrow(/недоступна/)
  })

  it('сохраняет товар с фото и без, отклоняет Base64 и обрабатывает отсутствующие поля RTDB', () => {
    const { execute, state } = fixture()
    const product: Product = { id: 'plain', name: 'Без фото', categoryId: 'coffee', sort: 34, price: 110, available: true }
    execute({ type: 'saveProduct', product }, admin)
    expect(state().products.plain).not.toHaveProperty('imageUrl')
    execute({ type: 'saveProduct', product: { ...product, imageUrl: 'https://images.example.com/test.jpg' } }, admin)
    expect(state().products.plain.imageUrl).toBe('https://images.example.com/test.jpg')
    expect(() => execute({ type: 'saveProduct', product: { ...product, imageUrl: 'data:image/jpeg;base64,AAAA' } }, admin))
      .toThrow(/ссылку HTTP/)
    execute({ type: 'saveProduct', product }, admin)
    expect(state().products.plain).not.toHaveProperty('imageUrl')
    expect(normalizeState({ schemaVersion: 1, inventory: { plain: { updatedAt: timestamp } } })).toMatchObject({
      ...emptyState(), inventory: { plain: { quantity: null, updatedAt: timestamp } },
    })
    expect(() => normalizeState({ schemaVersion: 999 })).toThrow(/Версия/)
  })

  it('восстанавливает длинные составные ключи резерва при чтении Firebase', () => {
    const { execute, state } = fixture()
    const orderId = 'a'.repeat(180)
    const itemId = 'b'.repeat(180)
    execute({ type: 'createOrder', orderId, tabName: 'Длинный ключ', guestCount: 1 })
    addCheesecake(execute, orderId, pasha, 1, itemId)
    execute({ type: 'sendOrder', orderId })
    const decoded = normalizeState(JSON.parse(JSON.stringify(state())))
    expect(availableQuantity(decoded, 'cheesecake')).toBe(4)
    expect(Object.values(decoded.inventoryReservations).some(row => row.orderId === orderId && row.itemId === itemId)).toBe(true)
  })

  it('убирает учебное меню и заказы, сохраняя пользовательские записи', () => {
    const { execute, state } = fixture()
    const product = {...state().products.cheesecake, id: 'actual-product', name: 'Позиция заведения', cost: 120}
    execute({ type: 'saveProduct', product }, admin)
    execute({ type: 'createOrder', orderId: 'actual-order', tableId: 'table-12', guestCount: 1 })
    const migrated = removeSampleData(state())
    expect(Object.keys(migrated.orders)).toEqual(['actual-order'])
    expect(Object.keys(migrated.products)).toEqual([product.id])
    expect(migrated.categories[product.categoryId]).toBeDefined()
    expect(migrated.tables['table-12']).toBeDefined()
    expect(migrated.users[admin.userId].active).toBe(true)
    expect(stats(migrated, 'day', undefined, timestamp + minute).sales).toBe(0)
    expect(removeSampleData(migrated)).toBe(migrated)
  })

  it('настраивает 20 столов, очищает каталог и начинает отчёт заново, сохраняя историю', () => {
    const previous = createDemoState(timestamp)
    previous.sampleDataRemoved = true
    const next = configureLocalVenue(previous, timestamp + minute)
    expect(Object.values(next.halls).map(hall => hall.name)).toEqual(['Зал'])
    expect(Object.values(next.tables).map(table => table.name)).toEqual(Array.from({length: 20}, (_, index) => String(index + 1)))
    expect(next.products).toEqual({})
    expect(next.inventory).toEqual({})
    expect(next.orders['demo-today-0']).toEqual(previous.orders['demo-today-0'])
    expect(stats(next, 'day', undefined, timestamp + minute)).toMatchObject({sales: 0, grossProfit: 0})
    expect(configureLocalVenue(next, timestamp + minute * 2)).toBe(next)
  })

  it('фиксирует себестоимость при отправке и учитывает заказ только после закрытия', () => {
    let state = emptyState()
    const run = (command: Command, id: string) => {
      state = applyCommand(state, admin, command, {id, now: timestamp})
    }
    run({type: 'registerUser'}, 'login')
    run({type: 'importMenu', json: JSON.stringify({products:[
      {name: 'Позиция', category: 'Меню', price: 150, cost: 40}
    ]})}, 'menu')
    const product = Object.values(state.products)[0]
    run({type: 'createOrder', orderId: 'order-a', tabName: 'Гость', guestCount: 1}, 'order')
    run({type: 'addItem', orderId: 'order-a', guestId: 'guest-1', itemId: 'item-a', productId: product.id, quantity: 2}, 'add')
    run({type: 'sendOrder', orderId: 'order-a'}, 'send')
    run({type: 'saveProduct', product: {...product, cost: 60}}, 'cost-change')
    run({type: 'readyItem', orderId: 'order-a', itemId: 'item-a'}, 'ready')
    run({type: 'serveItem', orderId: 'order-a', itemId: 'item-a'}, 'serve')
    expect(stats(state, 'day', undefined, timestamp).sales).toBe(0)
    run({type: 'closeOrder', orderId: 'order-a'}, 'close')
    expect(stats(state, 'day', undefined, timestamp)).toMatchObject({sales: 300, grossProfit: 220})
  })
})
