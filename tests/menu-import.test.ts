import { describe, expect, it } from 'vitest'
import { applyCommand, createDemoState, DomainError, emptyState, entries, stockStatus } from '../src/domain'
import type { Session, State } from '../src/domain'
import { previewMenuImport } from '../src/menu-import'

const admin: Session = { userId: 'importer', deviceId: 'test-terminal', name: 'Администратор', role: 'admin' }
const waiter: Session = { userId: 'demo-pasha', deviceId: 'test-terminal', name: 'Паша', role: 'waiter' }
const now = new Date(2026, 5, 15, 12).getTime()
const register = (state = emptyState()) => applyCommand(state, admin, { type: 'registerUser' }, { id: 'register-importer', now })
const importMenu = (state: State, json: string, id = 'new-menu') =>
  applyCommand(state, admin, { type: 'importMenu', json }, { id, now: now + 1 })
const stringify = (products: unknown[], categories: unknown[] = []) => JSON.stringify({ categories, products })

describe('импорт меню', () => {
  it('читает JSON из блока Markdown, создаёт категории и товары и ведёт аудит одной операцией', () => {
    const before = register()
    const source = stringify([
      { name: 'Флэт уайт', category: 'кофе', price: 235.5, description: 'Двойной эспрессо', volume: '180 мл',
        imageUrl: 'https://static.example.com/coffee.jpg', quantity: 4, min: 1 },
      { name: 'Чизкейк', category: 'Десерты', price: 350, available: false, quantity: 6 },
      { name: 'Вода', category: 'Напитки', price: 75 },
    ], [{ name: 'Кофе', color: '#aa8866' }])
    const fenced = '```JSON\r\n' + source + '\r\n```'
    expect(previewMenuImport(before, fenced)).toEqual({ categoryCount: 3, productCount: 3, skippedCount: 0, warnings: [] })

    const result = importMenu(before, fenced)
    const coffee = entries(result.categories).find(category => category.name === 'Кофе')
    expect(coffee?.color).toBe('#aa8866')
    const imported = entries(result.products)
    expect(imported[0]).toMatchObject({
      name: 'Флэт уайт', categoryId: coffee?.id, price: 235.5, volume: '180 мл',
      description: 'Двойной эспрессо', imageUrl: 'https://static.example.com/coffee.jpg',
    })
    expect(result.inventory[imported[0].id]).toMatchObject({ quantity: 4, min: 1, revision: 1 })
    expect(result.inventory[imported[1].id].quantity).toBe(6)
    expect(stockStatus(result, imported[1].id)).toBe('out')
    expect(imported[2]).not.toHaveProperty('imageUrl')
    expect(result.inventory[imported[2].id]).toBeUndefined()
    expect(entries(result.inventoryTransactions).map(transaction => transaction.quantity)).toEqual([4, 6])
    expect(entries(result.auditLogs).filter(event => event.type === 'importMenu')).toHaveLength(1)
    expect(importMenu(result, fenced)).toBe(result)
  })

  it('пропускает нормализованные дубликаты, сохраняет цены и архивированные записи', () => {
    const before = register(createDemoState(now))
    before.products.latte.archived = true
    before.categories.sauces.archived = true
    before.products.satsibeli.archived = true
    const data = stringify([
      { name: ' ЛАТТЕ ', category: ' КОФЕ ', price: 1 },
      { name: 'Чизкейк', category: 'Кофе', price: 180 },
      { name: 'чизкейк', category: 'КОФЕ', price: 220 },
      { name: 'Сырный соус', category: 'Соусы', price: 70 },
      { name: 'Раф   ореховый', category: 'Кофе', price: 250 },
      { name: 'РАФ ореховый', category: 'Кофе', price: 300 },
    ], [{ name: 'кофе', color: '#ffffff' }, { name: 'Соусы' }])
    expect(previewMenuImport(before, data)).toMatchObject({ categoryCount: 0, productCount: 2, skippedCount: 4 })

    const result = importMenu(before, data)
    expect(result.products.latte).toEqual(before.products.latte)
    expect(result.categories.coffee).toEqual(before.categories.coffee)
    expect(result.categories.sauces.archived).toBe(true)
    expect(entries(result.products).filter(product => product.name.trim().toLowerCase() === 'чизкейк')).toHaveLength(2)
    expect(entries(result.products).filter(product => product.name.includes('ореховый'))).toHaveLength(1)
  })

  it('повторно рассчитывает дубликаты на актуальных данных при применении', () => {
    const before = register()
    const data = stringify([{ name: 'Латте', category: 'Кофе', price: 100 }])
    expect(previewMenuImport(before, data).productCount).toBe(1)
    const concurrent = importMenu(before, data, 'other-import')
    const result = importMenu(concurrent, data)
    expect(entries(result.products)).toHaveLength(1)
    expect(entries(result.categories)).toHaveLength(1)
    expect(result.auditLogs['new-menu'].detail).toContain('Пропущено: 1')
  })

  it.each([
    [{ name: 'Сок', category: 'Напитки', price: '100' }, 'цену'],
    [{ name: 'Сок', category: 'Напитки', price: 100, quantity: -1 }, 'quantity'],
    [{ name: 'Сок', category: 'Напитки', price: 100, imageUrl: 'data:image/png;base64,AAAA' }, 'imageUrl'],
    [{ name: 'Сок', category: 'Напитки', price: 100, archived: true }, 'неизвестное поле'],
  ])('целиком отклоняет операцию с невалидной строкой', (invalid, error) => {
    const before = register()
    const data = stringify([{ name: 'Латте', category: 'Кофе', price: 100 }, invalid])
    expect(() => previewMenuImport(before, data)).toThrow(error)
    expect(() => importMenu(before, data)).toThrow(DomainError)
    expect(entries(before.products)).toHaveLength(0)
    expect(entries(before.categories)).toHaveLength(0)
    expect(before.auditLogs['new-menu']).toBeUndefined()
  })

  it('отклоняет слишком большие запросы и запросы от официантов', () => {
    const state = register(createDemoState(now))
    const json = stringify([{ name: 'Латте', category: 'Кофе', price: 100 }])
    expect(() => applyCommand(state, waiter, { type: 'importMenu', json }, { id: 'forbidden-import', now }))
      .toThrow(/администратору/)
    expect(() => previewMenuImport(state, 'я'.repeat(60_001))).toThrow(/120 КБ/)
    expect(() => previewMenuImport(state, stringify(Array.from({ length: 101 }, () => ({}))))).toThrow(/до 100 записей/)
  })
})
