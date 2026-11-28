import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AppearanceSettings, useAppearance } from './Appearance'
import {
  Armchair, Ban, Bell, ClipboardList, FilePlus2, Home as HomeIcon,
  LoaderCircle, Plus, UserRound, WifiOff, X,
} from 'lucide-react'
import { emptyState, entries, orderAlerts, orderTitle } from './domain'
import type { Command, Session } from './domain'
import { confirmServedRemoval, hasRemovalCredential } from './device-verification'
import { useInstallGuide } from './InstallGuide'
import { Orders } from './Orders'
import type { OrdersScreen } from './Orders'
import { store } from './store'
import type { Connection } from './store'
import { showSystemNotification, SystemNotificationSettings, useSystemNotifications, vibrateDevice } from './SystemNotifications'
import { Home, Profile, Stock, Toggle, defaultPreferences } from './Waiter'
import type { Preferences, ProfileScreen } from './Waiter'
import { ActionRow, Empty, IconButton, Sheet } from './ui'

const Admin = lazy(() => import('./Admin'))
type Screen = OrdersScreen | {page: 'home' | 'stock'} | {page: 'profile'; view?: ProfileScreen}
type Tab = 'home' | 'orders' | 'stock' | 'profile'
const tabs = [
  {page: 'home', title: 'Главная', Icon: HomeIcon},
  {page: 'orders', title: 'Заказы', Icon: ClipboardList},
  {page: 'stock', title: 'Стоп-лист', Icon: Ban},
  {page: 'profile', title: 'Профиль', Icon: UserRound},
] as const

function playAlertTone(context: AudioContext) {
  const oscillator = context.createOscillator()
  const volume = context.createGain()
  const start = context.currentTime
  oscillator.frequency.value = 740
  volume.gain.setValueAtTime(0.24, start)
  volume.gain.exponentialRampToValueAtTime(0.001, start + 0.4)
  oscillator.connect(volume).connect(context.destination)
  oscillator.start(start)
  oscillator.stop(start + 0.4)
}

function sameScreen(a: Screen | undefined, b: Screen) {
  if (!a || a.page !== b.page) return false
  if (a.page === 'profile' && b.page === 'profile') return (a.view ?? 'profile') === (b.view ?? 'profile')
  if (a.page === 'order' && b.page === 'order') return a.orderId === b.orderId
  if (a.page === 'catalog' && b.page === 'catalog') {
    return a.orderId === b.orderId && a.guestId === b.guestId && a.categoryId === b.categoryId
  }
  return true
}

function loadPreferences(id?: string): Preferences {
  try { return {...defaultPreferences, ...JSON.parse(localStorage.getItem('coffeeman:preferences:' + id) ?? '{}')} }
  catch { return defaultPreferences }
}

function Loading() {
  return <div className="loading-page" role="status"><LoaderCircle className="spinning" size={25} /><small>Загрузка COFFEEMAN</small></div>
}

function Login({ onLogin, startupError, onInstall }: {onLogin: (session: Session) => void; startupError: string; onInstall?: () => void}) {
  const [name, setName] = useState('')
  const [remember, setRemember] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(startupError)
  const [compact, setCompact] = useState(false)
  const demo = store.mode === 'demo'

  useEffect(() => {
    const viewport = window.visualViewport
    const resize = () => setCompact((viewport?.height ?? window.innerHeight) < 520)
    viewport?.addEventListener('resize', resize)
    window.addEventListener('resize', resize)
    resize()
    return () => {
      viewport?.removeEventListener('resize', resize)
      window.removeEventListener('resize', resize)
    }
  }, [])
  const enter = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      onLogin(await store.login(name.trim(), remember))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить вход.')
    } finally {
      setPending(false)
    }
  }
  return <main className="login-page" data-compact={compact}>
    <div className="login-content">
      <header className="login-brand">
        <img src={import.meta.env.BASE_URL + 'mark.svg'} alt="" width={88} height={88} />
        <h1>COFFEEMAN</h1><p>Waiter System</p>
      </header>
      <form className="login-form" onSubmit={enter}>
        <label className="login-input"><UserRound size={19} /><input
          type="text" aria-label="Имя сотрудника"
          placeholder="Имя сотрудника" autoComplete="nickname" enterKeyHint="go"
          value={name} onChange={event => setName(event.target.value)} required maxLength={60} />
        </label>
        <p className="muted">Введите имя точно так же, как при предыдущем входе.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="primary" disabled={pending}>{pending ? 'Вход…' : 'Войти'}</button>
      </form>
    </div>
    <div className="login-footer">
      <Toggle text="Запомнить меня" detail="На этом устройстве" value={remember} onChange={setRemember} />
      {demo && <p className="mode-note">Локальный режим · admin для управления</p>}
      {onInstall && <button type="button" className="login-install-link" onClick={onInstall}>Как установить приложение</button>}
    </div>
  </main>
}

export default function App() {
  const appearance = useAppearance()
  const systemNotifications = useSystemNotifications()
  const [session, setSession] = useState<Session | null>(null)
  const [state, setState] = useState(emptyState)
  const [loading, setLoading] = useState(true)
  const {dialog: installDialog, openGuide} = useInstallGuide(!loading)
  const [onlineUsers, setOnlineUsers] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState('')
  const [network, setNetwork] = useState<Connection>(store.mode === 'demo' ? 'demo' : 'connecting')
  const connected = network === 'online' || network === 'demo'
  const [screen, setScreen] = useState<Screen>({page: 'home'})
  const returnScreen = useRef<Screen>({page: 'orders'})
  const [modal, setModal] = useState<'quick' | 'notifications'>()
  const [toast, setToast] = useState('')
  const [now, setNow] = useState(Date.now)
  const [seen, setSeen] = useState(Date.now)
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [removalEnabled, setRemovalEnabled] = useState(false)
  const [stockFilter, setStockFilter] = useState<'all' | 'out' | 'low' | 'in'>('all')
  const [stockQuery, setStockQuery] = useState('')
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day')
  const audio = useRef<AudioContext | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const delivered = useRef(new Set<string>())
  const runRestore = useRef<ReturnType<typeof store.restore> | undefined>(undefined)
  const admin = session?.role === 'admin'
  const active = session && state.users[session.userId]
  const deactivated = active?.active === false
  const demo = store.mode === 'demo'

  useEffect(() => {
    let subscribed = true
    runRestore.current ??= store.restore()
    runRestore.current.then(value => {
      if (subscribed) {
        setSession(value)
        setPreferences(loadPreferences(value?.userId))
        setRemovalEnabled(Boolean(value && hasRemovalCredential(value.userId)))
      }
    }).catch(err => {
      if (subscribed) setError(err instanceof Error ? err.message : 'Не удалось восстановить сессию.')
    }).finally(() => { if (subscribed) setLoading(false) })
    return () => { subscribed = false }
  }, [])

  useEffect(() => store.subscribeConnection(setNetwork), [])
  useEffect(() => {
    if (!session || deactivated) {
      setOnlineUsers(new Set())
      return
    }
    return store.subscribePresence(setOnlineUsers, err => setToast(err.message))
  }, [session, deactivated])

  useEffect(() => {
    if (!session) return
    let initial = true
    return store.subscribe(next => {
      if (initial) {
        for (const id of Object.keys(next.notifications)) delivered.current.add(id)
        initial = false
      }
      setState(next)
      setNow(Date.now())
    }, err => setToast(err.message))
  }, [session])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000)
    return () => { clearInterval(interval); clearTimeout(timer.current) }
  }, [])
  useEffect(() => {
    if (!toast) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(''), 4800)
    return () => clearTimeout(timer.current)
  }, [toast])

  useEffect(() => {
    if (!preferences.sound) return
    const activate = () => { void unlockSound().catch(() => undefined) }
    document.addEventListener('click', activate, true)
    document.addEventListener('keydown', activate, true)
    return () => {
      document.removeEventListener('click', activate, true)
      document.removeEventListener('keydown', activate, true)
    }
  }, [preferences.sound])

  async function unlockSound(preview = false) {
    const context = audio.current ??= new AudioContext()
    if (context.state !== 'running') await context.resume()
    if (preview && context.state === 'running') playAlertTone(context)
  }

  const visibleNotices = entries(state.notifications).filter(notice =>
    (!notice.userId || notice.userId === session?.userId) && preferences[notice.type],
  ).sort((a, b) => b.at - a.at)
  const alerts = session && preferences.delay ? orderAlerts(state, now, session.userId).filter(alert => alert.tone !== 'green') : []
  const liveSignals = [
    ...visibleNotices.map(notice => ({id: notice.id, message: notice.message})),
    ...alerts.map(alert => ({id: `alert_${alert.orderId}_${alert.reason}_${alert.tone}`, message: `${orderTitle(state.orders[alert.orderId])} · ${alert.reason}`})),
  ]
  const liveSignature = JSON.stringify(liveSignals)
  useEffect(() => {
    if (!session) return
    const signals = JSON.parse(liveSignature) as typeof liveSignals
    const next = signals.find(signal => !delivered.current.has(signal.id) && !(demo && signal.id.startsWith('alert_demo-')))
    signals.forEach(signal => delivered.current.add(signal.id))
    if (!next) return
    if (modal !== 'notifications') setToast(next.message)
    const vibrated = preferences.vibration && vibrateDevice()
    const localSound = () => {
      if (!document.hidden && preferences.sound && audio.current) void unlockSound(true).catch(() => undefined)
    }
    const systemFeedback = document.hidden || (preferences.vibration && !vibrated)
    if (systemNotifications.permission === 'granted') {
      if (!systemFeedback) localSound()
      void showSystemNotification(next.message, next.id, systemFeedback && preferences.sound, preferences.vibration && !vibrated)
        .catch(() => { if (systemFeedback) localSound() })
    } else localSound()
  }, [liveSignature, modal, session, preferences.sound, preferences.vibration, demo, systemNotifications.permission])

  useEffect(() => {
    const back = (event: PopStateEvent) => {
      const target = event.state?.coffeemanScreen as Screen | undefined
      setModal(undefined)
      setScreen(target ?? {page: 'home'})
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  const navigate = (target: Screen, reset = false) => {
    setModal(undefined)
    const current = window.history.state
    const wantsNewTab = target.page === 'tables' && target.initialTab
    if (!reset && !wantsNewTab && sameScreen(current?.previousScreen, target)) {
      window.history.back()
      return
    }
    const categoryChange = screen.page === 'catalog' && target.page === 'catalog'
    const save = reset || categoryChange ? window.history.replaceState : window.history.pushState
    save.call(window.history, {
      coffeemanScreen: target.page === 'tables' ? {page: 'tables'} : target,
      previousScreen: reset ? undefined : categoryChange ? current?.previousScreen : screen,
    }, '')
    setScreen(target)
    if (target.page !== screen.page) window.scrollTo(0, 0)
  }
  const openOrder = (id: string) => {
    returnScreen.current = screen
    navigate({page: 'order', orderId: id})
  }
  const orderNavigate = (target: OrdersScreen) => {
    if (target.page === 'order' && screen.page === 'orders') returnScreen.current = screen
    navigate(target.page === 'orders' && screen.page === 'order' ? returnScreen.current : target)
  }
  const logout = async () => {
    try {
      await store.logout()
      setState(emptyState())
      setSession(null)
      setToast('')
      delivered.current.clear()
      navigate({page: 'home'}, true)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Не удалось завершить сеанс.')
    }
  }
  const testSignals = () => {
    const vibrated = preferences.vibration && vibrateDevice()
    if (preferences.sound) void unlockSound(true).catch(() => setToast('Браузер не смог воспроизвести звук'))
    setToast(preferences.vibration && !vibrated
      ? 'Вибрация в браузере недоступна. Проверьте системное уведомление и настройки телефона.'
      : preferences.sound || vibrated ? 'Проверка оповещений' : 'Включите звук или вибрацию в настройках приложения.')
  }
  const updatePreference = (key: keyof Preferences, value: boolean) => {
    if (key === 'sound' && value) void unlockSound(true).catch(() => setToast('Браузер не смог воспроизвести звук'))
    if (key === 'vibration' && value) vibrateDevice(65)
    const updated = {...preferences, [key]: value}
    setPreferences(updated)
    try { localStorage.setItem('coffeeman:preferences:' + session?.userId, JSON.stringify(updated)) }
    catch { /* Settings still apply in this session. */ }
  }
  const execute = async (command: Command) => { await store.dispatch(command) }
  const connection = demo
    ? connected ? 'Локальный режим · Данные в браузере' : 'Нет интернета · Локальные данные'
    : connected ? 'Firebase · Синхронизация активна' : 'Firebase · Соединение восстанавливается'
  const openNotifications = () => { setSeen(Date.now()); setModal('notifications') }

  if (loading) return <Loading />
  if (!session) return <><Login startupError={error} onInstall={openGuide} onLogin={value => {
    setSeen(Date.now())
    setSession(value)
    setPreferences(loadPreferences(value.userId))
    setRemovalEnabled(hasRemovalCredential(value.userId))
    navigate({page: 'home'}, true)
  }} />{installDialog}</>

  if (deactivated) return <main className="main-page app-shell"><h1>Доступ приостановлен</h1><p className="sheet-note">Обратитесь к администратору заведения.</p><button className="secondary" onClick={() => void logout()}>Выйти</button></main>

  const tab = tabs.find(item => item.page === screen.page)?.page as Tab | undefined
  const withNav = !admin && !!tab
  const orderView = screen.page === 'orders' || screen.page === 'tables' || screen.page === 'order' || screen.page === 'catalog'
  const showOrders = orderView && (!admin || screen.page === 'order' || screen.page === 'catalog')
  const appearanceSettings = <AppearanceSettings {...appearance} />
  const notificationSettings = <SystemNotificationSettings permission={systemNotifications.permission} pending={systemNotifications.pending} feedback={systemNotifications.feedback}
    onEnable={() => { void systemNotifications.runTest(preferences.sound, preferences.vibration, true) }}
    onTest={() => { void systemNotifications.runTest(preferences.sound, preferences.vibration, false) }}
    onInstall={() => { setModal(undefined); openGuide?.() }} />
  return <div className={`app-shell ${withNav ? 'with-nav' : ''} ${modal === 'quick' ? 'showing-quick' : ''}`}>
    {!connected && !demo && <div className="offline-bar" role="status"><WifiOff size={17} /> Нет связи с Firebase. Изменения доступны после подключения.</div>}
    {admin ? <div hidden={showOrders}>
      <button type="button" onClick={openNotifications}>Уведомления {visibleNotices.filter(n=>n.at>seen).length || ''}</button>
      <Suspense fallback={<Loading />}><Admin state={state} user={session} execute={execute} openOrder={openOrder} onLogout={() => void logout()} connection={connection} onlineUserIds={onlineUsers} appearanceSettings={appearanceSettings} /></Suspense>
    </div> :
      <>
        {screen.page === 'home' && <Home state={state} user={session} now={now} connection={connection} connected={connected}
          notify={openNotifications} unread={visibleNotices.some(notice => notice.at > seen) || alerts.length > 0}
          showConnection={preferences.connection} openOrder={openOrder} quick={() => setModal('quick')} />}
        {screen.page === 'stock' && <Stock state={state} execute={execute} filter={stockFilter} onFilter={setStockFilter} query={stockQuery} onQuery={setStockQuery} />}
        {screen.page === 'profile' && <Profile state={state} user={session} now={now} screen={screen.view ?? 'profile'}
          navigate={view => navigate({page: 'profile', view})} preferences={preferences} setPreference={updatePreference}
          testSignals={testSignals} removalEnabled={removalEnabled} setRemovalEnabled={setRemovalEnabled} appearanceSettings={appearanceSettings} notificationSettings={notificationSettings}
          connection={connection} period={period} setPeriod={setPeriod} onInstall={openGuide} notify={openNotifications} openOrder={openOrder} logout={() => void logout()} />}
      </>}
    {(!admin || showOrders) && <div hidden={!showOrders}>
      <Orders state={state} user={session} execute={execute} verifyServedRemoval={removalEnabled ? () => confirmServedRemoval(session.userId) : undefined}
        screen={orderView ? screen : {page: 'orders'}} navigate={orderNavigate} openQuick={() => setModal('quick')} />
    </div>}
    {withNav && <nav className="bottom-nav" aria-label="Основная навигация">
      {tabs.map(({ page, title, Icon }) => <button type="button" key={page} aria-current={tab === page ? 'page' : undefined} onClick={() => {
        if (tab !== page || (screen.page === 'profile' && screen.view !== 'profile')) navigate({page})
      }}><Icon size={21} strokeWidth={tab === page ? 2.4 : 1.8} /><span>{title}</span></button>)}
    </nav>}
    {modal === 'quick' && <Sheet title="Быстрые действия" className="quick-sheet" onClose={() => setModal(undefined)}>
      <div className="quick-list panel">
        <ActionRow icon={<Plus size={19} />} label="Новый заказ" onClick={() => navigate({page: 'tables'})} />
        <ActionRow icon={<Armchair size={19} />} label="Выбрать стол" onClick={() => navigate({page: 'tables'})} />
        <ActionRow icon={<FilePlus2 size={19} />} label="Создать таб" onClick={() => navigate({page: 'tables', initialTab: true})} />
        <ActionRow icon={<Ban size={19} />} label="Стоп-лист" onClick={() => navigate({page: 'stock'})} />
      </div>
    </Sheet>}
    {modal === 'notifications' && <Sheet title="Уведомления" onClose={() => setModal(undefined)}>
      {notificationSettings}
      <div className="notice-list">
        {alerts.map(alert => <ActionRow key={`alert-${alert.orderId}`} icon={<Bell size={17} />}
          label={orderTitle(state.orders[alert.orderId])} detail={alert.reason} onClick={() => openOrder(alert.orderId)} />)}
        {visibleNotices.slice(0, 25).map(notice => {
          const timestamp = new Date(notice.at).toLocaleString('ru-RU', {dateStyle: 'short', timeStyle: 'short'})
          const onClick = notice.orderId ? () => openOrder(notice.orderId!) : notice.productId ? () => navigate({page: 'stock'}) : undefined
          return onClick ? <ActionRow key={notice.id} icon={<Bell size={17} />} label={notice.message} detail={timestamp} onClick={onClick} />
            : <div key={notice.id} className="metric panel"><span>{notice.message}</span><small>{timestamp}</small></div>
        })}
        {alerts.length + visibleNotices.length === 0 && <Empty icon={<Bell size={22} />} title="Уведомлений нет" />}
      </div>
    </Sheet>}
    {installDialog}
    {toast && !modal && <div className="toast" role="status"><span>{toast}</span><IconButton label="Закрыть уведомление" onClick={() => setToast('')}><X size={16} /></IconButton></div>}
  </div>
}
