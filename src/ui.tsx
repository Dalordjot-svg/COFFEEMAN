import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ChevronRight, X } from 'lucide-react'

export const money = (value: number) => new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(value)

export function IconButton({ label, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return <div className="segmented" role="group" aria-label={label}>{options.map((option) =>
    <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      {option.label}
    </button>)}</div>
}

export function Empty({ icon, title, detail }: {icon?: ReactNode; title: string; detail?: string}) {
  return <div className="empty">{icon && <span className="empty-icon">{icon}</span>}<strong>{title}</strong>{detail && <small>{detail}</small>}</div>
}

export function Sheet({ children, title, onClose, className = '' }: {children: ReactNode; title: string; onClose: () => void; className?: string}) {
  const ref = useRef<HTMLDialogElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const headingId = useId()
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => {
      clearTimeout(timer.current)
      dialog?.close()
    }
  }, [])
  const requestClose = () => {
    if (closing) return
    setClosing(true)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    timer.current = setTimeout(onClose, reduced ? 0 : 210)
  }
  return <dialog
    ref={ref}
    aria-labelledby={className === 'quick-sheet' ? undefined : headingId}
    aria-label={className === 'quick-sheet' ? title : undefined}
    className={`root-sheet ${className} ${closing ? 'is-closing' : ''}`}
    onCancel={event => { event.preventDefault(); requestClose() }}
    onClick={event => { if (event.target === event.currentTarget) requestClose() }}>
    {className === 'quick-sheet' && <IconButton label="Закрыть быстрые действия" className="quick-close" onClick={requestClose}><X size={22} /></IconButton>}
    <div className="root-sheet-content">
      <div className="sheet-handle" />
      <div className="sheet-title"><h2 id={headingId}>{title}</h2><IconButton label="Закрыть" onClick={requestClose}><X size={18} /></IconButton></div>
      {children}
    </div>
  </dialog>
}

export function ActionRow({ icon, label, detail, onClick, danger }: {icon: ReactNode; label: string; detail?: string; onClick: () => void; danger?: boolean}) {
  return <button type="button" className={`action-row ${danger ? 'danger' : ''}`} onClick={onClick}>
    <span className="action-icon">{icon}</span><span className="action-copy">{label}{detail && <small>{detail}</small>}</span><ChevronRight className="action-arrow" size={16} />
  </button>
}
