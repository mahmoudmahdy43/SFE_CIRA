import { createContext, useContext, useState, type ReactNode } from 'react'

interface MonthState {
  month: string // YYYY-MM-01
  setMonth: (m: string) => void
}

const MonthContext = createContext<MonthState | undefined>(undefined)

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(currentMonth)
  return <MonthContext.Provider value={{ month, setMonth }}>{children}</MonthContext.Provider>
}

export function useMonth(): MonthState {
  const ctx = useContext(MonthContext)
  if (!ctx) throw new Error('useMonth must be used inside MonthProvider')
  return ctx
}
