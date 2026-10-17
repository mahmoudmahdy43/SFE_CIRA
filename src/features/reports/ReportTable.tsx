import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from 'lucide-react'
import { Skeleton } from '../../components/ui/misc'
import { Tooltip } from '../../components/ui/overlay'
import { EmptyState, ErrorState } from '../../components/app/states'
import { cn } from '../../lib/utils'

export interface ReportCol<T> {
  id: string
  /** Full header (single-level columns) or the group's sub-header text when `group` is set (e.g. "AM"). */
  header: string
  group?: string
  groupTip?: string
  tip?: string
  numeric?: boolean
  /** Sticky-left column (mobile horizontal scroll); `width` in px is used to offset the next sticky column. */
  sticky?: boolean
  width?: number
  /** Sort value; null sorts last. */
  value: (r: T) => string | number | null
  render: (r: T) => ReactNode
}

interface Props<T extends { rep_id: number }> {
  cols: ReportCol<T>[]
  rows: T[]
  total: T
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onRowClick?: (r: T) => void
  /** Rows in their current filtered + sorted order (for export). */
  onRowsChange?: (rows: T[]) => void
  emptyTitle: string
  emptyDescription: string
  /** Sort applied on first render (default: the order of `rows`). */
  initialSorting?: SortingState
}

function HeadLabel({ text, tip }: { text: string; tip?: string }) {
  if (!tip) return <>{text}</>
  return (
    <Tooltip content={<span className="block max-w-64">{tip}</span>} side="bottom">
      <span className="inline-flex items-center gap-1">
        {text}
        <Info className="h-3 w-3 opacity-60" aria-label={tip} />
      </span>
    </Tooltip>
  )
}

export function ReportTable<T extends { rep_id: number }>({
  cols, rows, total, loading, error, onRetry, onRowClick, onRowsChange, emptyTitle, emptyDescription, initialSorting,
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? [])
  const columns = useMemo<ColumnDef<T>[]>(
    () => cols.map((c) => ({ id: c.id, header: c.header, accessorFn: (r) => c.value(r) ?? undefined, sortUndefined: 'last' as const })),
    [cols],
  )
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const sortedRows = useMemo(() => table.getRowModel().rows.map((r) => r.original), [table, rows, sorting]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onRowsChange?.(sortedRows), [sortedRows, onRowsChange])

  // left offsets of the sticky columns
  const left = new Map<string, number>()
  let acc = 0
  for (const c of cols) if (c.sticky) { left.set(c.id, acc); acc += c.width ?? 120 }

  const grouped = cols.some((c) => c.group)
  const topCells: { key: string; label: string; tip?: string; span: number; col?: ReportCol<T> }[] = []
  for (const c of cols) {
    if (!c.group) topCells.push({ key: c.id, label: c.header, tip: c.tip, span: 1, col: c })
    else {
      const last = topCells[topCells.length - 1]
      if (last && last.key === `g:${c.group}`) last.span++
      else topCells.push({ key: `g:${c.group}`, label: c.group, tip: c.groupTip, span: 1 })
    }
  }

  const sortIcon = (id: string) => {
    const s = table.getColumn(id)?.getIsSorted()
    return s === 'asc' ? <ArrowUp className="h-3 w-3" /> : s === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />
  }
  const sortButton = (c: ReportCol<T>, label: ReactNode) => (
    <button
      onClick={table.getColumn(c.id)?.getToggleSortingHandler()}
      className={cn('inline-flex items-center gap-1 hover:text-foreground', c.numeric && 'flex-row-reverse')}
    >
      {label}
      {sortIcon(c.id)}
    </button>
  )
  const stickyStyle = (c: ReportCol<T>) => (c.sticky ? { left: left.get(c.id), minWidth: c.width, width: c.width } : c.width ? { minWidth: c.width } : undefined)
  const th = 'border-b bg-muted px-3 text-xs font-medium text-muted-foreground whitespace-nowrap'
  const rowH = grouped ? 'h-8' : 'h-9'

  if (error) return <div className="rounded-card border bg-card"><ErrorState message={error} onRetry={onRetry} /></div>

  return (
    <div className="rounded-card border bg-card">
      <div className="max-h-[68vh] min-h-[360px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {topCells.map((t) => {
                const c = t.col
                return (
                  <th
                    key={t.key}
                    colSpan={t.span}
                    rowSpan={c && grouped ? 2 : 1}
                    aria-sort={c ? (table.getColumn(c.id)?.getIsSorted() === 'asc' ? 'ascending' : table.getColumn(c.id)?.getIsSorted() === 'desc' ? 'descending' : 'none') : undefined}
                    style={c ? stickyStyle(c) : undefined}
                    className={cn(th, rowH, 'sticky top-0', c?.numeric ? 'text-right' : 'text-left', !c && 'border-l text-center', c?.sticky ? 'z-30' : 'z-20')}
                  >
                    {c ? sortButton(c, <HeadLabel text={c.header} tip={c.tip} />) : <HeadLabel text={t.label} tip={t.tip} />}
                  </th>
                )
              })}
            </tr>
            {grouped && (
              <tr>
                {cols.filter((c) => c.group).map((c, i, arr) => (
                  <th
                    key={c.id}
                    aria-sort={table.getColumn(c.id)?.getIsSorted() === 'asc' ? 'ascending' : table.getColumn(c.id)?.getIsSorted() === 'desc' ? 'descending' : 'none'}
                    className={cn(th, 'sticky top-8 z-20 h-8 text-right', (i === 0 || arr[i - 1].group !== c.group) && 'border-l')}
                  >
                    {sortButton(c, <HeadLabel text={c.header} tip={c.tip} />)}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 10 }, (_, r) => (
                  <tr key={r}>
                    {cols.map((c) => (
                      <td key={c.id} className="h-11 border-b px-3"><Skeleton className="h-4" /></td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn('group', onRowClick && 'cursor-pointer')}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row.original) } : undefined}
                  >
                    {cols.map((c, i) => (
                      <td
                        key={c.id}
                        style={stickyStyle(c)}
                        className={cn(
                          'h-11 whitespace-nowrap border-b bg-card px-3 group-hover:bg-muted/60',
                          c.numeric && 'tnum text-right',
                          c.sticky && 'sticky z-[5]',
                          c.group && (i === 0 || cols[i - 1].group !== c.group) && 'border-l',
                        )}
                      >
                        {c.render(row.original)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  <td
                    key={c.id}
                    style={stickyStyle(c)}
                    className={cn(
                      'sticky bottom-0 h-10 whitespace-nowrap border-t-2 bg-muted px-3 font-semibold',
                      c.numeric && 'tnum text-right',
                      c.sticky ? 'z-[15]' : 'z-10',
                      c.group && (i === 0 || cols[i - 1].group !== c.group) && 'border-l',
                    )}
                  >
                    {c.id === 'box' || c.id === 'rep' ? String(c.value(total) ?? '') : c.id === 'manager' || c.id === 'hire' ? '' : c.render(total)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {!loading && rows.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
      </div>
    </div>
  )
}
