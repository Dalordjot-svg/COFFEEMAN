import { useEffect, useState } from 'react'
import { Download, Ellipsis, Share, Smartphone } from 'lucide-react'
import { Segmented, Sheet } from './ui'
import './install-guide.css'

type Platform = 'ios' | 'android'
type InstallChoice = { outcome: 'accepted' | 'dismissed' }
type BrowserInstallEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<InstallChoice>
}

const guideKey = 'coffeeman:install-guide:v1'

export function mobilePlatform(): Platform | undefined {
  if (/Android/i.test(navigator.userAgent)) return 'android'
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
}

export function standaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function seenGuide() {
  try { return localStorage.getItem(guideKey) === '1' }
  catch { return false }
}

function markGuideSeen() {
  try { localStorage.setItem(guideKey, '1') }
  catch { /* The guide still works when storage is unavailable. */ }
}

const options = [{value: 'ios', label: 'iPhone'}, {value: 'android', label: 'Android'}] as const

export function useInstallGuide(showOnFirstVisit: boolean) {
  const [platform] = useState(mobilePlatform)
  const [selected, setSelected] = useState<Platform>(platform ?? 'ios')
  const [standalone, setStandalone] = useState(standaloneMode)
  const [installed, setInstalled] = useState(false)
  const [open, setOpen] = useState(false)
  const [pendingEvent, setPendingEvent] = useState<BrowserInstallEvent>()
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone)')
    const displayChange = () => setStandalone(standaloneMode())
    const available = (event: Event) => {
      event.preventDefault()
      setPendingEvent(event as BrowserInstallEvent)
    }
    const completed = () => {
      markGuideSeen()
      setInstalled(true)
      setOpen(false)
      setPendingEvent(undefined)
    }
    mode.addEventListener('change', displayChange)
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', completed)
    return () => {
      mode.removeEventListener('change', displayChange)
      window.removeEventListener('beforeinstallprompt', available)
      window.removeEventListener('appinstalled', completed)
    }
  }, [])

  useEffect(() => {
    if (!showOnFirstVisit || standalone || installed || !platform || seenGuide()) return
    markGuideSeen()
    setOpen(true)
  }, [showOnFirstVisit, standalone, installed, platform])

  const startInstall = async () => {
    if (!pendingEvent || installing) return
    setInstalling(true)
    try {
      await pendingEvent.prompt()
      const choice = await pendingEvent.userChoice
      if (choice.outcome === 'accepted') {
        setInstalled(true)
        setOpen(false)
      }
    } catch {
      // Keep the browser-specific steps visible if this prompt is unavailable.
    } finally {
      setPendingEvent(undefined)
      setInstalling(false)
    }
  }

  const canShow = !standalone && !installed
  const dialog = canShow && open ? <Sheet title="Установить COFFEEMAN" className="install-guide" onClose={() => setOpen(false)}>
    <div className="install-summary"><span className="install-illustration"><Smartphone size={25} /></span>
      <p>Добавьте COFFEEMAN на главный экран. Запускайте его с иконки, чтобы работать в отдельном окне без адресной строки.</p>
    </div>
    <Segmented label="Устройство" value={selected} options={options} onChange={setSelected} />
    {selected === 'ios' ? <section className="install-instructions" aria-labelledby="install-ios-title">
      <h3 id="install-ios-title">На iPhone</h3>
      <ol>
        <li>Откройте эту страницу в Safari.</li>
        <li>Нажмите <Share size={17} aria-hidden="true" /> «Поделиться» и выберите «На экран Домой».</li>
        <li>Если есть переключатель «Открывать как веб-приложение», включите его. Нажмите «Добавить».</li>
      </ol>
    </section> : <section className="install-instructions" aria-labelledby="install-android-title">
      <h3 id="install-android-title">На Android</h3>
      <ol>
        <li>Откройте эту страницу в Chrome.</li>
        <li>Нажмите <Ellipsis size={17} aria-hidden="true" /> меню браузера и выберите «Установить приложение». В некоторых версиях этот пункт находится в меню «Добавить на главный экран».</li>
        <li>Подтвердите установку и откройте COFFEEMAN с главного экрана.</li>
      </ol>
    </section>}
    <div className="install-actions">
      {selected === 'android' && platform === 'android' && pendingEvent &&
        <button type="button" className="primary" onClick={() => void startInstall()} disabled={installing}><Download size={18} /> Установить</button>}
      <button type="button" className="secondary" onClick={() => setOpen(false)}>Позже</button>
    </div>
  </Sheet> : null

  return {
    openGuide: canShow ? () => { markGuideSeen(); setSelected(platform ?? 'ios'); setOpen(true) } : undefined,
    dialog,
  }
}
