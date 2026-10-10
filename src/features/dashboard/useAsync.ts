import { useCallback, useEffect, useState } from 'react'
import { cached, dropCached } from '../../lib/api/kpi'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/** Loads `fn` once per `key` (shared in-memory cache, no refetch storms) and exposes reload(). */
export function useAsync<T>(key: string, fn: () => Promise<T>): AsyncState<T> {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ data: null, error: null, loading: true })
    cached(key, fn)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e: unknown) => !cancelled && setState({ data: null, error: e instanceof Error ? e.message : 'Failed to load', loading: false }))
    return () => {
      cancelled = true
    }
    // `fn` is re-created every render; the key identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])

  const reload = useCallback(() => {
    dropCached(key)
    setVersion((v) => v + 1)
  }, [key])
  return { ...state, reload }
}
