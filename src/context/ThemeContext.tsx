import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
const KEY = 'sfe-theme'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = resolveTheme(choice)
}

// Apply before React renders to avoid a flash of the wrong theme.
applyTheme(read())

interface ThemeState {
  choice: ThemeChoice
  resolved: 'light' | 'dark'
  setChoice: (c: ThemeChoice) => void
}
const ThemeContext = createContext<ThemeState | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(read)
  const [resolved, setResolved] = useState(() => resolveTheme(read()))

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c)
    try {
      localStorage.setItem(KEY, c)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    applyTheme(choice)
    setResolved(resolveTheme(choice))
    if (choice !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => {
      applyTheme('system')
      setResolved(resolveTheme('system'))
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [choice])

  return <ThemeContext.Provider value={{ choice, resolved, setChoice }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
