import { useEffect, useState } from 'react'
import { mobilePlatform, standaloneMode } from './InstallGuide'

const vibrationPattern = [120, 70, 120]
type Permission = NotificationPermission | 'install' | 'unavailable'

function readPermission(): Permission {
  if (mobilePlatform() === 'ios' && !standaloneMode()) return 'install'
  if (!window.isSecureContext || !navigator.serviceWorker || typeof Notification === 'undefined' ||
    typeof Notification.requestPermission !== 'function') return 'unavailable'
  return Notification.permission
}

export function vibrateDevice(pattern: number | number[] = vibrationPattern) {
  return !document.hidden && typeof navigator.vibrate === 'function' && navigator.vibrate(pattern)
}

export async function showSystemNotification(body: string, tag: string, sound: boolean, vibration: boolean) {
  const worker = await navigator.serviceWorker.getRegistration()
  if (!worker?.active) throw new Error('Приложение ещё загружается. Обновите страницу и повторите проверку.')
  const options: NotificationOptions & { vibrate?: number[] } = {
    body, tag, icon: new URL('icons/icon-192.png', worker.scope).href,
  }
  if (!sound && !vibration) options.silent = true
  else options.vibrate = vibration ? vibrationPattern : []
  await worker.showNotification('COFFEEMAN', options)
}

export function useSystemNotifications() {
  const [permission, setPermission] = useState(readPermission)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const refresh = () => setPermission(readPermission())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  async function runTest(sound: boolean, vibration: boolean, enable: boolean) {
    setFeedback('')
    setPending(true)
    try {
      const current = readPermission()
      const result = enable && current === 'default' ? await Notification.requestPermission() : current
      setPermission(result)
      if (result === 'default') setFeedback('Выберите «Разрешить» в запросе браузера.')
      if (result !== 'granted') return
      await showSystemNotification('Проверка системных уведомлений', 'coffeeman-test', sound, vibration)
      setFeedback('Тестовое уведомление отправлено. Проверьте шторку уведомлений.')
    } catch (error) {
      setFeedback(error instanceof Error && error.name === 'Error' ? error.message : 'Не удалось показать уведомление. Проверьте разрешения браузера и устройства.')
    } finally { setPending(false) }
  }

  return { permission, pending, feedback, runTest }
}

export function SystemNotificationSettings({ permission, pending, feedback, onEnable, onTest, onInstall }: {
  permission: Permission; pending: boolean; feedback: string;
  onEnable: () => void; onTest: () => void; onInstall: () => void;
}) {
  const hints: Record<Permission, string> = {
    default: 'Разрешите уведомления в запросе браузера, чтобы получать их на устройстве.',
    granted: 'Разрешены. Звук и вибрация системных уведомлений зависят от настроек устройства.',
    denied: mobilePlatform() === 'ios'
      ? 'Включите уведомления в настройках iPhone для COFFEEMAN.'
      : 'Включите уведомления для этого сайта в настройках браузера и проверьте разрешение браузера в настройках телефона.',
    install: 'На iPhone добавьте COFFEEMAN на экран «Домой» и откройте его с иконки. Затем вернитесь сюда, чтобы разрешить уведомления.',
    unavailable: 'Этот браузер не поддерживает системные уведомления. Оповещения будут видны внутри приложения.',
  }
  return <section className="panel system-notifications" aria-label="Системные уведомления">
    <h3 className="section-heading">Системные уведомления</h3>
    <p className="sheet-note">{hints[permission]}</p>
    {permission === 'install' && <button type="button" className="secondary" onClick={onInstall}>Как установить COFFEEMAN</button>}
    {permission === 'default' && <button type="button" className="primary" disabled={pending} onClick={onEnable}>Разрешить системные уведомления</button>}
    {permission === 'granted' && <button type="button" className="secondary" disabled={pending} onClick={onTest}>Проверить системное уведомление</button>}
    {feedback && <p className="sheet-note" role="status">{feedback}</p>}
  </section>
}
