import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { cn } from '../../lib/utils'
import { useAsync, type AsyncState } from '../dashboard/useAsync'
import { fetchTerritoryMonth } from '../../lib/api/dashV1'
import { monthsWithoutList } from './dashMath'

export const AXIS = { stroke: 'hsl(var(--muted-foreground))', fontSize: 12, tickLine: false, axisLine: false } as const

/** Skeleton / error / empty / content switch shared by every block. */
export function Loadable<T>({ state, empty, height = 'h-48', children }: {
  state: AsyncState<T>
  empty?: (data: T) => boolean
  height?: string
  children: (data: T) => ReactNode
}) {
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} className="py-8" />
  if (state.loading || state.data === null) return <div aria-busy="true"><Skeleton className={cn(height, 'w-full')} /></div>
  if (empty ? empty(state.data) : Array.isArray(state.data) && state.data.length === 0) {
    return <EmptyState title="No data for this period" description="Nothing is loaded for the selected months and line." className="py-8" />
  }
  return <>{children(state.data)}</>
}

export interface Col<T> {
  id: string
  header: string
  cell: (r: T) => ReactNode
  /** Sort key; omit for an unsortable column. */
  sort?: (r: T) => number | string | null
  align?: 'right'
  title?: string
}

/** Small client-side sortable table. */
export function SortTable<T>({ rows, cols, rowKey, initialSort, maxHeight = 'max-h-[60vh]' }: {
  rows: T[]
  cols: Col<T>[]
  rowKey: (r: T, i: number) => string
  initialSort?: { id: string; desc: boolean }
  maxHeight?: string
}) {
  const [sort, setSort] = useState(initialSort ?? null)
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.id === sort?.id)
    if (!col?.sort || !sort) return rows
    const key = col.sort
    const dir = sort.desc ? -1 : 1
    return [...rows].sort((a, b) => {
      const x = key(a), y = key(b)
      if (x === null && y === null) return 0
      if (x === null) return 1
      if (y === null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [rows, cols, sort])
  return (
    <div className={cn('overflow-auto rounded-card border bg-card', maxHeight)}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.id} title={c.title} aria-sort={sort?.id === c.id ? (sort.desc ? 'descending' : 'ascending') : undefined}
                className={cn('sticky top-0 z-10 whitespace-nowrap border-b bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground', c.align === 'right' ? 'text-right' : 'text-left')}>
                {c.sort ? (
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => (s?.id === c.id ? { id: c.id, desc: !s.desc } : { id: c.id, desc: true }))}>
                    {c.header}
                    {sort?.id === c.id && (sort.desc ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />)}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)} className="hover:bg-muted/50">
              {cols.map((c) => <td key={c.id} className={cn('tnum border-b px-3 py-2', c.align === 'right' && 'text-right')}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const signTone = (v: number | null): string => (v === null ? '' : v > 0 ? 'text-success' : v < 0 ? 'text-danger' : '')

export function SegToggle<T extends string | number>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-1 rounded-control bg-muted p-1">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cn('rounded-control px-2.5 py-1 text-xs font-medium text-muted-foreground', o.value === value && 'bg-card text-foreground shadow-sm')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Warning for months whose list has no territory; shown on every tab that uses territory data (shared cached request). */
export function ListWarning({ from, to }: { from: string; to: string }) {
  const tm = useAsync(`dashv1:tm:${from}:${to}`, () => fetchTerritoryMonth(from, to))
  const months = useMemo(() => monthsWithoutList(tm.data ?? []), [tm.data])
  if (months.length === 0) return null
  return (
    <div role="alert" className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning">
      {months.map((m) => `List for ${m.slice(0, 7)} has no territory — run the backfill`).join('. ')}.
    </div>
  )
}
