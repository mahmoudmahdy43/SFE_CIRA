import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Loader2, Search, UserCog, UserRound, Users } from 'lucide-react'
import { Card } from '../../components/ui/misc'
import { EmptyState } from '../../components/app/states'
import { profileHref, type ProfileKind, type SearchHit } from './profileLinks'
import { useProfileSearch } from './useProfileSearch'

export const KIND_ICON = { rep: UserRound, manager: Users, staff: UserCog, box: Box } as const

export function hitMeta(h: SearchHit): string {
  return [h.code, h.line, h.extra].filter(Boolean).join(' · ')
}

/** The /360 page without parameters: one large search box over reps, managers, staff and boxes. */
export function SearchView() {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { groups, loading, error, searched } = useProfileSearch(q)
  useEffect(() => ref.current?.focus(), [])
  const open = (kind: ProfileKind, id: number) => navigate(profileHref(kind, id))
  return (
    <div className="mx-auto max-w-3xl">
      <label htmlFor="profile-q" className="sr-only">Search reps, managers, staff or boxes</label>
      <div className="flex items-center gap-3 rounded-card border bg-card px-4 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <Search className="h-5 w-5 text-muted-foreground" aria-hidden />
        <input
          id="profile-q" ref={ref} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
          placeholder="Search a rep, manager, staff member or box — name or code"
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Searching" />}
      </div>
      <div className="mt-4 space-y-4" aria-live="polite">
        {q.trim().length < 2 ? (
          <Card><EmptyState icon={Search} title="Find a profile" description="Type at least two characters of a name or code. Ctrl K opens the same search from anywhere." /></Card>
        ) : error ? (
          <Card className="p-4 text-sm text-danger" role="alert">Search failed: {error}</Card>
        ) : searched && groups.length === 0 && !loading ? (
          <Card><EmptyState title="No matches" description={`Nothing found for “${q.trim()}”.`} /></Card>
        ) : (
          groups.map((g) => {
            const Icon = KIND_ICON[g.kind]
            return (
              <Card key={g.kind} className="overflow-hidden">
                <h2 className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden />{g.label} <span className="tnum">({g.hits.length})</span></h2>
                <ul>
                  {g.hits.map((h) => (
                    <li key={`${h.kind}-${h.id}`}>
                      <button onClick={() => open(h.kind, h.id)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                        <span className="font-medium">{h.name}</span><span className="truncate text-xs text-muted-foreground">{hitMeta(h)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
