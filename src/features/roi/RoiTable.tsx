import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { lastWhen, sortRows, type SortDir } from './roiMath'

export interface RoiCol<T> {
  id: string
  header: string
  numeric?: boolean
  value: (r: T) => string | number | null
  render?: (r: T) => ReactNode
  className?: (r: T) => string | undefined
}

/** Small sortable table (click a header; nulls always last). `onRows` reports the rows in their sorted order, for export. */
export function RoiTable<T>({ cols, rows, rowKey, selectedKey, onRowClick, initial, label, pinLast, rowClass }: {
  cols: RoiCol<T>[]
  rows: T[]
  rowKey: (r: T) => string | number
  selectedKey?: string | number | null
  onRowClick?: (r: T) => void
  initial?: { id: string; dir: SortDir }
  label: string
  /** Rows matching this stay at the bottom whatever the sort (low-sample rows). */
  pinLast?: (r: T) => boolean
  rowClass?: (r: T) => string | undefined
}) {
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(initial ?? null)
  const shown = useMemo(() => {
    const c = cols.find((x) => x.id === sort?.id)
    const sorted = c && sort ? sortRows(rows, c.value, sort.dir) : rows
    return pinLast ? lastWhen(sorted, pinLast) : sorted
  }, [rows, cols, sort, pinLast])
  const toggle = (id: string) => setSort((s) => (s?.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'desc' }))
  const icon = (id: string) => (sort?.id !== id ? <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden /> : sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm" aria-label={label}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.id} scope="col" aria-sort={sort?.id === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={cn('whitespace-nowrap border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground', c.numeric ? 'text-right' : 'text-left')}>
                <button type="button" onClick={() => toggle(c.id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', c.numeric && 'flex-row-reverse')}>
                  {c.header}
                  {icon(c.id)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const k = rowKey(r)
            const on = selectedKey !== undefined && selectedKey !== null && selectedKey === k
            return (
              <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined} aria-selected={onRowClick ? on : undefined}
                className={cn('border-b', onRowClick && 'cursor-pointer hover:bg-muted/60', on && 'bg-accent', rowClass?.(r))}>
                {cols.map((c) => (
                  <td key={c.id} className={cn('px-3 py-2 align-top', c.numeric ? 'tnum whitespace-nowrap text-right' : 'text-left', c.className?.(r))}>
                    {c.render ? c.render(r) : (c.value(r) ?? '—')}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
