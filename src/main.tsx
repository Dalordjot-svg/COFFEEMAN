import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './themes.css'

// Keep the focused native input visible when the visual viewport shrinks.
const viewport = window.visualViewport
const root = document.documentElement
let frame = 0
let baseline = window.innerHeight
const isTextField = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && (
    element.matches('textarea:not([readonly]):not([disabled]), [contenteditable="true"]') ||
    element instanceof HTMLInputElement && !element.readOnly && !element.disabled &&
      ['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(element.type)
  )
const updateViewport = () => {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const active = document.activeElement
    const editing = isTextField(active)
    const height = viewport?.height ?? window.innerHeight
    const top = viewport?.offsetTop ?? 0
    if (!editing) baseline = window.innerHeight
    const keyboard = editing && Math.max(baseline, window.innerHeight) - height > 100 &&
      Math.abs((viewport?.scale ?? 1) - 1) < 0.02
    root.toggleAttribute('data-keyboard-open', keyboard)
    root.style.setProperty('--mobile-visible-height', height + 'px')
    root.style.setProperty('--mobile-viewport-bottom',
      Math.max(0, root.clientHeight - height - top) + 'px')
    if (keyboard && isTextField(active)) {
      const rect = active.getBoundingClientRect()
      if (rect.bottom > top + height - 16 || rect.top < top + 16) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      }
    }
  })
}
viewport?.addEventListener('resize', updateViewport)
viewport?.addEventListener('scroll', updateViewport)
window.addEventListener('resize', updateViewport)
window.addEventListener('orientationchange', () => { baseline = 0; updateViewport() })
document.addEventListener('focusin', updateViewport)
document.addEventListener('focusout', updateViewport)
updateViewport()

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// Persistent synchronization diagnostics; no customer data in the copied code.
const syncNotice = document.createElement('aside')
syncNotice.setAttribute('role', 'alert')
syncNotice.hidden = true
syncNotice.className = 'sync-notice'
document.body.prepend(syncNotice)
let syncCode = ''
let syncOperation = ''
function showSyncNotice(message: string, code: string, operationId = '') {
  syncOperation = operationId
  syncCode = code + (operationId ? ' / ' + operationId : '')
  syncNotice.replaceChildren()
  const text = document.createElement('div')
  text.textContent = message
  const detail = document.createElement('div')
  detail.textContent = syncCode
  detail.style.cssText = 'font-size:12px;overflow-wrap:anywhere;margin:8px 0'
  const copy = document.createElement('button')
  copy.textContent = 'Скопировать код ошибки'
  copy.style.cssText = 'color:white;background:#2869e8;padding:10px;border-radius:8px'
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(syncCode); copy.textContent = 'Скопировано' }
    catch { window.prompt('Скопируйте код ошибки', syncCode) }
  }
  const close = document.createElement('button')
  close.textContent = 'Закрыть'
  close.style.cssText = 'color:inherit;padding:10px'
  close.onclick = () => { syncNotice.hidden = true }
  syncNotice.append(text, detail, copy, close)
  syncNotice.hidden = false
}
window.addEventListener('coffeeman-sync-error', event => {
  const {code, operationId} = (event as CustomEvent<{code: string; operationId: string}>).detail
  showSyncNotice('Сохранение данных не подтверждено. Свяжитесь с администратором.', code, operationId)
})
window.addEventListener('coffeeman-sync-confirmed', event => {
  if ((event as CustomEvent<{code: string; operationId: string}>).detail.operationId === syncOperation) syncNotice.hidden = true
})
