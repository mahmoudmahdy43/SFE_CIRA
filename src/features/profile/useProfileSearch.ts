import { useEffect, useState } from 'react'
import { profileSearch } from '../../lib/api/profile'
import { groupSearchHits, type SearchGroup } from './profileLinks'

/** Debounced profile_search: groups for the query (min 2 characters), plus loading / error. */
export function useProfileSearch(query: string, delay = 250): { groups: SearchGroup[]; loading: boolean; error: string | null; searched: boolean } {
  const q = query.trim()
  const [state, setState] = useState<{ groups: SearchGroup[]; loading: boolean; error: string | null; searched: boolean }>({ groups: [], loading: false, error: null, searched: false })
  useEffect(() => {
    if (q.length < 2) {
      setState({ groups: [], loading: false, error: null, searched: false })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    const t = setTimeout(() => {
      profileSearch(q)
        .then((hits) => !cancelled && setState({ groups: groupSearchHits(hits), loading: false, error: null, searched: true }))
        .catch((e: unknown) => !cancelled && setState({ groups: [], loading: false, error: e instanceof Error ? e.message : 'Search failed', searched: true }))
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, delay])
  return state
}
