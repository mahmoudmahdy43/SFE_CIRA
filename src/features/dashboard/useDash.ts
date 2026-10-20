import { useCallback, useEffect, useRef, useState } from 'react'
import { Queue, invalidate, invalidateAll, isAbort, peek, request } from '../../lib/api/requests'
import type { AsyncState } from './useAsync'

/** The one queue every Dashboard call goes through: never more than 3 requests in flight. */
export const dashQueue = new Queue(3)

/** Call order (lower runs first): the KPI call, then YTD, then Chart A, then Chart B, then the rest. */
export const PRIORITY = { kpi: 0, ytd: 1, visits: 2, sales: 3, other: 4, lazy: 5 } as const

export const dashQueued = <T,>(key: string, priority: number, fn: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> =>
  request(dashQueue, key, priority, fn, signal)
export const resetDashCache = invalidateAll

/**
 * Loads `fn` for `key` through the queue + cache. `key = null` keeps the block idle (skeleton) until it is wanted.
 * A key change or unmount cancels the previous call; a stale answer is ignored; `reload()` retries only this call.
 */
export function useDash<T>(key: string | null, priority: number, fn: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null })
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (key === null) return
    const hit = peek<T>(key)
    if (hit) { setState({ key, data: hit.value, error: null }); return }
    const ctl = new AbortController()
    dashQueued(key, priority, (s) => fnRef.current(s), ctl.signal)
      .then((data) => { if (!ctl.signal.aborted) setState({ key, data, error: null }) })
      .catch((e: unknown) => { if (!ctl.signal.aborted && !isAbort(e)) setState({ key, data: null, error: e instanceof Error ? e.message : 'Failed to load' }) })
    return () => ctl.abort()
  }, [key, priority, version])

  const reload = useCallback(() => {
    if (key !== null) invalidate(key)
    setState((s) => ({ ...s, error: null, data: null }))
    setVersion((v) => v + 1)
  }, [key])

  const mine = key !== null && state.key === key
  return { data: mine ? state.data : null, error: mine ? state.error : null, loading: !(mine && (state.data !== null || state.error !== null)), reload }
}

/** `value` after it has stopped changing for `ms` (multi-select filters wait 400 ms before they call the database). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** True once the element has come within `margin` of the viewport (and stays true): charts below the fold load only then. */
export function useNearViewport(margin = '300px'): [(el: Element | null) => void, boolean] {
  const [seen, setSeen] = useState(false)
  const obs = useRef<IntersectionObserver | null>(null)
  const ref = useCallback((el: Element | null) => {
    obs.current?.disconnect()
    obs.current = null
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const o = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); o.disconnect() }
    }, { rootMargin: margin })
    o.observe(el)
    obs.current = o
  }, [margin])
  useEffect(() => () => obs.current?.disconnect(), [])
  return [ref, seen]
}
