import { useLayoutEffect, useState } from 'react'
import { Segmented } from './ui'

const themes = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светло-серая' },
  { value: 'winter', label: 'Зимняя' },
] as const

type Theme = typeof themes[number]['value']
const themeKey = 'coffeeman:appearance'

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(themeKey)
    return themes.find(theme => theme.value === saved)?.value ?? 'dark'
  } catch { return 'dark' }
}

export function useAppearance() {
  const [theme, setTheme] = useState(readTheme)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    const background = getComputedStyle(root).getPropertyValue('--bg').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
    try { localStorage.setItem(themeKey, theme) }
    catch { /* The selected theme still applies for this session. */ }
  }, [theme])
  return { theme, setTheme }
}

export function AppearanceSettings({ theme, setTheme }: { theme: Theme; setTheme: (theme: Theme) => void }) {
  return <section className="appearance-settings panel" aria-label="Оформление">
    <h2 className="section-heading">Оформление</h2>
    <Segmented label="Тема оформления" options={themes} value={theme} onChange={setTheme} />
    <p className="sheet-note"><strong>В тестировании.</strong> В светло-серой и зимней темах возможны ошибки оформления.</p>
  </section>
}
