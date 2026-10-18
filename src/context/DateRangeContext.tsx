import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMonth } from './MonthContext'
import {
  addMonths, customRange, monthOf, readRangeParams, resolveRange, withRangeParams, type DateRange,
} from '../lib/dateRange'

interface DateRangeState extends DateRange {
  /** Pick a whole month (drops the custom range). */
  setMonth: (month: string) => void
  /** Pick a custom range; ignored when invalid. */
  setCustom: (from: string, to: string) => boolean
  /** Previous / next month of the To date (drops the custom range). */
  stepMonth: (n: number) => void
}

const Ctx = createContext<DateRangeState | undefined>(undefined)

/**
 * The global period. The URL (?from=&to=) is the single source of truth for a custom range; a plain month lives in the
 * month context. The range follows the user across pages (it is written back to the URL after navigation).
 */
export function DateRangeProvider({ children }: { children: ReactNode }) {
  const { month, setMonth: setMonthCtx } = useMonth()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const kept = useRef<{ from: string; to: string } | null>(null)

  const params = readRangeParams(search)
  const range = useMemo(() => resolveRange(params, month), [params.from, params.to, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (range.custom) {
      kept.current = { from: range.from, to: range.to }
      if (month !== range.month) setMonthCtx(range.month) // other pages (Calendar, Targets, …) follow the To month
    } else if (kept.current) {
      navigate({ pathname, search: withRangeParams(search, kept.current) }, { replace: true }) // arrived on a page without the parameters
    }
  }, [range.custom, range.from, range.to, range.month, month, pathname, search, navigate, setMonthCtx])

  const setMonth = useCallback((m: string) => {
    kept.current = null
    setMonthCtx(monthOf(m))
    if (params.from !== null || params.to !== null) navigate({ pathname, search: withRangeParams(search, null) }, { replace: true })
  }, [setMonthCtx, navigate, pathname, search, params.from, params.to])

  const setCustom = useCallback((from: string, to: string) => {
    const r = customRange(from, to)
    if (!r) return false
    kept.current = { from, to }
    setMonthCtx(r.month)
    navigate({ pathname, search: withRangeParams(search, { from, to }) }, { replace: true })
    return true
  }, [setMonthCtx, navigate, pathname, search])

  const stepMonth = useCallback((n: number) => setMonth(addMonths(range.month, n)), [setMonth, range.month])

  const value = useMemo<DateRangeState>(() => ({ ...range, setMonth, setCustom, stepMonth }), [range, setMonth, setCustom, stepMonth])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The active period: `{from, to, month (of the To date), isFullMonth, isSingleMonth}` plus setters. Reports read this, not the month. */
export function useDateRange(): DateRangeState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDateRange must be used inside DateRangeProvider')
  return v
}
