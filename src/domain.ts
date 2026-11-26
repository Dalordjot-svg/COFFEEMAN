import { buildMenuImport, MenuImportError } from './menu-import'

export type Role = 'waiter' | 'admin'
export type Session = { userId: string; deviceId: string; role: Role; name: string; demo?: boolean }
export type User = { id: string; name: string; role: Role; active: boolean; createdAt: number; lastSeenAt: number }
export type Device = { id: string; userId: string; createdAt: number; lastSeenAt: number }
export type Category = { id: string; name: string; color: string; sort: number; archived?: boolean }
export type Hall = { id: string; name: string; sort: number; archived?: boolean }
export type Table = { id: string; name: string; hallId: string; capacity: number; sort: number; waiterId?: string; archived?: boolean }
export type PriceOption = { id: string; name: string; price: number }
export type Modifier = { id: string; name: string; required?: boolean; multiple?: boolean; options: PriceOption[] }
export type Product = {
  id: string; name: string; categoryId: string; price: number; available: boolean; sort: number
  description?: string; imageUrl?: string; volume?: string; sizes?: PriceOption[]; modifierIds?: string[]; archived?: boolean
}
export type Inventory = { quantity: number | null; min?: number; updatedAt: number; revision?: number }
type InventoryInput = { quantity: number | null; min?: number; expectedRevision?: number }
export type Reservation = { id: string; orderId: string; itemId: string; productId: string; quantity: number; at: number }
export type InventoryTransaction = {
  id: string; operationId: string; productId: string; itemId?: string; orderId?: string
  type: 'reserve' | 'release' | 'serve' | 'adjust'; quantity: number; at: number
}
export type ItemStatus = 'draft' | 'preparing' | 'ready' | 'served' | 'canceled'
export type OrderItem = {
  id: string; guestId: string; productId: string; name: string; quantity: number; unitPrice: number
  sizeId?: string; sizeName?: string; optionIds: string[]; options: { name: string; price: number }[]
  comment?: string; status: ItemStatus; createdAt: number; sentAt?: number; readyAt?: number; servedAt?: number; canceledAt?: number
}
export type Order = {
  id: string; label: string; waiterId: string; guestIds: string[]; items: Record<string, OrderItem>
  tableId?: string; hallId?: string; createdAt: number; updatedAt: number; precheckAt?: number; closedAt?: number; canceledAt?: number
}
export type Notification = { id: string; type: 'ready' | 'stock'; message: string; at: number; userId?: string; orderId?: string; productId?: string }
export type Audit = { id: string; actorId: string; deviceId: string; type: Command['type']; at: number; orderId?: string; detail?: string }
export type Settings = { venueName: string; waitMinutes: number; criticalMinutes: number; prepMinutes: number; readyMinutes: number; defaultMin: number }
export type State = {
  schemaVersion: 1
  users: Record<string, User>
  devices: Record<string, Device>
  categories: Record<string, Category>
  products: Record<string, Product>
  modifiers: Record<string, Modifier>
  halls: Record<string, Hall>
  tables: Record<string, Table>
  orders: Record<string, Order>
  inventory: Record<string, Inventory>
  inventoryReservations: Record<string, Reservation>
  inventoryTransactions: Record<string, InventoryTransaction>
  notifications: Record<string, Notification>
  settings: Settings
  auditLogs: Record<string, Audit>
}

export type Command =
  | { type: 'registerUser' }
  | { type: 'createOrder'; orderId: string; tableId?: string; tabName?: string; guestCount: number }
  | { type: 'addGuest' | 'removeGuest'; orderId: string; guestId: string }
  | { type: 'addItem'; orderId: string; guestId: string; itemId: string; productId: string; quantity: number; sizeId?: string; optionIds?: string[]; comment?: string }
  | { type: 'editItem'; orderId: string; itemId: string; guestId?: string; quantity?: number; sizeId?: string; optionIds?: string[]; comment?: string }
  | { type: 'cancelItem' | 'readyItem' | 'serveItem'; orderId: string; itemId: string }
  | { type: 'sendOrder' | 'precheckOrder' | 'closeOrder' | 'cancelOrder' | 'reopenOrder' | 'readyOrder'; orderId: string }
  | ({ type: 'updateInventory'; productId: string; available?: boolean } & InventoryInput)
  | { type: 'saveProduct'; product: Product; inventory?: InventoryInput; modifiers?: Modifier[]; preserveAvailability?: boolean }
  | { type: 'saveCategory'; category: Category }
  | { type: 'saveModifier'; modifier: Modifier }
  | { type: 'saveHall'; hall: Hall }
  | { type: 'saveTable'; table: Table }
  | { type: 'updateUser'; userId: string; name?: string; active?: boolean }
  | { type: 'assignOrder'; orderId: string; waiterId: string }
  | { type: 'saveSettings'; settings: Settings }
  | { type: 'importMenu'; json: string }
  | { type: 'clearDemo' | 'seedDemo' }

type Stamp = { id: string; now: number }
type Candidate = Record<string, unknown>
export type OrderStatus = 'new' | 'preparing' | 'ready' | 'served' | 'precheck' | 'closed' | 'canceled'
export type Period = 'day' | 'week' | 'month'

export const defaultSettings: Settings = {
  venueName: 'COFFEEMAN', waitMinutes: 12, criticalMinutes: 25, prepMinutes: 15, readyMinutes: 5, defaultMin: 5,
}

export const orderStatusLabel: Record<OrderStatus, string> = {
  new: 'Новый заказ', preparing: 'Готовится', ready: 'Блюда готовы', served: 'Выдан',
  precheck: 'Заказ в пречеке', closed: 'Завершён', canceled: 'Отменён',
}

export function newId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function emptyState(): State {
  return {
    schemaVersion: 1, users: {}, devices: {}, categories: {}, products: {}, modifiers: {}, halls: {}, tables: {},
    orders: {}, inventory: {}, inventoryReservations: {}, inventoryTransactions: {}, notifications: {},
    settings: { ...defaultSettings }, auditLogs: {},
  }
}

export function entries<T>(record: Record<string, T> | null | undefined): T[] {
  return Object.values(record ?? {})
}

function isObject(value: unknown): value is Candidate {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function safeKey(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,600}$/.test(value) && !(value in Object.prototype)
}

function entityId(value: unknown): value is string {
  return safeKey(value) && value.length <= 180
}

function records<T>(value: unknown, accept: (value: Candidate) => boolean = () => true): Record<string, T> {
  if (!isObject(value) && !Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([key, row]) =>
    safeKey(key) && isObject(row) && (row.id === undefined || row.id === key) && accept(row))) as Record<string, T>
}

const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter(entityId) : []
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const positiveInteger = (value: unknown): value is number => numeric(value) && Number.isSafeInteger(value) && value > 0
const namedId = (value: Candidate) => safeKey(value.id) && typeof value.name === 'string'
const knownItemStatus = (status: unknown) => typeof status === 'string' &&
  ['draft', 'preparing', 'ready', 'served', 'canceled'].includes(status)

function timestamps<T extends object>(entity: T): T {
  return Object.fromEntries(Object.entries(entity).filter(([key, value]) =>
    !key.endsWith('At') || numeric(value))) as T
}

export function normalizeState(raw: unknown): State {
  const result = emptyState()
  if (!isObject(raw)) return result
  if (raw.schemaVersion && raw.schemaVersion !== result.schemaVersion) {
    throw new DomainError('Версия данных не поддерживается этим приложением')
  }
  result.users = records<User>(raw.users, row => namedId(row) && numeric(row.createdAt) && (row.role === 'admin' || row.role === 'waiter'))
  result.devices = records<Device>(raw.devices, row => safeKey(row.id) && safeKey(row.userId))
  result.categories = records<Category>(raw.categories, namedId)
  result.products = records<Product>(raw.products, row => namedId(row) && safeKey(row.categoryId) && numeric(row.price) && row.price >= 0)
  for (const [id, product] of Object.entries(result.products)) {
    result.products[id] = { ...product, sizes: normalizePriceOptions(product.sizes), modifierIds: stringArray(product.modifierIds) }
  }
  result.modifiers = records<Modifier>(raw.modifiers, namedId)
  for (const [id, modifier] of Object.entries(result.modifiers)) {
    result.modifiers[id] = { ...modifier, options: normalizePriceOptions(modifier.options) }
  }
  result.halls = records<Hall>(raw.halls, namedId)
  result.tables = records<Table>(raw.tables, row => namedId(row) && safeKey(row.hallId) && positiveInteger(row.capacity))
  result.orders = records<Order>(raw.orders, row => safeKey(row.id) && safeKey(row.waiterId) && numeric(row.createdAt) && typeof row.label === 'string')
  for (const [id, order] of Object.entries(result.orders)) {
    const items = records<OrderItem>(order.items, row => namedId(row) && safeKey(row.guestId) && safeKey(row.productId) &&
      positiveInteger(row.quantity) && numeric(row.unitPrice) && row.unitPrice >= 0 && knownItemStatus(row.status))
    for (const [itemId, item] of Object.entries(items)) {
      items[itemId] = timestamps({
        ...item,
        optionIds: stringArray(item.optionIds),
        options: Array.isArray(item.options) ? item.options.filter(option => isObject(option) &&
          typeof option.name === 'string' && numeric(option.price) && option.price >= 0) : [],
      })
    }
    result.orders[id] = timestamps({ ...order, guestIds: stringArray(order.guestIds), items })
  }
  result.inventory = records<Inventory>(raw.inventory)
  for (const [id, inventory] of Object.entries(result.inventory)) {
    const quantity = numeric(inventory.quantity) && Number.isSafeInteger(inventory.quantity) && inventory.quantity >= 0 ? inventory.quantity : null
    const min = numeric(inventory.min) && Number.isSafeInteger(inventory.min) && inventory.min >= 0 ? inventory.min : undefined
    result.inventory[id] = {
      quantity, ...(min === undefined ? {} : { min }), updatedAt: numeric(inventory.updatedAt) ? inventory.updatedAt : 0,
      ...(positiveInteger(inventory.revision) ? { revision: inventory.revision } : {}),
    }
  }
  result.inventoryReservations = records<Reservation>(raw.inventoryReservations, row => safeKey(row.id) && safeKey(row.productId) &&
    safeKey(row.orderId) && safeKey(row.itemId) && positiveInteger(row.quantity))
  result.inventoryTransactions = records<InventoryTransaction>(raw.inventoryTransactions, row => safeKey(row.id) && safeKey(row.productId) && numeric(row.at))
  result.notifications = records<Notification>(raw.notifications, row => safeKey(row.id) && typeof row.message === 'string' && numeric(row.at))
  result.auditLogs = records<Audit>(raw.auditLogs, row => safeKey(row.id) && safeKey(row.actorId) && numeric(row.at))
  if (isObject(raw.settings)) {
    const settings = raw.settings
    result.settings = {
      venueName: typeof settings.venueName === 'string' && settings.venueName.trim() ? settings.venueName : defaultSettings.venueName,
      waitMinutes: positiveInteger(settings.waitMinutes) ? settings.waitMinutes : defaultSettings.waitMinutes,
      criticalMinutes: positiveInteger(settings.criticalMinutes) ? settings.criticalMinutes : defaultSettings.criticalMinutes,
      prepMinutes: positiveInteger(settings.prepMinutes) ? settings.prepMinutes : defaultSettings.prepMinutes,
      readyMinutes: positiveInteger(settings.readyMinutes) ? settings.readyMinutes : defaultSettings.readyMinutes,
      defaultMin: numeric(settings.defaultMin) && Number.isSafeInteger(settings.defaultMin) && settings.defaultMin >= 0
        ? settings.defaultMin : defaultSettings.defaultMin,
    }
  }
  return result
}

function normalizePriceOptions(value: unknown): PriceOption[] {
  return Array.isArray(value)
    ? value.filter(row => isObject(row) && namedId(row) && numeric(row.price) && row.price >= 0) as PriceOption[]
    : []
}

const cents = (rubles: number) => Math.round(rubles * 100)

export function orderItems(order: Order): OrderItem[] {
  return entries(order.items).filter(item => item.status !== 'canceled')
}

export function orderTotal(order: Order): number {
  return orderItems(order).reduce((total, item) => total + cents(item.unitPrice) * item.quantity, 0) / 100
}

export function orderTitle(order: Order): string {
  return order.label
}

export function orderStatus(order: Order): OrderStatus {
  if (order.canceledAt !== undefined) return 'canceled'
  if (order.closedAt !== undefined) return 'closed'
  if (order.precheckAt !== undefined) return 'precheck'
  const items = orderItems(order)
  if (items.some(item => item.status === 'ready')) return 'ready'
  if (items.some(item => item.status === 'preparing')) return 'preparing'
  if (items.length && items.every(item => item.status === 'served')) return 'served'
  return 'new'
}

export function isActiveOrder(order: Order): boolean {
  return order.closedAt === undefined && order.canceledAt === undefined
}

function reservedQuantity(state: State, productId: string): number {
  return entries(state.inventoryReservations).reduce((total, row) => row.productId === productId ? total + row.quantity : total, 0)
}

export function availableQuantity(state: State, productId: string): number | null {
  const quantity = state.inventory[productId]?.quantity
  return quantity == null ? null : Math.max(0, quantity - reservedQuantity(state, productId))
}

export function stockStatus(state: State, productId: string): 'out' | 'low' | 'in' {
  const product = state.products[productId]
  const quantity = availableQuantity(state, productId)
  if (!product?.available || product.archived || quantity === 0) return 'out'
  const minimum = state.inventory[productId]?.min ?? state.settings.defaultMin
  return quantity !== null && quantity <= minimum ? 'low' : 'in'
}

export function stats(state: State, period: Period, userId?: string, now = Date.now()) {
  const date = new Date(now)
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  if (period === 'month') start.setDate(1)
  const series = period === 'day'
    ? Array.from({ length: 24 }, (_, index) => ({ label: `${String(index).padStart(2, '0')}:00`, value: 0 }))
    : Array.from({ length: period === 'week' ? 7 : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() }, (_, index) => ({
      label: period === 'week' ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][index] : String(index + 1), value: 0,
    }))
  let saleCents = 0
  let active = 0
  let orders = 0
  let guests = 0
  for (const order of entries(state.orders)) {
    if (userId && order.waiterId !== userId) continue
    if (isActiveOrder(order)) active++
    if (order.closedAt === undefined || order.closedAt < start.getTime() || order.closedAt > now || order.canceledAt !== undefined) continue
    orders++
    guests += order.guestIds.length
    const closed = new Date(order.closedAt)
    const index = period === 'day' ? closed.getHours() : period === 'week' ? (closed.getDay() + 6) % 7 : closed.getDate() - 1
    const amount = cents(orderTotal(order))
    saleCents += amount
    series[index].value += amount
  }
  return { sales: saleCents / 100, orders, active, guests, average: orders ? Math.round(saleCents / orders) / 100 : 0,
    series: series.map(point => ({ ...point, value: point.value / 100 })) }
}

export type OrderAlert = { orderId: string; reason: string; tone: 'yellow' | 'red' | 'green'; minutes: number }

export function orderAlerts(state: State, now = Date.now(), userId?: string): OrderAlert[] {
  const alerts: OrderAlert[] = []
  const minutesSince = (at: number) => Math.max(0, Math.floor((now - at) / 60_000))
  const { criticalMinutes, prepMinutes, readyMinutes, waitMinutes } = state.settings
  for (const order of entries(state.orders)) {
    if (!isActiveOrder(order) || (userId && order.waiterId !== userId)) continue
    const add = (reason: string, at: number, tone: OrderAlert['tone']) =>
      alerts.push({ orderId: order.id, reason, tone, minutes: minutesSince(at) })
    const thresholdTone = (minutes: number) => minutes >= criticalMinutes ? 'red' : 'yellow'
    const items = orderItems(order)
    if (order.precheckAt !== undefined) {
      add('Запрошен пречек', order.precheckAt, 'red')
      continue
    }
    const preparing = items.filter(item => item.status === 'preparing')
    const oldestSent = Math.min(...preparing.map(item => item.sentAt ?? item.createdAt))
    const preparingFor = minutesSince(oldestSent)
    const ready = items.filter(item => item.status === 'ready')
    const oldestReady = Math.min(...ready.map(item => item.readyAt ?? item.createdAt))
    if (ready.length && minutesSince(oldestReady) >= criticalMinutes) {
      add('Заказ готов, но не выдан', oldestReady, 'red')
    } else if (preparing.length && preparingFor >= prepMinutes) {
      add('Готовится дольше нормы', oldestSent, thresholdTone(preparingFor))
    } else if (ready.length) {
      add(minutesSince(oldestReady) >= readyMinutes ? 'Готовые блюда ждут выдачи' : 'Блюда готовы к выдаче', oldestReady, 'green')
    } else if ((!items.length || items.some(item => item.status === 'draft')) && minutesSince(order.updatedAt) >= waitMinutes) {
      add('Ожидает обслуживания', order.updatedAt, thresholdTone(minutesSince(order.updatedAt)))
    } else if (items.length && items.every(item => item.status === 'served') && minutesSince(order.updatedAt) >= waitMinutes) {
      add('Завершите обслуживание', order.updatedAt, thresholdTone(minutesSince(order.updatedAt)))
    }
  }
  const priority = { red: 0, yellow: 1, green: 2 }
  return alerts.sort((a, b) => priority[a.tone] - priority[b.tone] || b.minutes - a.minutes)
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new DomainError(message)
}

function checkId(id: unknown, message = 'Неверный идентификатор'): asserts id is string {
  requireCondition(entityId(id), message)
}

function checkText(value: unknown, field: string, max: number, optional = false): string {
  requireCondition(typeof value === 'string', `Укажите ${field}`)
  const trimmed = value.trim()
  requireCondition((optional || trimmed.length > 0) && trimmed.length <= max &&
    !/[\u0000-\u0008\u000e-\u001f\u007f]/.test(trimmed), `Проверьте поле «${field}»`)
  return trimmed
}

function checkNumber(value: unknown, min: number, max: number, field: string): number {
  requireCondition(numeric(value) && Number.isSafeInteger(value) && value >= min && value <= max, `Проверьте поле «${field}»`)
  return value
}

function checkPrice(value: unknown): number {
  requireCondition(numeric(value) && value >= 0 && value <= 1_000_000, 'Цена должна быть от 0 до 1 000 000 ₽')
  return cents(value) / 100
}

function checkFlag(value: unknown, field: string): boolean {
  requireCondition(typeof value === 'boolean', `Проверьте поле «${field}»`)
  return value
}

function checkImage(value: unknown): string {
  const image = checkText(value, 'ссылка на фото', 2048, true)
  if (!image) return image
  requireCondition(/^https?:\/\//i.test(image) || /^\/[^/\\]/.test(image), 'Укажите ссылку HTTP(S) на изображение')
  if (image.startsWith('/')) return image
  try {
    const url = new URL(image)
    requireCondition(!url.username && !url.password, 'Ссылка на фото не должна содержать данные для входа')
    return url.href
  } catch {
    throw new DomainError('Проверьте ссылку на фото')
  }
}

function checkPriceOptions(value: unknown, field: string): PriceOption[] {
  requireCondition(Array.isArray(value) && value.length <= 32, `Проверьте поле «${field}»`)
  const ids = new Set<string>()
  return value.map(row => {
    requireCondition(isObject(row), `Проверьте поле «${field}»`)
    checkId(row.id)
    requireCondition(!ids.has(row.id), 'У вариантов должны быть уникальные идентификаторы')
    ids.add(row.id)
    return { id: row.id, name: checkText(row.name, 'название варианта', 80), price: checkPrice(row.price) }
  })
}

function checkNamedEntity(entity: Category | Hall | Table) {
  requireCondition(isObject(entity), 'Проверьте заполнение формы')
  checkId(entity.id)
  return {
    id: entity.id,
    name: checkText(entity.name, 'название', 80),
    sort: checkNumber(entity.sort, 0, 99_999, 'порядок отображения'),
    archived: entity.archived === undefined ? false : checkFlag(entity.archived, 'архив'),
  }
}

function activeOrder(state: State, session: Session, id: string): Order {
  checkId(id)
  const order = state.orders[id]
  requireCondition(order, 'Заказ не найден')
  requireCondition(session.role === 'admin' || order.waiterId === session.userId, 'Заказ назначен другому официанту')
  requireCondition(isActiveOrder(order), 'Обслуживание по этому заказу завершено')
  return order
}

function editableOrder(state: State, session: Session, id: string): Order {
  const order = activeOrder(state, session, id)
  requireCondition(order.precheckAt === undefined, 'Возобновите обслуживание, чтобы изменить заказ')
  return order
}

function itemIn(order: Order, itemId: string): OrderItem {
  checkId(itemId)
  const item = order.items[itemId]
  requireCondition(item, 'Позиция не найдена')
  return item
}

function guestIn(order: Order, guestId: string) {
  checkId(guestId)
  requireCondition(order.guestIds.includes(guestId), 'Гость не найден')
}

function sellableProduct(state: State, productId: string, quantity: number): Product {
  checkId(productId)
  const product = state.products[productId]
  requireCondition(product?.available && !product.archived, 'Позиция недоступна для заказа')
  const available = availableQuantity(state, productId)
  requireCondition(available === null || available >= quantity, `Недостаточно порций «${product.name}». Доступно ${available ?? 0}`)
  return product
}

function selection(state: State, product: Product, sizeId?: string, optionIds: string[] = []) {
  const sizes = product.sizes ?? []
  const size = sizes.find(row => row.id === sizeId)
  requireCondition((!sizes.length && sizeId === undefined) || size, 'Выберите доступный размер')
  requireCondition(Array.isArray(optionIds) && optionIds.length <= 80 && optionIds.every(entityId), 'Проверьте модификаторы')
  const modifiers = (product.modifierIds ?? []).map(id => state.modifiers[id]).filter(Boolean)
  const desired = new Set(optionIds)
  requireCondition(desired.size === optionIds.length, 'Модификатор уже добавлен')
  const selected: PriceOption[] = []
  for (const modifier of modifiers) {
    const options = modifier.options.filter(option => desired.has(option.id))
    requireCondition(!modifier.required || options.length, `Выберите «${modifier.name}»`)
    requireCondition(modifier.multiple || options.length <= 1, `Выберите один вариант «${modifier.name}»`)
    selected.push(...options)
  }
  requireCondition(selected.length === desired.size, 'Выбранный модификатор недоступен')
  const unitPrice = (cents(size?.price ?? product.price) + selected.reduce((total, option) => total + cents(option.price), 0)) / 100
  return {
    unitPrice,
    ...(size ? { sizeId: size.id, sizeName: size.name } : {}),
    optionIds: selected.map(option => option.id),
    options: selected.map(option => ({ name: option.name, price: option.price })),
  }
}

function saveInventory(state: State, productId: string, input: InventoryInput, stamp: Stamp) {
  const current = state.inventory[productId]
  const revision = current?.revision ?? 0
  requireCondition(input.expectedRevision === undefined || input.expectedRevision === revision,
    'Остаток изменился на другом устройстве. Откройте форму заново')
  const quantity = input.quantity === null ? null : checkNumber(input.quantity, 0, 1_000_000, 'остаток')
  const min = input.min === undefined ? current?.min : checkNumber(input.min, 0, 1_000_000, 'минимальный остаток')
  const reserved = reservedQuantity(state, productId)
  requireCondition(quantity === null || quantity >= reserved, `В заказах зарезервировано ${reserved} порций. Укажите остаток не меньше резерва`)
  state.inventory[productId] = { quantity, ...(min === undefined ? {} : { min }), updatedAt: stamp.now, revision: revision + 1 }
  if ((current?.quantity ?? null) !== quantity) {
    const id = eventKey('adjust', stamp.id, productId)
    state.inventoryTransactions[id] = { id, operationId: stamp.id, productId, type: 'adjust',
      quantity: (quantity ?? 0) - (current?.quantity ?? 0), at: stamp.now }
  }
}

function reservationKey(order: Order, item: OrderItem): string {
  return `${order.id.length}_${order.id}_${item.id}`
}

function eventKey(kind: string, operationId: string, entityId: string): string {
  return `${kind}_${operationId.length}_${operationId}_${entityId}`
}

function inventoryMovement(state: State, stamp: Stamp, order: Order, item: OrderItem, type: 'reserve' | 'release' | 'serve') {
  const key = reservationKey(order, item)
  if (type === 'reserve') {
    state.inventoryReservations[key] = { id: key, orderId: order.id, itemId: item.id, productId: item.productId, quantity: item.quantity, at: stamp.now }
  } else {
    const reservation = state.inventoryReservations[key]
    requireCondition(reservation && reservation.quantity === item.quantity, 'Резерв позиции отсутствует или изменился')
    const inventory = state.inventory[item.productId]
    if (type === 'serve' && inventory?.quantity != null) {
      requireCondition(inventory.quantity >= item.quantity, 'Недостаточно остатка для выдачи')
      state.inventory[item.productId] = {
        ...inventory, quantity: inventory.quantity - item.quantity, updatedAt: stamp.now, revision: (inventory.revision ?? 0) + 1,
      }
    }
    delete state.inventoryReservations[key]
  }
  const id = eventKey(type, stamp.id, item.id)
  state.inventoryTransactions[id] = {
    id, operationId: stamp.id, productId: item.productId, itemId: item.id, orderId: order.id,
    type, quantity: item.quantity, at: stamp.now,
  }
}

function markReady(state: State, order: Order, item: OrderItem, stamp: Stamp) {
  item.status = 'ready'
  item.readyAt = stamp.now
  const id = eventKey('ready', stamp.id, item.id)
  state.notifications[id] = {
    id, type: 'ready', message: `${order.label} · ${item.name} готово к выдаче`,
    userId: order.waiterId, orderId: order.id, at: stamp.now,
  }
}

function saveModifier(state: State, modifier: Modifier) {
  requireCondition(isObject(modifier), 'Проверьте заполнение модификатора')
  checkId(modifier.id)
  const options = checkPriceOptions(modifier.options, 'варианты модификатора')
  requireCondition(options.length, 'Укажите хотя бы один вариант модификатора')
  const optionIds = new Set(options.map(option => option.id))
  requireCondition(!entries(state.modifiers).some(row => row.id !== modifier.id && row.options.some(option => optionIds.has(option.id))),
    'Варианты разных модификаторов должны иметь уникальные идентификаторы')
  state.modifiers[modifier.id] = { id: modifier.id, name: checkText(modifier.name, 'название модификатора', 80), options,
    required: modifier.required === undefined ? false : checkFlag(modifier.required, 'обязательный выбор'),
    multiple: modifier.multiple === undefined ? false : checkFlag(modifier.multiple, 'множественный выбор') }
}

function checkAvailableWaiter(state: State, userId: string) {
  checkId(userId)
  requireCondition(state.users[userId]?.active && state.users[userId].role === 'waiter', 'Выберите действующего официанта')
}

function stockUpdates(before: State, after: State, stamp: Stamp, ids: Set<string>) {
  for (const id of ids) {
    const product = after.products[id]
    if (!product || product.archived) continue
    const from = stockStatus(before, id)
    const to = stockStatus(after, id)
    if (from === to || (to === 'in' && from !== 'out')) continue
    const notificationId = eventKey('stock', stamp.id, id)
    const status = { out: 'закончился или снят с продажи', low: 'скоро закончится', in: 'снова в наличии' }[to]
    after.notifications[notificationId] = { id: notificationId, type: 'stock', message: `${product.name} · ${status}`,
      at: stamp.now, productId: id }
  }
}

const adminCommands: ReadonlySet<Command['type']> = new Set([
  'saveProduct', 'saveCategory', 'saveModifier', 'saveHall', 'saveTable', 'updateUser', 'assignOrder', 'saveSettings', 'importMenu', 'clearDemo', 'seedDemo',
])

function importEntityId(record: Record<string, unknown>, operationId: string, position: number) {
  const base = `menu-${operationId.slice(0, 130)}-${position + 1}`
  let id = base
  let collision = 0
  while (Object.hasOwn(record, id)) id = `${base}-${++collision}`
  return id
}

export function applyCommand(previous: State, session: Session, command: Command, stamp: Stamp): State {
  checkId(stamp.id)
  checkId(session.userId)
  checkId(session.deviceId)
  requireCondition(numeric(stamp.now) && stamp.now > 0, 'Неверное время операции')
  requireCondition(isObject(command) && typeof command.type === 'string', 'Неизвестная операция')
  requireCondition(session.role === 'admin' || session.role === 'waiter', 'Вход в систему не выполнен')
  const actor = previous.users[session.userId]
  if (command.type !== 'registerUser') {
    requireCondition(actor?.active && actor.role === session.role, 'Сессия больше не активна')
    requireCondition(!adminCommands.has(command.type) || actor.role === 'admin', 'Действие доступно администратору')
  }
  const replay = previous.auditLogs[stamp.id]
  if (replay) {
    requireCondition(replay.actorId === session.userId && replay.type === command.type, 'Идентификатор операции уже использован')
    return previous
  }

  let state = structuredClone(previous)
  const inventoryIds = new Set<string>()
  let orderId: string | undefined
  let detail: string | undefined

  switch (command.type) {
    case 'registerUser': {
      const name = checkText(session.name, 'имя', 80)
      requireCondition(!actor || (actor.active && actor.role === session.role), 'Учётная запись недоступна')
      const device = state.devices[session.deviceId]
      state.users[session.userId] = { id: session.userId, name: actor?.name ?? name, role: session.role,
        active: true, createdAt: actor?.createdAt ?? stamp.now, lastSeenAt: stamp.now }
      state.devices[session.deviceId] = { id: session.deviceId, userId: session.userId,
        createdAt: device?.createdAt ?? stamp.now, lastSeenAt: stamp.now }
      break
    }
    case 'createOrder': {
      checkId(command.orderId)
      const guests = checkNumber(command.guestCount, 1, 100, 'количество гостей')
      requireCondition(!state.orders[command.orderId], 'Заказ уже создан')
      let location: Pick<Order, 'label' | 'tableId' | 'hallId'>
      if (command.tableId !== undefined) {
        requireCondition(command.tabName === undefined, 'Выберите стол или именной таб')
        checkId(command.tableId)
        const table = state.tables[command.tableId]
        const hall = table && state.halls[table.hallId]
        requireCondition(table && hall && !table.archived && !hall.archived, 'Стол недоступен')
        requireCondition(!entries(state.orders).some(order => order.tableId === table.id && isActiveOrder(order)), 'У стола уже есть активный заказ')
        const label = /^стол\s/i.test(table.name) ? table.name : `Стол ${table.name}`
        location = { label, tableId: table.id, hallId: table.hallId }
      } else {
        location = { label: checkText(command.tabName, 'название таба', 80) }
      }
      orderId = command.orderId
      const guestIds = Array.from({ length: guests }, (_, index) => `guest-${index + 1}`)
      state.orders[orderId] = { ...location, id: orderId, waiterId: session.userId, guestIds, items: {},
        createdAt: stamp.now, updatedAt: stamp.now }
      break
    }
    case 'addGuest':
    case 'removeGuest': {
      const order = editableOrder(state, session, command.orderId)
      if (command.type === 'addGuest') {
        checkId(command.guestId)
        requireCondition(!order.guestIds.includes(command.guestId) && order.guestIds.length < 100, 'Невозможно добавить гостя')
        order.guestIds.push(command.guestId)
      } else {
        guestIn(order, command.guestId)
        requireCondition(order.guestIds.length > 1 && !orderItems(order).some(item => item.guestId === command.guestId),
          'Можно удалить только пустого гостя. В заказе должен остаться хотя бы один гость')
        order.guestIds = order.guestIds.filter(id => id !== command.guestId)
      }
      orderId = order.id
      break
    }
    case 'addItem': {
      const order = editableOrder(state, session, command.orderId)
      guestIn(order, command.guestId)
      checkId(command.itemId)
      requireCondition(!order.items[command.itemId], 'Позиция уже добавлена')
      const quantity = checkNumber(command.quantity, 1, 999, 'количество порций')
      const product = sellableProduct(state, command.productId, quantity)
      const comment = command.comment === undefined ? '' : checkText(command.comment, 'комментарий', 500, true)
      order.items[command.itemId] = {
        id: command.itemId, guestId: command.guestId, productId: product.id, name: product.name, quantity,
        ...selection(state, product, command.sizeId, command.optionIds),
        ...(comment ? { comment } : {}), status: 'draft', createdAt: stamp.now,
      }
      orderId = order.id
      detail = product.name
      break
    }
    case 'editItem': {
      const order = editableOrder(state, session, command.orderId)
      const item = itemIn(order, command.itemId)
      requireCondition(item.status !== 'canceled' && item.status !== 'served', 'Позицию уже нельзя редактировать')
      if (command.guestId !== undefined) {
        guestIn(order, command.guestId)
        item.guestId = command.guestId
      }
      const changeSelection = command.sizeId !== undefined || command.optionIds !== undefined
      const quantityChanged = command.quantity !== undefined && command.quantity !== item.quantity
      if (quantityChanged || changeSelection || command.comment !== undefined) {
        requireCondition(item.status === 'draft', 'После отправки можно только переместить позицию к другому гостю')
        const quantity = command.quantity === undefined ? item.quantity : checkNumber(command.quantity, 1, 999, 'количество порций')
        if (quantityChanged || changeSelection) {
          const product = sellableProduct(state, item.productId, quantity)
          item.quantity = quantity
          if (changeSelection) {
            const selected = selection(state, product, command.sizeId ?? item.sizeId, command.optionIds ?? item.optionIds)
            delete item.sizeId
            delete item.sizeName
            Object.assign(item, selected)
          }
        }
        if (command.comment !== undefined) {
          const comment = checkText(command.comment, 'комментарий', 500, true)
          if (comment) item.comment = comment
          else delete item.comment
        }
      }
      orderId = order.id
      detail = item.name
      break
    }
    case 'cancelItem':
    case 'readyItem':
    case 'serveItem': {
      const order = activeOrder(state, session, command.orderId)
      const item = itemIn(order, command.itemId)
      if (command.type === 'cancelItem') {
        if (item.status === 'canceled') return previous
        requireCondition(order.precheckAt === undefined && item.status !== 'served', 'Выданную позицию нельзя отменить')
        if (item.status !== 'draft') {
          inventoryMovement(state, stamp, order, item, 'release')
          inventoryIds.add(item.productId)
        }
        item.status = 'canceled'
        item.canceledAt = stamp.now
      } else if (command.type === 'readyItem') {
        if (item.status === 'ready' || item.status === 'served') return previous
        requireCondition(item.status === 'preparing', 'Сначала отправьте позицию на приготовление')
        markReady(state, order, item, stamp)
      } else {
        if (item.status === 'served') return previous
        requireCondition(item.status === 'ready', 'Сначала отметьте позицию готовой')
        inventoryMovement(state, stamp, order, item, 'serve')
        inventoryIds.add(item.productId)
        item.status = 'served'
        item.servedAt = stamp.now
      }
      orderId = order.id
      detail = item.name
      break
    }
    case 'sendOrder': {
      const order = editableOrder(state, session, command.orderId)
      const draft = orderItems(order).filter(item => item.status === 'draft')
      requireCondition(draft.length, 'Добавьте позиции для отправки')
      const totals = new Map<string, number>()
      for (const item of draft) totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity)
      for (const [productId, quantity] of totals) sellableProduct(state, productId, quantity)
      for (const item of draft) {
        inventoryMovement(state, stamp, order, item, 'reserve')
        inventoryIds.add(item.productId)
        item.status = 'preparing'
        item.sentAt = stamp.now
      }
      orderId = order.id
      detail = `Позиций: ${draft.length}`
      break
    }
    case 'readyOrder': {
      const order = activeOrder(state, session, command.orderId)
      const preparing = orderItems(order).filter(item => item.status === 'preparing')
      if (!preparing.length) return previous
      for (const item of preparing) markReady(state, order, item, stamp)
      orderId = order.id
      break
    }
    case 'precheckOrder':
    case 'closeOrder': {
      const order = activeOrder(state, session, command.orderId)
      const items = orderItems(order)
      requireCondition(items.length && items.every(item => item.status === 'served'), 'Выдайте все позиции перед завершением обслуживания')
      if (command.type === 'precheckOrder') {
        if (order.precheckAt !== undefined) return previous
        order.precheckAt = stamp.now
      } else {
        order.closedAt = stamp.now
      }
      orderId = order.id
      break
    }
    case 'cancelOrder': {
      const order = editableOrder(state, session, command.orderId)
      const items = orderItems(order)
      requireCondition(!items.some(item => item.status === 'served'), 'Нельзя отменить заказ с выданными позициями')
      for (const item of items) {
        if (item.status !== 'draft') {
          inventoryMovement(state, stamp, order, item, 'release')
          inventoryIds.add(item.productId)
        }
        item.status = 'canceled'
        item.canceledAt = stamp.now
      }
      order.canceledAt = stamp.now
      orderId = order.id
      break
    }
    case 'reopenOrder': {
      const order = activeOrder(state, session, command.orderId)
      if (order.precheckAt === undefined) return previous
      delete order.precheckAt
      orderId = order.id
      break
    }
    case 'updateInventory': {
      checkId(command.productId)
      const product = state.products[command.productId]
      requireCondition(product && !product.archived, 'Товар не найден')
      saveInventory(state, product.id, command, stamp)
      if (command.available !== undefined) product.available = checkFlag(command.available, 'доступность')
      inventoryIds.add(product.id)
      detail = product.name
      break
    }
    case 'saveProduct': {
      const incoming = command.product
      requireCondition(isObject(incoming), 'Проверьте заполнение товара')
      checkId(incoming.id)
      checkId(incoming.categoryId)
      const category = state.categories[incoming.categoryId]
      requireCondition(category && (incoming.archived === true || !category.archived), 'Выберите действующую категорию')
      if (command.modifiers !== undefined) {
        requireCondition(Array.isArray(command.modifiers) && command.modifiers.length <= 20, 'Проверьте модификаторы')
        for (const modifier of command.modifiers) saveModifier(state, modifier)
      }
      const modifierIds = incoming.modifierIds ?? []
      requireCondition(Array.isArray(modifierIds) && modifierIds.length <= 20 &&
        modifierIds.every(id => entityId(id) && state.modifiers[id]) && new Set(modifierIds).size === modifierIds.length,
      'Проверьте модификаторы')
      const imageUrl = incoming.imageUrl === undefined ? '' : checkImage(incoming.imageUrl)
      const description = incoming.description === undefined ? '' : checkText(incoming.description, 'описание', 1200, true)
      const volume = incoming.volume === undefined ? '' : checkText(incoming.volume, 'размер или объём', 80, true)
      const existing = state.products[incoming.id]
      const product: Product = {
        id: incoming.id,
        name: checkText(incoming.name, 'название', 120),
        categoryId: incoming.categoryId,
        price: checkPrice(incoming.price),
        available: existing && command.preserveAvailability === true ? existing.available : checkFlag(incoming.available, 'доступность'),
        archived: incoming.archived === undefined ? false : checkFlag(incoming.archived, 'архив'),
        sort: checkNumber(incoming.sort, 0, 99_999, 'порядок отображения'),
        sizes: incoming.sizes === undefined ? [] : checkPriceOptions(incoming.sizes, 'размеры'),
        modifierIds: [...modifierIds],
        ...(imageUrl ? { imageUrl } : {}),
        ...(description ? { description } : {}),
        ...(volume ? { volume } : {}),
      }
      state.products[product.id] = product
      if (command.inventory !== undefined) {
        requireCondition(isObject(command.inventory), 'Проверьте остаток')
        saveInventory(state, product.id, command.inventory, stamp)
      }
      inventoryIds.add(product.id)
      detail = product.name
      break
    }
    case 'saveCategory': {
      const category = checkNamedEntity(command.category)
      const color = command.category.color
      requireCondition(typeof color === 'string' && /^#[a-f\d]{6}$/i.test(color), 'Выберите цвет категории')
      if (category.archived) {
        requireCondition(!entries(state.products).some(product => product.categoryId === category.id && !product.archived),
          'Сначала перенесите или архивируйте активные товары категории')
      }
      state.categories[category.id] = { ...category, color }
      detail = category.name
      break
    }
    case 'saveModifier':
      saveModifier(state, command.modifier)
      detail = command.modifier.name
      break
    case 'saveHall': {
      const hall = checkNamedEntity(command.hall)
      requireCondition(!hall.archived || !entries(state.orders).some(order => order.hallId === hall.id && isActiveOrder(order)),
        'В зале есть незавершённые заказы')
      state.halls[hall.id] = hall
      detail = hall.name
      break
    }
    case 'saveTable': {
      const table = checkNamedEntity(command.table)
      const hallId = command.table.hallId
      checkId(hallId)
      const hall = state.halls[hallId]
      requireCondition(hall && (table.archived || !hall.archived), 'Выберите действующий зал')
      const waiterId = command.table.waiterId
      if (waiterId !== undefined) checkAvailableWaiter(state, waiterId)
      const active = entries(state.orders).some(order => order.tableId === table.id && isActiveOrder(order))
      requireCondition(!active || (!table.archived && state.tables[table.id]?.hallId === hallId),
        'Сначала завершите активный заказ этого стола')
      requireCondition(table.archived || !entries(state.tables).some(existing => existing.id !== table.id && existing.hallId === hallId &&
        !existing.archived && existing.name.toLowerCase() === table.name.toLowerCase()), 'В зале уже есть стол с таким названием')
      state.tables[table.id] = { ...table, hallId, capacity: checkNumber(command.table.capacity, 1, 100, 'вместимость'),
        ...(waiterId === undefined ? {} : { waiterId }) }
      detail = table.name
      break
    }
    case 'updateUser': {
      checkId(command.userId)
      const user = state.users[command.userId]
      requireCondition(user, 'Сотрудник не найден')
      if (command.name !== undefined) user.name = checkText(command.name, 'имя', 80)
      if (command.active !== undefined) {
        requireCondition(user.id !== session.userId || command.active, 'Свой профиль нельзя деактивировать')
        user.active = checkFlag(command.active, 'доступ сотрудника')
      }
      detail = user.name
      break
    }
    case 'assignOrder': {
      const order = activeOrder(state, session, command.orderId)
      checkAvailableWaiter(state, command.waiterId)
      order.waiterId = command.waiterId
      for (const notification of entries(state.notifications)) {
        if (notification.orderId === order.id) notification.userId = command.waiterId
      }
      orderId = order.id
      detail = state.users[command.waiterId].name
      break
    }
    case 'saveSettings': {
      const settings = command.settings
      requireCondition(isObject(settings), 'Проверьте системные настройки')
      const waitMinutes = checkNumber(settings.waitMinutes, 1, 1440, 'ожидание обслуживания')
      const prepMinutes = checkNumber(settings.prepMinutes, 1, 1440, 'время приготовления')
      const readyMinutes = checkNumber(settings.readyMinutes, 1, 1440, 'ожидание выдачи')
      const criticalMinutes = checkNumber(settings.criticalMinutes, 1, 1440, 'критическое ожидание')
      requireCondition(criticalMinutes >= Math.max(waitMinutes, prepMinutes, readyMinutes),
        'Критический порог не может быть меньше остальных порогов ожидания')
      state.settings = {
        venueName: checkText(settings.venueName, 'название заведения', 100), waitMinutes, prepMinutes, readyMinutes, criticalMinutes,
        defaultMin: checkNumber(settings.defaultMin, 0, 1_000_000, 'минимальный остаток'),
      }
      break
    }
    case 'importMenu': {
      let plan: ReturnType<typeof buildMenuImport>
      try {
        plan = buildMenuImport(state, command.json)
      } catch (error) {
        if (error instanceof MenuImportError) throw new DomainError(error.message)
        throw error
      }
      const nextSort = (rows: { sort: number }[]) => rows.reduce((last, entity) => Math.max(last, entity.sort), -1) + 1
      const categorySort = nextSort(entries(state.categories))
      plan.categories.forEach(({ key, name, color }, index) => {
        const id = importEntityId(state.categories, stamp.id, index)
        state.categories[id] = { id, name, color, sort: Math.min(99_999, categorySort + index) }
        plan.categoryIds.set(key, id)
      })
      const productSort = nextSort(entries(state.products))
      plan.products.forEach(({ categoryKey, inventory, ...product }, index) => {
        const categoryId = plan.categoryIds.get(categoryKey)
        requireCondition(categoryId, 'Категория импортируемого товара недоступна')
        const id = importEntityId(state.products, stamp.id, index)
        state.products[id] = { id, categoryId, sort: Math.min(99_999, productSort + index), ...product }
        if (inventory) saveInventory(state, id, inventory, stamp)
      })
      const { categoryCount, productCount, skippedCount } = plan.preview
      detail = `Категорий добавлено: ${categoryCount}. Товаров добавлено: ${productCount}. Пропущено: ${skippedCount}`
      break
    }
    case 'clearDemo': {
      requireCondition(session.demo === true, 'Операция доступна только в деморежиме')
      state = { ...emptyState(), users: state.users, devices: state.devices, settings: state.settings }
      break
    }
    case 'seedDemo': {
      requireCondition(session.demo === true, 'Операция доступна только в деморежиме')
      mergeDemo(state, stamp.now)
      break
    }
    default:
      throw new DomainError('Неизвестная операция')
  }

  if (orderId) state.orders[orderId].updatedAt = stamp.now
  stockUpdates(previous, state, stamp, inventoryIds)
  state.auditLogs[stamp.id] = {
    id: stamp.id, actorId: session.userId, deviceId: session.deviceId, type: command.type, at: stamp.now,
    ...(orderId ? { orderId } : {}), ...(detail ? { detail } : {}),
  }
  return state
}

function mergeDemo(state: State, now: number) {
  const demo = createDemoState(now)
  state.users = { ...demo.users, ...state.users }
  state.categories = { ...demo.categories, ...state.categories }
  state.products = { ...demo.products, ...state.products }
  state.modifiers = { ...demo.modifiers, ...state.modifiers }
  state.halls = { ...demo.halls, ...state.halls }
  state.tables = { ...demo.tables, ...state.tables }
  state.inventory = { ...demo.inventory, ...state.inventory }
  for (const order of entries(demo.orders)) {
    if (state.orders[order.id] || (order.tableId && isActiveOrder(order) && entries(state.orders).some(existing =>
      existing.tableId === order.tableId && isActiveOrder(existing)))) continue
    const reservations = entries(demo.inventoryReservations).filter(row => row.orderId === order.id)
    const counts = new Map<string, number>()
    for (const row of reservations) counts.set(row.productId, (counts.get(row.productId) ?? 0) + row.quantity)
    const feasible = [...counts].every(([id, count]) => {
      const available = availableQuantity(state, id)
      return available === null || available >= count
    })
    if (!feasible) continue
    state.orders[order.id] = order
    for (const row of reservations) state.inventoryReservations[row.id] = row
  }
}

export function createDemoState(now = Date.now()): State {
  const state = emptyState()
  const minute = 60_000
  const day = 24 * 60 * minute
  const staff = [
    { id: 'demo-pasha', name: 'Паша' },
    { id: 'demo-anna', name: 'Анна' },
    { id: 'demo-lev', name: 'Лев' },
  ]
  for (const { id, name } of staff) {
    state.users[id] = { id, name, active: true, role: 'waiter', createdAt: now - 28 * day, lastSeenAt: now - 10 * minute }
  }

  const categories: [string, string, string][] = [
    ['coffee', 'Кофе', '#a57a3c'], ['desserts', 'Десерты', '#665f7b'], ['mains', 'Основные блюда', '#53637f'],
    ['soups', 'Супы', '#6d5f68'], ['salads', 'Салаты', '#496d63'], ['snacks', 'Закуски', '#645b77'],
    ['cold', 'Холодные напитки', '#417271'], ['tea', 'Горячие напитки', '#8c5a3f'],
    ['sauces', 'Соусы', '#786255'],
  ]
  categories.forEach(([id, name, color], sort) => { state.categories[id] = { id, name, color, sort } })
  state.modifiers.milk = { id: 'milk', name: 'Молоко', required: true, options: [
    { id: 'milk-regular', name: 'Обычное', price: 0 },
    { id: 'milk-oat', name: 'Овсяное', price: 40 },
    { id: 'milk-coconut', name: 'Кокосовое', price: 45 },
  ] }
  state.modifiers.syrup = { id: 'syrup', name: 'Сироп', options: [
    { id: 'syrup-vanilla', name: 'Ваниль', price: 30 },
    { id: 'syrup-caramel', name: 'Карамель', price: 30 },
  ] }
  state.modifiers.sugar = { id: 'sugar', name: 'Сахар', options: [{ id: 'sugar-yes', name: 'Добавить сахар', price: 0 }] }

  const catalog: [string, string, string, number, number | null, number?][] = [
    ['latte', 'Латте', 'coffee', 190, null],
    ['cappuccino', 'Капучино', 'coffee', 220, null],
    ['raf', 'Раф ванильный', 'coffee', 280, null],
    ['cheesecake', 'Чизкейк', 'desserts', 345, 5, 2],
    ['tiramisu', 'Тирамису', 'desserts', 310, 8, 2],
    ['roll', 'Меренговый рулет', 'desserts', 460, 8, 2],
    ['brulee', 'Крем-брюле', 'desserts', 290, 12, 3],
    ['burger', 'Бургер', 'mains', 320, 18, 4],
    ['fries', 'Картофель фри', 'snacks', 100, 14, 2],
    ['prawns', 'Креветки и руккола', 'salads', 490, 4, 4],
    ['calamari', 'Кальмары гриль', 'mains', 540, 6, 6],
    ['satsibeli', 'Сацебели', 'sauces', 80, 0, 2],
    ['mushroom', 'Грибной крем-суп', 'soups', 320, 12, 2],
    ['matcha', 'Матча', 'tea', 290, null],
    ['lemonade', 'Домашний лимонад', 'cold', 260, 14, 3],
    ['tea', 'Чёрный чай', 'tea', 170, null],
  ]
  catalog.forEach(([id, name, categoryId, price, quantity, min], sort) => {
    state.products[id] = { id, name, categoryId, price, available: true, sort }
    state.inventory[id] = { quantity, ...(min === undefined ? {} : { min }), updatedAt: now - day }
  })
  Object.assign(state.products.latte, {
    description: 'Эспрессо с мягкой молочной пеной',
    volume: '350 мл',
    sizes: [{ id: 'latte-350', name: '350 мл', price: 190 }, { id: 'latte-450', name: '450 мл', price: 230 }],
    modifierIds: ['milk', 'syrup', 'sugar'],
  })

  const halls: [string, string, string[]][] = [
    ['hall-1', '1. Зал', [...Array.from({ length: 19 }, (_, index) => String(11 + index)), 'STAFF']],
    ['bar', 'Бар', ['Б1', 'Б2', 'Б3', 'Б4', 'Б5', 'Б6']],
    ['terrace', 'Терраса', ['Т1', 'Т2', 'Т3', 'Т4', 'Т5', 'Т6', 'Т7', 'Т8']],
  ]
  halls.forEach(([id, name, labels], sort) => {
    state.halls[id] = { id, name, sort }
    labels.forEach((label, index) => {
      const tableId = id === 'hall-1' ? `table-${label}` : `table-${id}-${index + 1}`
      state.tables[tableId] = { id: tableId, name: label, hallId: id, capacity: index % 4 === 0 ? 6 : 4,
        sort: index, waiterId: staff[Math.floor(index / 8) % staff.length].id }
    })
  })

  function fixture(input: {
    id: string; products: [string, number][]; waiterId: string; guestCount: number; at: number; status: ItemStatus
    tableId?: string; label?: string; closed?: boolean; precheck?: boolean; readyAgo?: number
  }) {
    const table = input.tableId ? state.tables[input.tableId] : undefined
    const guestIds = Array.from({ length: input.guestCount }, (_, index) => `guest-${index + 1}`)
    const readyAt = input.readyAgo !== undefined ? now - input.readyAgo * minute : input.at + minute
    const order: Order = {
      id: input.id, label: input.label ?? `Стол ${table?.name ?? '11'}`, waiterId: input.waiterId, guestIds,
      ...(table ? { tableId: table.id, hallId: table.hallId } : {}), items: {}, createdAt: input.at, updatedAt: input.at,
      ...(input.closed ? { closedAt: input.at + 3 * minute } : {}),
      ...(input.precheck ? { precheckAt: input.at + 2 * minute } : {}),
    }
    input.products.forEach(([productId, quantity], index) => {
      const product = state.products[productId]
      const item = {
        id: `item-${index + 1}`, guestId: guestIds[index % guestIds.length], productId, name: product.name,
        quantity, status: input.status, createdAt: input.at, unitPrice: product.price, optionIds: [], options: [],
        ...(productId === 'latte' ? { sizeId: 'latte-350', sizeName: '350 мл', optionIds: ['milk-regular'],
          options: [{ name: 'Обычное', price: 0 }] } : {}),
        ...(input.status !== 'draft' ? { sentAt: input.at } : {}),
        ...(input.status === 'ready' || input.status === 'served' ? { readyAt } : {}),
        ...(input.status === 'served' ? { servedAt: input.at + 2 * minute } : {}),
      }
      order.items[item.id] = item
      if (item.status === 'preparing' || item.status === 'ready') {
        const id = reservationKey(order, item)
        state.inventoryReservations[id] = { id, orderId: order.id, itemId: item.id, productId, quantity, at: input.at }
      }
    })
    state.orders[order.id] = order
  }

  const pasha = staff[0].id
  fixture({ id: 'demo-order-17', tableId: 'table-17', products: [['cappuccino', 1], ['cheesecake', 1], ['latte', 1]],
    waiterId: pasha, guestCount: 2, at: now - 3 * minute, status: 'draft' })
  fixture({ id: 'demo-order-11', tableId: 'table-11', products: [['latte', 1], ['burger', 1], ['fries', 1]],
    waiterId: pasha, guestCount: 2, at: now - 9 * minute, status: 'preparing' })
  state.orders['demo-order-11'].items['item-3'].guestId = 'guest-2'
  fixture({ id: 'demo-order-29', tableId: 'table-29', products: [['raf', 1], ['tiramisu', 1]],
    waiterId: pasha, guestCount: 2, at: now - 12 * minute, status: 'ready', readyAgo: 5 })
  fixture({ id: 'demo-order-27', tableId: 'table-27', products: [['latte', 1], ['roll', 1]], waiterId: staff[1].id,
    guestCount: 2, at: now - 20 * minute, status: 'served', precheck: true })
  fixture({ id: 'demo-order-14', tableId: 'table-14', products: [['cappuccino', 1], ['matcha', 1]], waiterId: pasha,
    guestCount: 2, at: now - 16 * minute, status: 'preparing' })
  fixture({ id: 'demo-order-tab', label: 'Таб 5', products: [['tea', 1], ['brulee', 1]], waiterId: staff[2].id,
    guestCount: 1, at: now - 12 * minute, status: 'draft' })
  state.notifications['ready-demo-order-29'] = { id: 'ready-demo-order-29', type: 'ready', orderId: 'demo-order-29', userId: pasha,
    at: now - 5 * minute, message: 'Стол 29 · Блюда готовы к выдаче' }

  const today = new Date(now)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const elapsed = Math.max(0, now - todayStart - 4 * minute)
  const series: [string, number][][] = [
    [['latte', 2], ['cheesecake', 1]], [['burger', 2], ['fries', 2], ['lemonade', 2]], [['raf', 2], ['brulee', 1]],
    [['mushroom', 3], ['tea', 3]], [['prawns', 2], ['matcha', 2]], [['tiramisu', 1], ['latte', 1]],
    [['cappuccino', 3], ['roll', 2]], [['calamari', 2], ['lemonade', 2]],
  ]
  for (let index = 0; index < 18; index++) {
    const at = todayStart + Math.floor(elapsed * (index + 1) / 19)
    if (at + 3 * minute > now) continue
    fixture({ id: `demo-today-${index}`, tableId: `table-${11 + index}`, products: series[index % series.length],
      waiterId: staff[index % staff.length].id, guestCount: 1 + index % 4, at, status: 'served', closed: true })
  }
  for (let index = 1; index < 28; index++) {
    fixture({ id: `demo-history-${index}`, tableId: `table-${11 + index % 18}`, products: series[index % series.length],
      waiterId: staff[index % staff.length].id, guestCount: 1 + index % 4, at: now - index * day, status: 'served', closed: true })
  }
  return state
}
