import { useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowLeft, Bell, ChartNoAxesColumnIncreasing, ChevronRight, CircleCheck,
  ClipboardList, Ellipsis, Info, LogOut, Minus, Package, Pencil, Plus,
  Search, Settings2, Vibrate, Volume2, Wifi, X,
} from 'lucide-react'
import {
  availableQuantity, entries, orderAlerts, orderStatus, orderStatusLabel, orderTitle, orderTotal, stats, stockStatus,
} from './domain'
import type { Command, Product, Session, State } from './domain'
import { ActionRow, Empty, IconButton, Segmented, Sheet, money } from './ui'

type Period = 'day' | 'week' | 'month'
export type ProfileScreen = 'profile' | 'stats' | 'history' | 'settings'
export type Preferences = typeof defaultPreferences
export const defaultPreferences = { sound: false, vibration: false, ready: true, delay: true, stock: true, connection: true }

export function Toggle({ text, detail, icon, value, onChange }: {text: string; detail?: string; icon?: ReactNode; value: boolean; onChange: (value: boolean) => void}) {
  return <label className="toggle-row">{icon}<span className="toggle-caption">{text}{detail && <small>{detail}</small>}</span>
    <input className="toggle" type="checkbox" role="switch" aria-label={text} checked={value} onChange={event => onChange(event.target.checked)} />
  </label>
}

function Metric({ label, value, detail }: {label: string; value: string | number; detail?: string}) {
  return <div className="metric panel"><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong>{detail && <small className="metric-meta">{detail}</small>}</div>
}

function Chart({ series, period }: {series: {label: string; value: number}[]; period: Period}) {
  const max = Math.max(1, ...series.map(point => point.value))
  const every = Math.max(1, Math.ceil(series.length / 4))
  const caption = period === 'day' ? 'По часам' : 'По дням'
  return <section className="chart panel"><div className="chart-head"><h2 className="section-heading">Динамика продаж</h2><small>{caption}</small></div>
    <div className="chart-bars" role="img" aria-label={series.filter(point => point.value).map(point => `${point.label} — ${money(point.value)}`).join(', ') || 'Продаж за период нет'}>
      {series.map((point, index) => <span key={`${point.label}-${index}`} className="chart-bar" data-empty={!point.value} style={{'--bar': `${100 * point.value / max}%`} as CSSProperties} title={`${point.label} · ${money(point.value)}`} />)}
    </div>
    <div className="chart-ticks" aria-hidden="true">{series.filter((_, index) => index % every === 0).map((point, index) => <span key={index}>{point.label}</span>)}</div>
  </section>
}

export function Home({ state, user, now, connection, connected, notify, unread, showConnection, openOrder, quick }: {
  state: State; user: Session; now: number; connection: string; connected: boolean; notify: () => void; unread: boolean;
  showConnection: boolean; openOrder: (id: string) => void; quick: () => void;
}) {
  const personal = stats(state, 'day', user.userId, now)
  const total = stats(state, 'day', undefined, now)
  const alerts = orderAlerts(state, now, user.userId)
  return <main className="main-page home-page">
    <header className="screen-heading">
      <div><h1>Главная</h1><p className="heading-caption">Привет, {state.users[user.userId]?.name ?? user.name} <span aria-hidden="true">👋</span></p></div>
      <div className="heading-actions">
        <IconButton label="Уведомления" className="header-icon" onClick={notify}><Bell size={19} />{unread && <i />}</IconButton>
        <IconButton label="Быстрые действия" onClick={quick}><Ellipsis size={22} /></IconButton>
      </div>
    </header>
    {showConnection && <p className="heading-connection" role="status"><span className={`status-dot ${connected ? 'green' : 'yellow'}`} />{connection}</p>}
    <div className="home-metrics">
      <Metric label="Продажи сегодня" value={money(total.sales)} detail={state.settings.venueName} />
      <Metric label="Мои продажи" value={money(personal.sales)} detail={`Заказов: ${personal.orders}`} />
    </div>
    <Chart series={personal.series} period="day" />
    <section className="attention panel">
      <div className="section-heading-row"><h2 className="section-heading">Требуют внимания</h2>{alerts.length > 0 && <span className="count-label">{alerts.length}</span>}</div>
      <div className="attention-list">
        {alerts.map(alert => {
          const order = state.orders[alert.orderId]
          return <button key={alert.orderId} className="attention-row" onClick={() => openOrder(order.id)}>
            <span className={`status-dot ${alert.tone}`} /><span className="attention-copy">
              <strong>{orderTitle(order)} <span className={`attention-age ${alert.tone}`}>· {alert.minutes} мин</span></strong>
              <small>{orderStatusLabel[orderStatus(order)]} · {alert.reason}</small>
            </span><ChevronRight size={16} className="attention-arrow" />
          </button>
        })}
        {alerts.length === 0 && <Empty icon={<CircleCheck size={21} />} title="Всё в порядке" detail="Заказы с задержкой и готовые блюда появятся здесь." />}
      </div>
    </section>
    <div className="panel home-metrics compact">
      <Metric label="Обслужено" value={personal.orders} /><Metric label="Активные" value={personal.active} />
      <Metric label="Гости" value={personal.guests} /><Metric label="Средний чек" value={money(personal.average)} />
    </div>
  </main>
}

const stockFilters = [
  { value: 'all', label: 'Все' }, { value: 'out', label: 'Закончились' },
  { value: 'low', label: 'Скоро' }, { value: 'in', label: 'В наличии' },
] as const
type StockFilter = typeof stockFilters[number]['value']
const stockLabels = { out: 'Закончился', low: 'Скоро закончится', in: 'Есть в наличии' }

export function Stock({ state, execute, filter, onFilter, query, onQuery }: {
  state: State; execute: (command: Command) => Promise<void>; filter: StockFilter; onFilter: (filter: StockFilter) => void;
  query: string; onQuery: (query: string) => void;
}) {
  const [editing, setEditing] = useState<string>()
  const tiers = { out: 0, low: 1, in: 2 }
  const products = entries(state.products).filter(product => !product.archived &&
    (filter === 'all' || stockStatus(state, product.id) === filter) &&
    product.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')),
  ).sort((a, b) => tiers[stockStatus(state, a.id)] - tiers[stockStatus(state, b.id)] || a.name.localeCompare(b.name, 'ru'))

  return <main className="main-page">
    <header className="screen-heading"><h1>Стоп-лист</h1></header>
    <div className="stock-toolbar">
      <Segmented label="Наличие товара" value={filter} options={stockFilters} onChange={onFilter} />
      <label className="stock-search"><Search size={18} /><input type="search" aria-label="Поиск товара" placeholder="Поиск товара" value={query} onChange={event => onQuery(event.target.value)} /></label>
    </div>
    <div className="stock-list panel">{products.map(product => {
      const status = stockStatus(state, product.id)
      const quantity = availableQuantity(state, product.id)
      return <button type="button" key={product.id} className="stock-row" aria-label={`Изменить остаток: ${product.name}`} onClick={() => setEditing(product.id)}>
        <span className={`status-dot ${status === 'out' ? 'red' : status === 'low' ? 'yellow' : ''}`} />
        <span className="stock-copy"><strong>{product.name}</strong><small className={status}>{product.available === false ? 'Временно снят с продажи' : stockLabels[status]}</small></span>
        <span className="stock-amount">{quantity === null ? 'Без учёта' : `${quantity} шт`}</span><Pencil size={15} className="stock-pen" />
      </button>
    })}{products.length === 0 && <Empty icon={<Package size={21} />} title="Нет товаров в этом списке" detail="Выберите другую вкладку или измените поиск." />}</div>
    {editing && state.products[editing] && <StockEdit key={editing} state={state} product={state.products[editing]} execute={execute} onClose={() => setEditing(undefined)} />}
  </main>
}

function StockEdit({ state, product, execute, onClose }: {state: State; product: Product; execute: (command: Command) => Promise<void>; onClose: () => void}) {
  const physical = state.inventory[product.id]?.quantity ?? null
  const available = availableQuantity(state, product.id)
  const reserved = physical !== null && available !== null ? physical - available : 0
  const [revision] = useState(state.inventory[product.id]?.revision ?? 0)
  const [counted, setCounted] = useState(physical !== null)
  const [quantity, setQuantity] = useState(String(physical ?? reserved))
  const [availability, setAvailability] = useState<boolean>()
  const enabled = availability ?? product.available !== false
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const change = (by: number) => setQuantity(String(Math.max(reserved, Number(quantity || 0) + by)))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await execute({type: 'updateInventory', productId: product.id, quantity: counted ? Number(quantity) : null, expectedRevision: revision, ...(availability === undefined ? {} : {available: availability})})
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить остаток.')
    } finally {
      setPending(false)
    }
  }
  return <Sheet title="Редактирование остатка" onClose={onClose}>
    <div className="stock-edit"><div><strong>{product.name}</strong><p className="sheet-note">{stockLabels[stockStatus(state, product.id)]}{reserved > 0 && ` · В резерве: ${reserved}`}</p></div></div>
    <form className="stock-edit-form" onSubmit={submit}>
      <Toggle text="В продаже" value={enabled} onChange={setAvailability} />
      <Toggle text="Количественный учёт" value={counted} onChange={setCounted} />
      {counted && <div className="field"><label htmlFor="physical-stock">Физический остаток</label>
        <div className="stepper">
          <button type="button" aria-label="Уменьшить остаток" onClick={() => change(-1)}><Minus size={18} /></button>
          <input id="physical-stock" type="number" inputMode="numeric" min={reserved} max={1000000} step={1} required value={quantity} onChange={event => setQuantity(event.target.value)} />
          <button type="button" aria-label="Увеличить остаток" onClick={() => change(1)}><Plus size={18} /></button>
        </div>
      </div>}
      <p className="sheet-note">После отправки блюда порции резервируются. Остаток уменьшается при выдаче.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="primary" disabled={pending} type="submit">{pending ? 'Сохранение…' : 'Сохранить'}</button>
    </form>
  </Sheet>
}

const periods = [{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }] as const
const preferenceRows = [
  { key: 'sound', label: 'Звуковые уведомления', Icon: Volume2 },
  { key: 'vibration', label: 'Вибрация', Icon: Vibrate },
  { key: 'ready', label: 'Готовность заказов', Icon: Bell },
  { key: 'delay', label: 'Длительное ожидание', Icon: Activity },
  { key: 'stock', label: 'Изменения стоп-листа', Icon: Package },
  { key: 'connection', label: 'Состояние синхронизации', Icon: Wifi },
] as const

export function Profile({ state, user, now, screen, navigate, preferences, setPreference, connection, period, setPeriod, notify, openOrder, logout }: {
  state: State; user: Session; now: number; screen: ProfileScreen; navigate: (screen: ProfileScreen) => void; preferences: Preferences;
  setPreference: (key: keyof Preferences, value: boolean) => void; connection: string; period: Period; setPeriod: (period: Period) => void;
  notify: () => void; openOrder: (id: string) => void; logout: () => void;
}) {
  const [info, setInfo] = useState(false)
  const title = { profile: 'Профиль', stats: 'Моя статистика', history: 'История заказов', settings: 'Настройки' }
  const name = state.users[user.userId]?.name ?? user.name
  const today = stats(state, 'day', user.userId, now)
  const current = stats(state, period, user.userId, now)
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  if (period === 'month') start.setDate(1)
  const history = entries(state.orders).filter(order => order.waiterId === user.userId && order.closedAt && order.closedAt >= +start && order.closedAt <= now)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  return <main className="main-page">
    <header className={`screen-heading ${screen !== 'profile' ? 'settings-heading' : ''}`}>
      {screen !== 'profile' && <IconButton label="Назад в профиль" onClick={() => navigate('profile')}><ArrowLeft size={20} /></IconButton>}
      <h1>{title[screen]}</h1>
    </header>
    {screen === 'profile' && <>
      <div className="profile-identity"><span className="avatar" aria-hidden="true">{[...name][0]?.toLocaleUpperCase('ru')}</span><strong>{name}</strong><small>Официант</small></div>
      <Metric label="Личные продажи сегодня" value={money(today.sales)} detail={`Заказов: ${today.orders} · Гостей: ${today.guests} · Средний чек: ${money(today.average)}`} />
      <div className="action-list panel">
        <ActionRow icon={<ChartNoAxesColumnIncreasing size={18} />} label="Моя статистика" onClick={() => navigate('stats')} />
        <ActionRow icon={<ClipboardList size={18} />} label="История заказов" onClick={() => navigate('history')} />
        <ActionRow icon={<Bell size={18} />} label="Уведомления" onClick={notify} />
        <ActionRow icon={<Settings2 size={18} />} label="Настройки" onClick={() => navigate('settings')} />
      </div>
      <div className="action-list panel"><ActionRow icon={<LogOut size={18} />} label="Выйти" onClick={logout} /></div>
    </>}
    {(screen === 'stats' || screen === 'history') && <Segmented label="Период" value={period} options={periods} onChange={setPeriod} />}
    {screen === 'stats' && <>
      <div className="home-metrics"><Metric label="Личные продажи" value={money(current.sales)} /><Metric label="Заказов" value={current.orders} /><Metric label="Гостей" value={current.guests} /><Metric label="Средний чек" value={money(current.average)} /></div>
      <Chart series={current.series} period={period} />
    </>}
    {screen === 'history' && <div className="profile-history">{history.map(order =>
      <button type="button" key={order.id} className="history-order panel" onClick={() => openOrder(order.id)}>
        <span><strong>{orderTitle(order)}</strong><small>{new Date(order.closedAt!).toLocaleString('ru-RU', {dateStyle: 'short', timeStyle: 'short'})}</small></span>
        <strong>{money(orderTotal(order))}</strong><ChevronRight size={16} />
      </button>,
    )}{history.length === 0 && <div className="panel"><Empty icon={<ClipboardList size={21} />} title="За этот период заказов нет" /></div>}</div>}
    {screen === 'settings' && <>
      <div className="settings-group panel">{preferenceRows.map(({ key, label, Icon }) => <Toggle key={key} text={label} icon={<Icon size={18} />} detail={key === 'connection' ? connection : undefined} value={preferences[key]} onChange={value => setPreference(key, value)} />)}</div>
      <div className="action-list panel"><ActionRow icon={<Info size={18} />} label="О приложении" detail="Версия 1.0.0" onClick={() => setInfo(true)} /></div>
    </>}
    {info && <Sheet title="О приложении" onClose={() => setInfo(false)}><p>COFFEEMAN — Waiter System</p><p className="sheet-note">Версия 1.0.0. Рабочее пространство для заказов, остатков и статистики.</p><button className="secondary" onClick={() => setInfo(false)}><X size={16} /> Закрыть</button></Sheet>}
  </main>
}
