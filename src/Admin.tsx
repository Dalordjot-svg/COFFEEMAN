import { cloneElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  Activity, Archive, ArrowLeft, Check, ChevronRight,
  ClipboardList, Coffee, Copy, Download, History, Image as ImageIcon, LayoutGrid,
  ListFilter, LogOut, Menu, Package, Plus, Search, Settings as SettingsIcon, Upload,
  Sofa, Tag, UsersRound, X,
} from 'lucide-react'
import {
  availableQuantity, entries, isActiveOrder, newId, orderAlerts, orderStatus, orderStatusLabel,
  orderTitle, orderTotal, stats, stockStatus,
  type Category, type Command, type Hall, type Modifier, type Order, type PriceOption, type Product,
  type Session, type Settings, type State, type Table, type User,
} from './domain'
import { previewMenuImport } from './menu-import'
import menuImportGuide from './menu-import-instructions.txt?url'
import menuImportText from './menu-import-instructions.txt?raw'
import './admin.css'

type Props = {
  state: State
  user: Session
  execute: (command: Command) => Promise<unknown>
  openOrder: (id: string) => void
  onLogout: () => void
  connection: string
  onlineUserIds: ReadonlySet<string>
}

type PriceDraft = Omit<PriceOption, 'price'> & { price: string }
type ModifierDraft = Omit<Modifier, 'options'> & { options: PriceDraft[] }

type Page = 'overview' | 'catalog' | 'floor' | 'staff' | 'more' | 'orders' | 'settings' | 'audit'
type Dialog =
  | { kind: 'product'; value?: Product }
  | { kind: 'import' }
  | { kind: 'category'; value?: Category }
  | { kind: 'hall'; value?: Hall }
  | { kind: 'table'; value?: Table }
  | { kind: 'staff'; id: string }
  | { kind: 'order'; id: string }

const titles: Record<Page, string> = {
  overview: 'Управление',
  catalog: 'Каталог',
  floor: 'Залы и столы',
  staff: 'Сотрудники',
  more: 'Ещё',
  orders: 'Все заказы',
  settings: 'Настройки системы',
  audit: 'Журнал операций',
}

const nav = [
  { page: 'overview', label: 'Обзор', icon: LayoutGrid },
  { page: 'catalog', label: 'Каталог', icon: Package },
  { page: 'floor', label: 'Залы', icon: Sofa },
  { page: 'staff', label: 'Сотрудники', icon: UsersRound },
  { page: 'more', label: 'Ещё', icon: Menu },
] as const

const rubles = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2, minimumFractionDigits: 0 })
const datetime = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
const formatTime = (at: number | undefined) => typeof at === 'number' && Number.isFinite(at) ? datetime.format(at) : '—'
const sorted = <T extends { sort: number; name: string }>(items: T[]) =>
  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru', { numeric: true }))
const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить изменения'
const fieldText = (data: FormData, name: string) => String(data.get(name) ?? '').trim()
const fieldNumber = (data: FormData, name: string) => Number(data.get(name))
const colorValue = (color: string | undefined) => color && /^#[a-f0-9]{6}$/i.test(color) ? color : '#357afe'

const auditNames: Record<string, string> = {
  registerUser: 'Вход сотрудника',
  saveProduct: 'Изменение товара',
  importMenu: 'Импорт меню',
  clearCatalog: 'Очистка каталога',
  saveCategory: 'Изменение категории',
  saveModifier: 'Изменение модификатора',
  saveHall: 'Изменение зала',
  saveTable: 'Изменение стола',
  updateUser: 'Изменение сотрудника',
  assignOrder: 'Назначение официанта',
  createOrder: 'Создание заказа',
  addGuest: 'Добавление гостя',
  removeGuest: 'Удаление гостя',
  addItem: 'Добавление позиции',
  editItem: 'Изменение позиции',
  sendOrder: 'Отправка на приготовление',
  readyOrder: 'Готовность заказа',
  readyItem: 'Готовность позиции',
  serveItem: 'Выдача позиции',
  cancelItem: 'Отмена позиции',
  cancelOrder: 'Отмена заказа',
  precheckOrder: 'Запрос пречека',
  closeOrder: 'Завершение заказа',
  reopenOrder: 'Возобновление заказа',
  saveSettings: 'Изменение настроек',
  updateInventory: 'Изменение остатка',
}

function ActionRow({ icon, label, detail, trailing, onClick, danger = false }: {
  icon: ReactNode; label: string; detail?: string; trailing?: ReactNode; onClick: () => void; danger?: boolean
}) {
  return <button type="button" className={`admin-row admin-action ${danger ? 'admin-danger' : ''}`} onClick={onClick}>
    <span className="admin-row-icon">{icon}</span>
    <span className="admin-row-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    {trailing}
    <ChevronRight size={17} className="admin-chevron" />
  </button>
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-empty">{children}</p>
}

function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return <div className="admin-field"><label htmlFor={id}>{label}</label>{cloneElement(children, { id })}</div>
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const reference = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = reference.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  function dismiss() {
    const dialog = reference.current
    if (!dialog || dialog.dataset.closing) return
    dialog.dataset.closing = 'true'
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    window.setTimeout(onClose, 180)
  }

  return <dialog ref={reference} className="admin-modal" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); dismiss() }}
    onClick={event => { if (event.target === event.currentTarget) dismiss() }}>
    <div className="admin-dialog-body">
      <div className="admin-handle" aria-hidden="true" />
      <header className="admin-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="admin-icon-button" aria-label="Закрыть" onClick={dismiss}><X size={19} /></button>
      </header>
      {children}
    </div>
  </dialog>
}

function Form({ children, onSave, onArchive, archiveLabel = 'Архивировать' }: {
  children: ReactNode; onSave: (data: FormData) => Promise<unknown>; onArchive?: () => Promise<unknown>; archiveLabel?: string
}) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setFailure('')
    try { await action() } catch (error) { setFailure(message(error)) }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void run(() => onSave(data))
  }
  return <form className="admin-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      {children}
      {failure && <p role="alert" className="admin-error">{failure}</p>}
      <div className="admin-form-actions">
        {onArchive && <button type="button" className="admin-archive" onClick={() => void run(onArchive)}><Archive size={17} />{archiveLabel}</button>}
        <button type="submit" className="primary">{busy ? 'Сохранение…' : 'Сохранить'}</button>
      </div>
    </fieldset>
  </form>
}

function CatalogProductRow({ state, product, onClick }: { state: State; product: Product; onClick: () => void }) {
  const [failedUrl, setFailedUrl] = useState('')
  const url = product.imageUrl ?? ''
  const hasPhoto = Boolean(url && failedUrl !== url)
  const stock = stockStatus(state, product.id)
  const quantity = availableQuantity(state, product.id)
  return <button type="button" className="admin-row admin-action" onClick={onClick}>
    {hasPhoto
      ? <img className="admin-product-photo" src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />
      : <span className="admin-product-photo admin-photo-placeholder" role="img" aria-label="Нет изображения"><ImageIcon size={17} /></span>}
    <span className="admin-row-copy"><strong>{product.name}</strong>
      <small>{state.categories[product.categoryId]?.name ?? 'Без категории'} · {rubles.format(product.price)}</small>
      {!hasPhoto && <small>Нет изображения</small>}
    </span>
    {!product.archived && <span className={`admin-stock admin-stock-${stock}`}>{stock === 'out' ? 'Стоп' : quantity === null ? 'В наличии' : `${quantity} шт`}</span>}
    <ChevronRight size={17} className="admin-chevron" />
  </button>
}

function Catalog({ state, open, execute }: { state: State; open: (dialog: Dialog) => void; execute: Props['execute'] }) {
  const [clearing, setClearing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [slide, setSlide] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  async function clear() {
    if (!confirmed || busy) return
    setBusy(true)
    try { await execute({type: 'clearCatalog'}); setClearing(false); setConfirmed(false) }
    catch (error) { setFailure(message(error)) }
    finally { setBusy(false); setSlide(0) }
  }
  const [section, setSection] = useState<'products' | 'categories'>('products')
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const categories = sorted(entries(state.categories)).filter(item => Boolean(item.archived) === archived &&
    item.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  const products = sorted(entries(state.products)).filter(item => Boolean(item.archived) === archived &&
    item.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  return <>
    <div className="admin-segments" aria-label="Раздел каталога">
      <button type="button" aria-pressed={section === 'products'} onClick={() => setSection('products')}>Товары</button>
      <button type="button" aria-pressed={section === 'categories'} onClick={() => setSection('categories')}>Категории</button>
    </div>
    <div className="admin-toolbar">
      <label className="admin-search"><Search size={18} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Поиск" aria-label="Поиск в каталоге" /></label>
      <button type="button" className="admin-icon-button" aria-label="Архив" aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={19} /></button>
    </div>
    {section === 'products' ? <>
      <div className="admin-toolbar admin-catalog-actions">
        <button type="button" className="admin-add" onClick={() => open({ kind: 'product' })}><Plus size={19} />Добавить товар</button>
        <button type="button" className="admin-add" onClick={() => open({ kind: 'import' })}><Upload size={17} />Импорт меню</button>
      </div>
      <button type="button" className="admin-add" style={{color:'#ff7777'}} onClick={() => {setClearing(!clearing);setConfirmed(false);setSlide(0);setFailure('')}}>Удалить все позиции</button>
      {clearing && <div className="admin-panel" style={{padding:16}}>
        <p>Все товары будут архивированы. История заказов сохранится.</p>
        <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>{setConfirmed(e.target.checked);setSlide(0)}} /> Подтверждаю очистку каталога</label>
        <p>Проведите вправо для удаления</p>
        <input aria-label="Проведите вправо для удаления" type="range" min={0} max={100} value={slide} disabled={!confirmed || busy} style={{width:'100%',touchAction:'none',accentColor:'#e34b55'}} onChange={e=>setSlide(Number(e.target.value))} onPointerUp={e=>{if(Number(e.currentTarget.value)===100) void clear();else setSlide(0)}} onKeyUp={e=>{if(e.key==='Enter' && slide===100) void clear()}} />
        {failure && <p role="alert">{failure}</p>}
      </div>}
      <div className="admin-panel">
        {products.map(product => <CatalogProductRow key={product.id} product={product} state={state}
          onClick={() => open({ kind: 'product', value: product })} />)}
        {products.length === 0 && <Empty>{archived ? 'В архиве нет товаров' : 'Товары не найдены'}</Empty>}
      </div>
    </> : <>
      <button type="button" className="admin-add" onClick={() => open({ kind: 'category' })}><Plus size={19} />Добавить категорию</button>
      <div className="admin-panel">
        {categories.map(category => <ActionRow key={category.id} icon={<Tag size={19} color={category.color} />} label={category.name}
          detail={`Товаров: ${entries(state.products).filter(product => product.categoryId === category.id && !product.archived).length}`}
          onClick={() => open({ kind: 'category', value: category })} />)}
        {categories.length === 0 && <Empty>{archived ? 'В архиве нет категорий' : 'Категории не найдены'}</Empty>}
      </div>
    </>}
  </>
}

function MenuImport({ state, execute }: { state: State; execute: Props['execute'] }) {
  const [json, setJson] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const guideText = useRef<HTMLTextAreaElement>(null)
  const [checked, setChecked] = useState(false)
  const [working, setWorking] = useState(false)
  const [failure, setFailure] = useState('')
  const [imported, setImported] = useState<ReturnType<typeof previewMenuImport>>()
  let preview: ReturnType<typeof previewMenuImport> | undefined
  let invalid = ''
  if (checked && !imported) {
    try { preview = previewMenuImport(state, json) }
    catch (error) { invalid = message(error) }
  }

  async function submitImport() {
    if (working || !preview || (!preview.categoryCount && !preview.productCount)) return
    setWorking(true)
    setFailure('')
    try {
      await execute({ type: 'importMenu', json })
      setImported(preview)
    } catch (error) { setFailure(message(error)) }
    finally { setWorking(false) }
  }

  const result = imported ?? preview
  return <div className="admin-import">
    <a className="secondary admin-guide-download" href={menuImportGuide} download="coffeeman-menu-import.txt">
      <Download size={18} />Скачать инструкцию для ИИ
    </a>
    <button type="button" className="secondary" onClick={() => setShowGuide(value => !value)} aria-expanded={showGuide}>
      {showGuide ? 'Скрыть текст инструкции' : 'Открыть текст инструкции'}
    </button>
    {showGuide && <>
      <Field label="Текст инструкции для ИИ"><textarea ref={guideText} rows={7} readOnly value={menuImportText.trimStart()} /></Field>
      <button type="button" className="secondary" onClick={async () => {
        try {
          await navigator.clipboard.writeText(menuImportText.trimStart())
          setCopyStatus('Инструкция скопирована')
        } catch {
          guideText.current?.focus()
          guideText.current?.select()
          setCopyStatus('Текст выделен. Нажмите «Копировать» в меню устройства.')
        }
      }}><Copy size={18} />Копировать инструкцию</button>
      {copyStatus && <p className="admin-hint" role="status">{copyStatus}</p>}
    </>}
    <p className="admin-hint">Передайте ИИ инструкцию и исходное меню. Вставьте полученный JSON и проверьте, какие позиции добавятся.</p>
    <Field label="JSON меню"><textarea rows={7} value={json} spellCheck={false} autoCapitalize="off" disabled={working}
      onChange={event => { setJson(event.target.value); setChecked(false); setFailure(''); setImported(undefined) }} /></Field>
    <button type="button" className="secondary" disabled={working || !json.trim()} onClick={() => {
      setChecked(true)
      setImported(undefined)
      setFailure('')
    }}>Проверить меню</button>
    {(invalid || failure) && <p role="alert" className="admin-error">{invalid || failure}</p>}
    {result && <div className="admin-import-result">
      {imported && <p className="admin-success" role="status"><Check size={17} />Меню импортировано</p>}
      <p className="admin-hint">Проверка перед импортом</p>
      <Metrics items={[
        { label: 'Категории', value: result.categoryCount },
        { label: 'Товары', value: result.productCount },
        { label: 'Пропущено', value: result.skippedCount },
      ]} />
      {result.warnings.length > 0 && <ul className="admin-import-warnings">{result.warnings.map((warning, index) =>
        <li key={index}>{warning}</li>)}</ul>}
      {!imported && <button type="button" className="primary" disabled={working || (!result.categoryCount && !result.productCount)}
        onClick={() => void submitImport()}>{working ? 'Импорт…' : 'Импортировать'}</button>}
    </div>}
  </div>
}

function ProductForm({ state, product, execute }: { state: State; product?: Product; execute: Props['execute'] }) {
  const [sizes, setSizes] = useState<PriceDraft[]>(() => (product?.sizes ?? []).map(size => ({ ...size, price: String(size.price) })))
  const [modifiers, setModifiers] = useState<ModifierDraft[]>(() => (product?.modifierIds ?? []).flatMap(id => {
    const modifier = state.modifiers[id]
    return modifier ? [{ ...modifier, options: modifier.options.map(option => ({ ...option, price: String(option.price) })) }] : []
  }))
  const originalModifiers = useRef(modifiers).current
  const inventory = useRef(product ? state.inventory[product.id] : undefined).current
  const [tracked, setTracked] = useState(inventory?.quantity != null)
  const latest = product && state.products[product.id]
  const categories = sorted(entries(state.categories)).filter(category => !category.archived || category.id === product?.categoryId)
  const otherModifierUse = (modifierId: string) => entries(state.products).some(item => item.id !== product?.id && item.modifierIds?.includes(modifierId))

  function updateModifier(id: string, change: Partial<ModifierDraft>) {
    setModifiers(items => items.map(item => item.id === id ? { ...item, ...change } : item))
  }

  return <Form onSave={data => {
    const modifierIds = modifiers.map(modifier => !originalModifiers.includes(modifier) && otherModifierUse(modifier.id)
      ? newId() : modifier.id)
    const changedModifiers = modifiers.flatMap((modifier, index) => originalModifiers.includes(modifier) ? [] : [{
      ...modifier, id: modifierIds[index], name: modifier.name.trim(),
      options: modifier.options.map(option => ({ ...option, name: option.name.trim(), price: Number(option.price) })),
    }])
    const quantity = tracked ? fieldNumber(data, 'quantity') : null
    const minimum = fieldText(data, 'min') ? fieldNumber(data, 'min') : inventory?.min
    const changedInventory = quantity !== (inventory?.quantity ?? null) || minimum !== inventory?.min
    const availability = data.has('available')
    return execute({
      type: 'saveProduct',
      product: {
        id: product?.id ?? newId(),
        name: fieldText(data, 'name'), categoryId: fieldText(data, 'categoryId'), price: fieldNumber(data, 'price'),
        ...(fieldText(data, 'cost') === '' ? {} : {cost: fieldNumber(data, 'cost')}),
        description: fieldText(data, 'description'), imageUrl: fieldText(data, 'imageUrl'), volume: fieldText(data, 'volume'),
        sort: fieldNumber(data, 'sort'),
        available: availability,
        archived: latest?.archived ?? false,
        sizes: sizes.map(size => ({ ...size, name: size.name.trim(), price: Number(size.price) })), modifierIds,
      },
      ...(availability === product?.available ? { preserveAvailability: true } : {}),
      ...(changedModifiers.length ? { modifiers: changedModifiers } : {}),
      ...(changedInventory ? { inventory: { quantity, min: minimum, expectedRevision: inventory?.revision ?? 0 } } : {}),
    })
  }} onArchive={latest ? () => execute({ type: 'saveProduct', product: { ...latest, archived: !latest.archived }, preserveAvailability: true }) : undefined}
    archiveLabel={product?.archived ? 'Восстановить из архива' : undefined}>
    <Field label="Название"><input name="name" required maxLength={100} defaultValue={product?.name} /></Field>
    <Field label="Категория"><select name="categoryId" required defaultValue={product?.categoryId ?? ''}>
      <option value="" disabled>Выберите категорию</option>
      {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select></Field>
    {!categories.length && <p className="admin-hint">Сначала добавьте категорию в каталоге.</p>}
    <div className="admin-columns">
      <Field label="Цена, ₽"><input name="price" required type="number" inputMode="decimal" min={0} step="0.01" defaultValue={product?.price} /></Field>
      <Field label="Себестоимость порции, ₽"><input name="cost" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={product?.cost} /></Field>
      <Field label="Размер или объём"><input name="volume" maxLength={60} placeholder="250 мл" defaultValue={product?.volume} /></Field>
    </div>
    <Field label="Описание"><textarea name="description" maxLength={500} rows={2} defaultValue={product?.description} /></Field>
    <Field label="Фотография (URL)"><input name="imageUrl" type="text" inputMode="url" maxLength={2048} placeholder="https://…" defaultValue={product?.imageUrl} /></Field>
    <Field label="Порядок"><input name="sort" type="number" inputMode="numeric" required min={0} defaultValue={product?.sort ?? 0} /></Field>
    <label className="admin-check"><input name="available" type="checkbox" defaultChecked={product?.available ?? true} /><span>Доступен в меню</span></label>
    <label className="admin-check"><input name="tracked" type="checkbox" checked={tracked} onChange={event => setTracked(event.target.checked)} /><span>Учитывать количество</span></label>
    {tracked && <div className="admin-columns">
      <Field label="Физический остаток"><input name="quantity" type="number" min={0} step={1} required inputMode="numeric" defaultValue={inventory ? inventory.quantity ?? 0 : 0} /></Field>
      <Field label="Минимальный остаток"><input name="min" type="number" min={0} step={1} inputMode="numeric" placeholder={String(state.settings.defaultMin)} defaultValue={inventory ? inventory.min : undefined} /></Field>
    </div>}
    <section className="admin-subform">
      <div className="admin-subform-heading"><h3>Размеры</h3><button type="button" className="admin-add" onClick={() => setSizes([...sizes, { id: newId(), name: '', price: String(product?.price ?? 0) }])}><Plus size={16} />Размер</button></div>
      {sizes.map((size, index) => <div className="admin-option" key={size.id}>
        <Field label={`Размер ${index + 1}`}><input required maxLength={80} value={size.name} onChange={event => setSizes(sizes.map(item => item.id === size.id ? { ...item, name: event.target.value } : item))} /></Field>
        <Field label="Цена, ₽"><input type="number" required min={0} step="0.01" inputMode="decimal" value={size.price} onChange={event => setSizes(sizes.map(item => item.id === size.id ? { ...item, price: event.target.value } : item))} /></Field>
        <button type="button" className="admin-icon-button" aria-label={`Удалить размер ${index + 1}`} onClick={() => setSizes(sizes.filter(item => item.id !== size.id))}><X size={17} /></button>
      </div>)}
    </section>
    <section className="admin-subform">
      <div className="admin-subform-heading"><h3>Модификаторы</h3><button type="button" className="admin-add" onClick={() => setModifiers([...modifiers, { id: newId(), name: '', options: [{ id: newId(), name: '', price: '0' }] }])}><Plus size={16} />Группа</button></div>
      {modifiers.map((modifier, index) => <div className="admin-modifier" key={modifier.id}>
        <div className="admin-option admin-option-wide">
          <Field label={`Группа ${index + 1}`}><input required maxLength={80} value={modifier.name} onChange={event => updateModifier(modifier.id, { name: event.target.value })} /></Field>
          <button type="button" className="admin-icon-button" aria-label={`Удалить группу ${index + 1}`} onClick={() => setModifiers(modifiers.filter(item => item.id !== modifier.id))}><X size={17} /></button>
        </div>
        <label className="admin-check"><input type="checkbox" checked={modifier.required ?? false} onChange={event => updateModifier(modifier.id, { required: event.target.checked })} /><span>Обязательный выбор</span></label>
        <label className="admin-check"><input type="checkbox" checked={modifier.multiple ?? false} onChange={event => updateModifier(modifier.id, { multiple: event.target.checked })} /><span>Можно выбрать несколько</span></label>
        {modifier.options.map((option, optionIndex) => <div className="admin-option" key={option.id}>
          <Field label={`Вариант ${optionIndex + 1}`}><input required maxLength={80} value={option.name} onChange={event => updateModifier(modifier.id, { options: modifier.options.map(item => item.id === option.id ? { ...item, name: event.target.value } : item) })} /></Field>
          <Field label="Доплата, ₽"><input type="number" min={0} step="0.01" inputMode="decimal" required value={option.price} onChange={event => updateModifier(modifier.id, { options: modifier.options.map(item => item.id === option.id ? { ...item, price: event.target.value } : item) })} /></Field>
          <button type="button" className="admin-icon-button" aria-label={`Удалить вариант ${optionIndex + 1}`} disabled={modifier.options.length === 1}
            onClick={() => updateModifier(modifier.id, { options: modifier.options.filter(item => item.id !== option.id) })}><X size={17} /></button>
        </div>)}
        <button type="button" className="admin-add" onClick={() => updateModifier(modifier.id, { options: [...modifier.options, { id: newId(), name: '', price: '0' }] })}><Plus size={16} />Вариант</button>
      </div>)}
    </section>
  </Form>
}

function CategoryForm({ state, category, execute }: { state: State; category?: Category; execute: Props['execute'] }) {
  const products = sorted(entries(state.products)).filter(product => product.categoryId === category?.id && !product.archived)
  return <Form onSave={data => execute({
    type: 'saveCategory', category: {
      id: category?.id ?? newId(), name: fieldText(data, 'name'), color: fieldText(data, 'color'),
      sort: fieldNumber(data, 'sort'), archived: category?.archived ?? false,
    },
  })} onArchive={category ? () => execute({ type: 'saveCategory', category: { ...category, archived: !category.archived } }) : undefined}
    archiveLabel={category?.archived ? 'Восстановить из архива' : undefined}>
    <Field label="Название"><input name="name" required maxLength={100} defaultValue={category?.name} /></Field>
    <div className="admin-columns">
      <Field label="Цвет категории"><input name="color" required type="color" defaultValue={colorValue(category?.color)} /></Field>
      <Field label="Порядок"><input name="sort" type="number" inputMode="numeric" required min={0} defaultValue={category?.sort ?? 0} /></Field>
    </div>
    {products.length > 0 && <p className="admin-hint">Категорию товара можно изменить в его карточке.</p>}
  </Form>
}

function Floor({ state, open }: { state: State; open: (dialog: Dialog) => void }) {
  const [archived, setArchived] = useState(false)
  const halls = sorted(entries(state.halls))
  const tables = sorted(entries(state.tables)).filter(table => Boolean(table.archived) === archived)
  const activeHalls = halls.filter(hall => !hall.archived)
  const groups = halls.filter(hall => Boolean(hall.archived) === archived || (archived && tables.some(table => table.hallId === hall.id)))
  return <>
    <div className="admin-toolbar admin-floor-toolbar">
      <button type="button" className="admin-add" onClick={() => open({ kind: 'hall' })}><Plus size={18} />Добавить зал</button>
      <button type="button" className="admin-add" disabled={!activeHalls.length} onClick={() => open({ kind: 'table' })}><Plus size={18} />Добавить стол</button>
      <button type="button" className="admin-icon-button" aria-label="Архив залов и столов" aria-pressed={archived} onClick={() => setArchived(!archived)}><Archive size={19} /></button>
    </div>
    {!groups.length && <div className="admin-panel"><Empty>{archived ? 'В архиве нет залов и столов' : 'Добавьте первый зал, чтобы создать столы'}</Empty></div>}
    {groups.map(hall => <section key={hall.id} className="admin-group">
      <h2>{hall.name}</h2>
      <div className="admin-panel">
        <ActionRow icon={<Sofa size={19} />} label="Настроить зал" onClick={() => open({ kind: 'hall', value: hall })} />
        {tables.filter(table => table.hallId === hall.id).map(table => {
          const busy = entries(state.orders).some(order => order.tableId === table.id && isActiveOrder(order))
          const waiter = table.waiterId ? state.users[table.waiterId] : null
          return <ActionRow key={table.id} icon={<span className={`admin-table-dot ${busy ? 'admin-busy' : ''}`} />} label={table.name}
            detail={`${table.capacity} мест${waiter ? ` · ${waiter.name}` : ''}${busy ? ' · занят' : ''}`} onClick={() => open({ kind: 'table', value: table })} />
        })}
      </div>
    </section>)}
  </>
}

function HallForm({ hall, execute }: { hall?: Hall; execute: Props['execute'] }) {
  return <Form onSave={data => execute({ type: 'saveHall', hall: { id: hall?.id ?? newId(),
    name: fieldText(data, 'name'), sort: fieldNumber(data, 'sort'), archived: hall?.archived ?? false,
  } })} onArchive={hall ? () => execute({ type: 'saveHall', hall: { ...hall, archived: !hall.archived } }) : undefined}
    archiveLabel={hall?.archived ? 'Восстановить из архива' : undefined}>
    <Field label="Название"><input name="name" required maxLength={100} defaultValue={hall?.name} /></Field>
    <Field label="Порядок"><input name="sort" type="number" inputMode="numeric" required min={0} defaultValue={hall?.sort ?? 0} /></Field>
  </Form>
}

function TableForm({ table, state, execute }: { table?: Table; state: State; execute: Props['execute'] }) {
  const halls = sorted(entries(state.halls)).filter(hall => !hall.archived || hall.id === table?.hallId)
  const waiters = entries(state.users).filter(user => user.role === 'waiter' && user.active)
  const hasOrder = Boolean(table && entries(state.orders).some(order => order.tableId === table.id && isActiveOrder(order)))
  return <Form onSave={data => execute({ type: 'saveTable', table: { id: table?.id ?? newId(),
    name: fieldText(data, 'name'), hallId: fieldText(data, 'hallId'), capacity: fieldNumber(data, 'capacity'),
    waiterId: fieldText(data, 'waiterId') || undefined, sort: fieldNumber(data, 'sort'), archived: table?.archived ?? false,
  } })} onArchive={table && !hasOrder ? () => execute({ type: 'saveTable', table: { ...table, archived: !table.archived } }) : undefined}
    archiveLabel={table?.archived ? 'Восстановить из архива' : undefined}>
    <Field label="Название"><input name="name" required maxLength={100} defaultValue={table?.name} /></Field>
    <Field label="Зал"><select name="hallId" required defaultValue={table?.hallId ?? halls[0]?.id ?? ''}>
      {halls.map(hall => <option key={hall.id} value={hall.id}>{hall.name}</option>)}
    </select></Field>
    <div className="admin-columns">
      <Field label="Вместимость"><input name="capacity" type="number" inputMode="numeric" required min={1} max={99} defaultValue={table?.capacity ?? 2} /></Field>
      <Field label="Порядок"><input name="sort" type="number" inputMode="numeric" required min={0} defaultValue={table?.sort ?? 0} /></Field>
    </div>
    <Field label="Ответственный официант"><select name="waiterId" defaultValue={waiters.some(waiter => waiter.id === table?.waiterId) ? table?.waiterId : ''}>
      <option value="">Не назначен</option>
      {waiters.map(waiter => <option key={waiter.id} value={waiter.id}>{waiter.name}</option>)}
    </select></Field>
    {hasOrder && <p className="admin-hint">Стол можно архивировать после завершения обслуживания.</p>}
  </Form>
}

function Staff({ state, onlineUserIds, open }: {
  state: State; onlineUserIds: Props['onlineUserIds']; open: (dialog: Dialog) => void
}) {
  const [query, setQuery] = useState('')
  const isOnline = (user: User) => user.active && onlineUserIds.has(user.id)
  const employees = entries(state.users)
  const users = employees.filter(user => user.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ru'))
  return <>
    <p className="admin-staff-summary">Сейчас в сети <strong>{employees.filter(isOnline).length}</strong></p>
    <label className="admin-search"><Search size={18} /><input type="search" value={query} placeholder="Поиск сотрудников"
      onChange={event => setQuery(event.target.value)} aria-label="Поиск сотрудников" /></label>
    <div className="admin-panel">
      {users.map(user => <ActionRow key={user.id} icon={<span className="admin-avatar">{user.name[0]?.toUpperCase()}</span>}
        label={user.name} detail={user.active ? user.role === 'admin' ? 'Администратор' : 'Официант' : 'Деактивирован'}
        trailing={<span className={`admin-presence ${isOnline(user) ? 'admin-presence-online' : ''}`}>{isOnline(user) ? 'В сети' : 'Не в сети'}</span>}
        onClick={() => open({ kind: 'staff', id: user.id })} />)}
      {!users.length && <Empty>Сотрудники не найдены</Empty>}
    </div>
  </>
}

function Metrics({ items }: { items: Array<{ label: string; value: ReactNode; tone?: string }> }) {
  return <div className="admin-metrics">{items.map(item => <div className="admin-metric" key={item.label}>
    <small>{item.label}</small><strong className={item.tone}>{item.value}</strong>
  </div>)}</div>
}

function OrderRow({ order, state, onClick }: { order: Order; state: State; onClick: () => void }) {
  const status = orderStatus(order)
  return <button type="button" className="admin-row admin-action" onClick={onClick}>
    <span className={`admin-status-dot admin-order-${status}`} />
    <span className="admin-row-copy"><strong>{orderTitle(order)}</strong><small>{orderStatusLabel[status]} · {state.users[order.waiterId]?.name ?? '—'}</small></span>
    <span className="admin-order-sum">{rubles.format(orderTotal(order))}</span>
    <ChevronRight size={17} className="admin-chevron" />
  </button>
}

function StaffForm({ employee, currentId, state, execute, openOrder }: {
  employee: User; currentId: string; state: State; execute: Props['execute']; openOrder: (id: string) => void
}) {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const personal = stats(state, period, employee.id)
  const orders = entries(state.orders).filter(order => order.waiterId === employee.id)
    .sort((a, b) => b.createdAt - a.createdAt)
  const active = orders.filter(order => isActiveOrder(order))
  const history = orders.filter(order => !isActiveOrder(order))
  return <>
    <Form onSave={data => execute({
      type: 'updateUser', userId: employee.id, name: fieldText(data, 'name'),
      active: employee.id === currentId ? employee.active : data.has('active'),
    })}>
      <Field label="Отображаемое имя"><input name="name" required maxLength={100} defaultValue={employee.name} /></Field>
      {employee.id !== currentId && <label className="admin-check"><input name="active" type="checkbox" defaultChecked={employee.active} /><span>Активный сотрудник</span></label>}
    </Form>
    <h3 className="admin-dialog-section-title">Статистика</h3>
    <div className="admin-segments" aria-label="Период статистики сотрудника">
      {(['day', 'week', 'month'] as const).map((value, index) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{['День', 'Неделя', 'Месяц'][index]}</button>)}
    </div>
    <Metrics items={[
      { label: 'Продажи', value: rubles.format(personal.sales) },
      { label: 'Средний чек', value: rubles.format(personal.average) },
      { label: 'Заказы', value: personal.orders },
      { label: 'Гости', value: personal.guests },
    ]} />
    <h3 className="admin-dialog-section-title">Активные заказы</h3>
    <div className="admin-panel">{active.map(order => <OrderRow key={order.id} state={state} order={order} onClick={() => openOrder(order.id)} />)}
      {!active.length && <Empty>Активных заказов нет</Empty>}
    </div>
    <h3 className="admin-dialog-section-title">История обслуживания</h3>
    <div className="admin-panel">{history.map(order => <OrderRow key={order.id} state={state} order={order} onClick={() => openOrder(order.id)} />)}
      {!history.length && <Empty>История пока пуста</Empty>}
    </div>
  </>
}

function Overview({ state, open, navigate }: { state: State; open: (dialog: Dialog) => void; navigate: (page: Page) => void }) {
  const today = stats(state, 'day')
  const orders = entries(state.orders)
  const products = entries(state.products).filter(product => !product.archived)
  const critical = products.filter(product => stockStatus(state, product.id) === 'out').length
  const low = products.filter(product => stockStatus(state, product.id) === 'low').length
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  const warnings = orderAlerts(state, now)
  return <>
    <div className="admin-venue">
      <span className="admin-brand"><Coffee size={23} strokeWidth={1.9} /></span>
      <div><strong>{state.settings.venueName}</strong><small>Административная панель</small></div>
    </div>
    <Metrics items={[
      { label: 'Выручка сегодня', value: rubles.format(today.sales) },
      { label: 'Валовая прибыль сегодня', value: today.grossProfit === null ? 'Не указана себестоимость' : rubles.format(today.grossProfit) },
      { label: 'Средний чек', value: rubles.format(today.average) },
      { label: 'Активные заказы', value: today.active },
      { label: 'Завершённые заказы', value: orders.filter(order => order.closedAt !== undefined).length },
      { label: 'Сотрудники', value: entries(state.users).filter(user => user.active && user.role === 'waiter').length },
      { label: 'Товары в каталоге', value: products.length },
      { label: 'В стоп-листе', value: critical, tone: critical ? 'admin-danger' : undefined },
      { label: 'Низкий остаток', value: low, tone: low ? 'admin-warning' : undefined },
    ]} />
    <section className="admin-panel">
      <h2 className="admin-panel-heading">Требуют внимания{warnings.length > 0 && <span>{warnings.length}</span>}</h2>
      {warnings.map(warning => {
        const order = state.orders[warning.orderId]
        return order && <ActionRow key={warning.orderId} icon={<span className={`admin-status-dot admin-tone-${warning.tone}`} />}
          label={orderTitle(order)} detail={`${warning.reason} · ${warning.minutes} мин`} onClick={() => open({ kind: 'order', id: order.id })} />
      })}
      {!warnings.length && <Empty>Нет заказов, требующих внимания</Empty>}
    </section>
    <div className="admin-panel">
      <ActionRow icon={<ClipboardList size={19} />} label="Все заказы" onClick={() => navigate('orders')} />
      <ActionRow icon={<SettingsIcon size={19} />} label="Настройки системы" onClick={() => navigate('settings')} />
    </div>
  </>
}

const itemLabels = {
  draft: 'Черновик',
  preparing: 'Готовится',
  ready: 'Готово',
  served: 'Выдано',
  canceled: 'Отменено',
}

function Orders({ state, open }: { state: State; open: (dialog: Dialog) => void }) {
  const [status, setStatus] = useState('all')
  const [waiterId, setWaiterId] = useState('')
  const [query, setQuery] = useState('')
  const orders = entries(state.orders)
    .filter(order => (status === 'all' || (status === 'active' ? isActiveOrder(order) : orderStatus(order) === status))
      && (!waiterId || order.waiterId === waiterId)
      && orderTitle(order).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => b.createdAt - a.createdAt)
  return <>
    <label className="admin-search"><Search size={18} /><input type="search" value={query} placeholder="Поиск по столу или табу"
      onChange={event => setQuery(event.target.value)} aria-label="Поиск заказов" /></label>
    <div className="admin-columns">
      <Field label="Статус"><select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="all">Все статусы</option><option value="active">Активные</option>
        {Object.entries(orderStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></Field>
      <Field label="Сотрудник"><select value={waiterId} onChange={event => setWaiterId(event.target.value)}>
        <option value="">Все сотрудники</option>
        {entries(state.users).filter(user => user.role === 'waiter').map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select></Field>
    </div>
    <div className="admin-panel">
      {orders.map(order => <OrderRow key={order.id} state={state} order={order} onClick={() => open({ kind: 'order', id: order.id })} />)}
      {!orders.length && <Empty>Заказы не найдены</Empty>}
    </div>
  </>
}

function Audit({ state, orderId }: { state: State; orderId?: string }) {
  const logs = entries(state.auditLogs)
    .filter(entry => !orderId || entry.orderId === orderId)
    .sort((a, b) => b.at - a.at)
  return <div className="admin-panel">
    {logs.map(entry => <div className="admin-row" key={entry.id}>
      <span className="admin-row-icon"><History size={17} /></span>
      <span className="admin-row-copy"><strong>{auditNames[entry.type] ?? entry.type}</strong>
        <small>{state.users[entry.actorId]?.name ?? 'Система'} · {formatTime(entry.at)}</small>
        {entry.detail && <small>{typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}</small>}
      </span>
    </div>)}
    {!logs.length && <Empty>Записей пока нет</Empty>}
  </div>
}

function OrderDetail({ state, order, execute, openOrder }: {
  state: State; order: Order; execute: Props['execute']; openOrder: (id: string) => void
}) {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const status = orderStatus(order)
  const items = entries(order.items)
  const activeItems = items.filter(item => item.status !== 'canceled')
  const active = isActiveOrder(order)
  const waiters = entries(state.users)
    .filter(user => user.role === 'waiter' && (user.active || user.id === order.waiterId))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  async function run(command: Command) {
    setPending(true)
    setFailure('')
    try {
      await execute(command)
      setConfirmCancel(false)
    } catch (error) { setFailure(message(error)) }
    finally { setPending(false) }
  }

  return <>
    <div className="admin-order-meta">
      <span className={`admin-status-dot admin-order-${status}`} />
      <div><strong>{orderStatusLabel[status]}</strong><small>{formatTime(order.createdAt)} · гостей {order.guestIds.length}</small></div>
      <strong>{rubles.format(orderTotal(order))}</strong>
    </div>
    {active && waiters.length > 0 && <Field label="Ответственный официант">
      <select value={order.waiterId} disabled={pending} onChange={event => void run({ type: 'assignOrder', orderId: order.id, waiterId: event.target.value })}>
        {waiters.map(waiter => <option key={waiter.id} value={waiter.id}>{waiter.name}</option>)}
      </select>
    </Field>}
    <div className="admin-panel" aria-label="Позиции заказа">
      {items.map(item => <div className="admin-row admin-detail-item" key={item.id}>
        <span className="admin-row-copy"><strong>{item.name} × {item.quantity}</strong>
          <small>{itemLabels[item.status]}{item.sizeName ? ` · ${item.sizeName}` : ''}</small>
          {item.options?.length > 0 && <small>{item.options.map(option => option.name).join(', ')}</small>}
          {item.comment && <small>{item.comment}</small>}
        </span>
        <strong className="admin-order-sum">{rubles.format(item.unitPrice * item.quantity)}</strong>
        {active && item.status === 'preparing' && <button type="button" className="admin-add" disabled={pending}
          onClick={() => void run({ type: 'readyItem', orderId: order.id, itemId: item.id })}>Готово</button>}
        {active && item.status === 'ready' && <button type="button" className="admin-add" disabled={pending}
          onClick={() => void run({ type: 'serveItem', orderId: order.id, itemId: item.id })}>Выдать</button>}
        {active && item.status !== 'canceled' && item.status !== 'served' && <button type="button" className="admin-icon-button admin-danger"
          disabled={pending} aria-label={`Отменить позицию «${item.name}»`} onClick={() => void run({ type: 'cancelItem', orderId: order.id, itemId: item.id })}><X size={16} /></button>}
      </div>)}
      {!items.length && <Empty>Позиции не добавлены</Empty>}
    </div>
    {failure && <p className="admin-error" role="alert">{failure}</p>}
    <div className="admin-order-actions">
      {active && <button type="button" className="secondary" onClick={() => openOrder(order.id)}>Открыть редактор заказа</button>}
      {active && activeItems.some(item => item.status === 'draft') && <button type="button" className="primary"
        disabled={pending} onClick={() => void run({ type: 'sendOrder', orderId: order.id })}>Отправить на приготовление</button>}
      {active && activeItems.some(item => item.status === 'preparing') && <button type="button" className="primary"
        disabled={pending} onClick={() => void run({ type: 'readyOrder', orderId: order.id })}>Отметить блюда готовыми</button>}
      {active && activeItems.length > 0 && activeItems.every(item => item.status === 'served') && <>
        {!order.precheckAt && <button type="button" className="secondary" disabled={pending}
          onClick={() => void run({ type: 'precheckOrder', orderId: order.id })}>Запросить пречек</button>}
        <button type="button" className="primary" disabled={pending}
          onClick={() => void run({ type: 'closeOrder', orderId: order.id })}>Завершить обслуживание</button>
      </>}
      {active && order.precheckAt !== undefined && <button type="button" className="secondary" disabled={pending}
        onClick={() => void run({ type: 'reopenOrder', orderId: order.id })}>Вернуть к обслуживанию</button>}
      {active && activeItems.every(item => item.status !== 'served') && (
        confirmCancel
          ? <button type="button" className="admin-archive" disabled={pending} onClick={() => void run({ type: 'cancelOrder', orderId: order.id })}>Подтвердить отмену заказа</button>
          : <button type="button" className="admin-archive" disabled={pending} onClick={() => setConfirmCancel(true)}>Отменить заказ</button>
      )}
    </div>
    <h3 className="admin-dialog-section-title">История изменений</h3>
    <Audit state={state} orderId={order.id} />
  </>
}

function SystemSettings({ settings, execute }: {settings: Settings; execute: Props['execute']}) {
  const [feedback, setFeedback] = useState('')
  return <>
    <div className="admin-panel admin-panel-padding">
      <Form onSave={async data => {
        setFeedback('')
        const next: Settings = {
          ...settings,
          venueName: fieldText(data, 'venueName'), waitMinutes: fieldNumber(data, 'waitMinutes'),
          criticalMinutes: fieldNumber(data, 'criticalMinutes'), prepMinutes: fieldNumber(data, 'prepMinutes'),
          readyMinutes: fieldNumber(data, 'readyMinutes'), defaultMin: fieldNumber(data, 'defaultMin'),
        }
        await execute({ type: 'saveSettings', settings: next })
        setFeedback('Настройки сохранены')
      }}>
        <Field label="Название заведения"><input name="venueName" required maxLength={100} defaultValue={settings.venueName} /></Field>
        <div className="admin-columns">
          <Field label="Ожидание, мин"><input name="waitMinutes" type="number" inputMode="numeric" min={1} required defaultValue={settings.waitMinutes} /></Field>
          <Field label="Критическая задержка, мин"><input name="criticalMinutes" type="number" inputMode="numeric" min={1} required defaultValue={settings.criticalMinutes} /></Field>
          <Field label="Приготовление, мин"><input name="prepMinutes" type="number" inputMode="numeric" min={1} required defaultValue={settings.prepMinutes} /></Field>
          <Field label="Ожидание выдачи, мин"><input name="readyMinutes" type="number" inputMode="numeric" min={1} required defaultValue={settings.readyMinutes} /></Field>
        </div>
        <Field label="Минимальный остаток по умолчанию"><input name="defaultMin" type="number" inputMode="numeric" min={0} required defaultValue={settings.defaultMin} /></Field>
      </Form>
    </div>
    {feedback && <p className="admin-success" role="status"><Check size={17} />{feedback}</p>}
  </>
}

export default function Admin({ state, user, execute, openOrder, onLogout, connection, onlineUserIds }: Props) {
  const [page, setPage] = useState<Page>('overview')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const currentPage = page === 'orders' || page === 'settings' || page === 'audit' ? 'more' : page
  const showBack = currentPage !== page

  function navigate(nextPage: Page) {
    setPage(nextPage)
    if (page !== nextPage) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      window.requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
    }
  }
  async function save(command: Command) {
    await execute(command)
    setDialog(null)
  }

  const employee = dialog?.kind === 'staff' ? state.users[dialog.id] : undefined
  const order = dialog?.kind === 'order' ? state.orders[dialog.id] : undefined
  const modalTitle = dialog && ({
    product: 'Товар', import: 'Импорт меню', category: 'Категория', hall: 'Зал', table: 'Стол',
    staff: employee?.name ?? 'Сотрудник', order: order ? orderTitle(order) : 'Заказ',
  }[dialog.kind])

  return <div className="admin-shell">
    <main className="admin-content">
      <header className="admin-heading">
        {showBack && <button type="button" className="admin-icon-button" onClick={() => navigate('more')} aria-label="Назад"><ArrowLeft size={19} /></button>}
        <div><h1 ref={heading} tabIndex={-1}>{titles[page]}</h1>
          {page === 'overview' && <p>{state.users[user.userId]?.name ?? user.name}</p>}
        </div>
        {page === 'overview' && <span className="admin-connection"><Activity size={15} />{connection}</span>}
        {page === 'orders' && <ListFilter className="admin-heading-icon" aria-hidden="true" size={21} />}
      </header>
      <div className="admin-page" key={page}>
        {page === 'overview' && <Overview state={state} open={setDialog} navigate={navigate} />}
        {page === 'catalog' && <Catalog state={state} open={setDialog} execute={execute} />}
        {page === 'floor' && <Floor state={state} open={setDialog} />}
        {page === 'staff' && <Staff state={state} onlineUserIds={onlineUserIds} open={setDialog} />}
        {page === 'orders' && <Orders state={state} open={setDialog} />}
        {page === 'audit' && <Audit state={state} />}
        {page === 'settings' && <SystemSettings settings={state.settings} execute={execute} />}
        {page === 'more' && <>
          <div className="admin-panel">
            <ActionRow icon={<ClipboardList size={19} />} label="Заказы" detail="Статусы и назначение официантов" onClick={() => navigate('orders')} />
            <ActionRow icon={<SettingsIcon size={19} />} label="Настройки" detail="Заведение, пороги и тестовые данные" onClick={() => navigate('settings')} />
            <ActionRow icon={<History size={19} />} label="Журнал операций" onClick={() => navigate('audit')} />
          </div>
          <div className="admin-panel"><ActionRow icon={<LogOut size={19} />} label="Выйти" onClick={onLogout} danger /></div>
        </>}
      </div>
    </main>
    <nav className="admin-nav" aria-label="Навигация администратора">
      {nav.map(({ page: target, label, icon: Icon }) => <button key={target} type="button" aria-current={currentPage === target ? 'page' : undefined}
        onClick={() => navigate(target)}><Icon size={21} strokeWidth={1.8} /><span>{label}</span></button>)}
    </nav>
    {dialog && modalTitle && <Modal key={`${dialog.kind}-${'id' in dialog ? dialog.id : ''}`} title={modalTitle} onClose={() => setDialog(null)}>
      {dialog.kind === 'product' && <ProductForm state={state} product={dialog.value} execute={save} />}
      {dialog.kind === 'import' && <MenuImport state={state} execute={execute} />}
      {dialog.kind === 'category' && <CategoryForm state={state} category={dialog.value} execute={save} />}
      {dialog.kind === 'hall' && <HallForm hall={dialog.value} execute={save} />}
      {dialog.kind === 'table' && <TableForm table={dialog.value} state={state} execute={save} />}
      {dialog.kind === 'staff' && employee && <StaffForm employee={employee} currentId={user.userId} state={state} execute={save}
        openOrder={id => setDialog({ kind: 'order', id })} />}
      {dialog.kind === 'order' && order && <OrderDetail order={order} state={state} execute={execute} openOrder={id => { setDialog(null); openOrder(id) }} />}
    </Modal>}
  </div>
}
