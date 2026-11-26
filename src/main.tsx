import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

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
        active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
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
