import type { State } from './domain'

type Row = Record<string, unknown>
type MenuCategory = { name: string; key: string; color: string }
type MenuProduct = {
  name: string; categoryKey: string; price: number; available: boolean
  cost?: number; description?: string; volume?: string; imageUrl?: string; inventory?: { quantity: number | null; min?: number }
}

export type MenuImportPreview = { categoryCount: number; productCount: number; skippedCount: number; warnings: string[] }

export class MenuImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MenuImportError'
  }
}

const MAX_ROWS = 100
const MAX_BYTES = 120_000
const DEFAULT_COLOR = '#53637f'

function row(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MenuImportError(`${label}: ожидается объект`)
  }
  return value as Row
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new MenuImportError(`${label}: ожидается массив до ${MAX_ROWS} записей`)
  }
  return value
}

function nameKey(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru')
}

function string(value: unknown, label: string, max: number, optional = false): string {
  if (optional && value === undefined) return ''
  if (typeof value !== 'string' || (!optional && !value.trim()) ||
    value.trim().length > max || /[\u0000-\u0008\u000e-\u001f\u007f]/.test(value)) {
    throw new MenuImportError(`${label}: укажите текст до ${max} символов`)
  }
  return value.trim()
}

function whole(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new MenuImportError(`${label}: укажите целое число от 0 до 1 000 000`)
  }
  return value
}

function checkFields(value: Row, allowed: readonly string[], label: string) {
  const extra = Object.keys(value).find(key => !allowed.includes(key))
  if (extra !== undefined) throw new MenuImportError(`${label}: неизвестное поле «${extra.slice(0, 60)}»`)
}

function image(value: unknown, label: string): string {
  const source = string(value, label, 2048, true)
  if (!source || /^\/[^/\\]/.test(source)) return source
  try {
    const url = new URL(source)
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href
  } catch {
    // Report a field error below.
  }
  throw new MenuImportError(`${label}: укажите ссылку HTTP(S) на изображение`)
}

function parse(text: string) {
  if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) {
    throw new MenuImportError('Размер JSON превышает 120 КБ')
  }
  const trimmed = text.trim()
  if (!trimmed) throw new MenuImportError('Вставьте JSON меню')
  const fenced = /^\x60\x60\x60(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*\x60\x60\x60$/i.exec(trimmed)
  let data: unknown
  try {
    data = JSON.parse(fenced?.[1] ?? trimmed)
  } catch {
    throw new MenuImportError('Не удалось прочитать JSON. Проверьте кавычки, запятые и скобки')
  }
  const payload = row(data, 'Меню')
  checkFields(payload, ['categories', 'products'], 'Меню')
  const categories = list(payload.categories ?? [], 'Категории')
  const products = list(payload.products ?? [], 'Товары')
  if (!categories.length && !products.length) throw new MenuImportError('Добавьте хотя бы одну категорию или товар')
  return { categories, products }
}

export function buildMenuImport(state: State, text: string) {
  const source = parse(text)
  const declared = new Map<string, MenuCategory>()
  const archivedCategories = new Set<string>()
  const categoryIds = new Map<string, string>()
  const knownCategoryKeys = new Map<string, string>()
  for (const category of Object.values(state.categories)) {
    const key = nameKey(category.name)
    knownCategoryKeys.set(category.id, key)
    if (category.archived) archivedCategories.add(key)
    else if (!categoryIds.has(key)) categoryIds.set(key, category.id)
  }
  const productKeys = new Set<string>()
  const productKey = (categoryKey: string, name: string) => JSON.stringify([categoryKey, nameKey(name)])
  for (const product of Object.values(state.products)) {
    const categoryKey = knownCategoryKeys.get(product.categoryId)
    if (categoryKey !== undefined) productKeys.add(productKey(categoryKey, product.name))
  }

  for (const [index, value] of source.categories.entries()) {
    const label = `Категория №${index + 1}`
    const fields = row(value, label)
    checkFields(fields, ['name', 'color'], label)
    const name = string(fields.name, `${label}, name`, 80)
    const color = fields.color === undefined ? DEFAULT_COLOR : string(fields.color, `${label}, color`, 7)
    if (!/^#[a-f\d]{6}$/i.test(color)) throw new MenuImportError(`${label}: цвет должен иметь формат #RRGGBB`)
    const key = nameKey(name)
    if (!declared.has(key)) declared.set(key, { name, key, color })
  }

  const products: MenuProduct[] = []
  const warnings: string[] = []
  let skippedCount = 0
  for (const [index, value] of source.products.entries()) {
    const label = `Товар №${index + 1}`
    const fields = row(value, label)
    checkFields(fields, ['name', 'category', 'price', 'cost', 'description', 'volume', 'imageUrl', 'quantity', 'min', 'available'], label)
    const name = string(fields.name, `${label}, name`, 120)
    const category = string(fields.category, `${label}, category`, 80)
    const categoryKey = nameKey(category)
    const price = fields.price
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1_000_000) {
      throw new MenuImportError(`${label}: укажите числовую цену от 0 до 1 000 000 ₽`)
    }
    const cost = fields.cost
    if (cost !== undefined && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 1_000_000)) {
      throw new MenuImportError(`${label}: укажите числовую себестоимость порции от 0 до 1 000 000 ₽`)
    }
    const description = string(fields.description, `${label}, description`, 1200, true)
    const volume = string(fields.volume, `${label}, volume`, 80, true)
    const imageUrl = image(fields.imageUrl, `${label}, imageUrl`)
    const quantity = fields.quantity === undefined || fields.quantity === null ? null : whole(fields.quantity, `${label}, quantity`)
    const min = fields.min === undefined ? undefined : whole(fields.min, `${label}, min`)
    const available = fields.available === undefined ? true : fields.available
    if (typeof available !== 'boolean') throw new MenuImportError(`${label}: available должен иметь значение true или false`)
    const key = productKey(categoryKey, name)
    if (productKeys.has(key)) {
      skippedCount++
      warnings.push(`«${name}» в категории «${category}» уже есть в каталоге или в этом списке`)
      continue
    }
    if (archivedCategories.has(categoryKey) && !categoryIds.has(categoryKey)) {
      skippedCount++
      warnings.push(`«${name}» пропущен. Категория «${category}» в архиве`)
      continue
    }
    productKeys.add(key)
    if (!categoryIds.has(categoryKey) && !declared.has(categoryKey)) {
      declared.set(categoryKey, { name: category, key: categoryKey, color: DEFAULT_COLOR })
    }
    products.push({
      name, categoryKey, price: Math.round(price * 100) / 100, available,
      ...(cost === undefined ? {} : { cost: Math.round(cost * 100) / 100 }),
      ...(description ? { description } : {}), ...(volume ? { volume } : {}), ...(imageUrl ? { imageUrl } : {}),
      ...(fields.quantity !== undefined || min !== undefined ? { inventory: { quantity, ...(min !== undefined ? { min } : {}) } } : {}),
    })
  }
  if (declared.size > MAX_ROWS) throw new MenuImportError(`За один импорт можно указать не более ${MAX_ROWS} категорий`)
  const categories = [...declared.values()].filter(category => !categoryIds.has(category.key) && !archivedCategories.has(category.key))
  return {
    categories, categoryIds, products,
    preview: { categoryCount: categories.length, productCount: products.length, skippedCount, warnings } satisfies MenuImportPreview,
  }
}

export function previewMenuImport(state: State, text: string): MenuImportPreview {
  return buildMenuImport(state, text).preview
}
