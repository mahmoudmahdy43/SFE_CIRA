import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
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
  /** Text alignment; default is right for `numeric` columns, left otherwise. */
  align?: 'left' | 'center' | 'right'
  /** Sticky-left column (mobile horizontal scroll); `width` in px is used to offset the next sticky column. */
  sticky?: boolean
  width?: number
  /** Sort value; null sorts last. */
  value: (r: T) => string | number | null
  render: (r: T) => ReactNode
  /** Custom styling (reports with their own colour scheme): header cell, the group cell above it (read from the first column of the group), body cells. */
  headStyle?: CSSProperties
  groupStyle?: CSSProperties
  cellStyle?: CSSProperties
  /** Pinned Total row: content and style of this column's cell (default: the built-in Total rendering). */
  footRender?: (total: T) => ReactNode
  footStyle?: CSSProperties
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
  /** Compact 32px body rows (default 44px). */
  compact?: boolean
  /** Background of every second body row. */
  zebra?: string
  /** Colour of the 1px line under each body row. */
  rowBorder?: string
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

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const
const alignOf = <T,>(c: ReportCol<T>): 'left' | 'center' | 'right' => c.align ?? (c.numeric ? 'right' : 'left')

export function ReportTable<T extends { rep_id: number }>({
  cols, rows, total, loading, error, onRetry, onRowClick, onRowsChange, emptyTitle, emptyDescription, initialSorting, compact, zebra, rowBorder,
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
  const topCells: { key: string; label: string; tip?: string; span: number; col?: ReportCol<T>; style?: CSSProperties }[] = []
  for (const c of cols) {
    if (!c.group) topCells.push({ key: c.id, label: c.header, tip: c.tip, span: 1, col: c })
    else {
      const last = topCells[topCells.length - 1]
      if (last && last.key === `g:${c.group}`) last.span++
      else topCells.push({ key: `g:${c.group}`, label: c.group, tip: c.groupTip, span: 1, style: c.groupStyle })
    }
  }

  const sortIcon = (id: string) => {
    const s = table.getColumn(id)?.getIsSorted()
    return s === 'asc' ? <ArrowUp className="h-3 w-3" /> : s === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />
  }
  const sortButton = (c: ReportCol<T>, label: ReactNode) => (
    <button
      onClick={table.getColumn(c.id)?.getToggleSortingHandler()}
      className={cn('inline-flex items-center gap-1', c.headStyle ? 'hover:opacity-80' : 'hover:text-foreground', alignOf(c) === 'right' && 'flex-row-reverse')}
    >
      {label}
      {sortIcon(c.id)}
    </button>
  )
  const stickyStyle = (c: ReportCol<T>) => (c.sticky ? { left: left.get(c.id), minWidth: c.width, width: c.width } : c.width ? { minWidth: c.width } : undefined)
  const th = 'border-b bg-muted px-3 text-xs font-medium text-muted-foreground whitespace-nowrap'
  const rowH = grouped ? 'h-8' : 'h-9'
  const bodyH = compact ? 'h-8' : 'h-11'

  if (error) return <div className="rounded-card border bg-card"><ErrorState message={error} onRetry={onRetry} /></div>

  return (
    <div className="rounded-card border bg-card">
      <div className="max-h-[68vh] min-h-[360px] overflow-auto print:max-h-none print:overflow-visible">
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
                    style={c ? { ...stickyStyle(c), ...c.headStyle } : t.style}
                    className={cn(th, rowH, 'sticky top-0', c ? ALIGN[alignOf(c)] : 'text-center', !c && !t.style && 'border-l', !c && 'text-center', c?.sticky ? 'z-30' : 'z-20')}
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
                    style={{ ...stickyStyle(c), ...c.headStyle }}
                    className={cn(th, 'sticky top-8 h-8', c.header.includes('\n') && 'whitespace-pre-line', c.sticky ? 'z-30' : 'z-20', c.align ? ALIGN[c.align] : 'text-right', !c.headStyle && (i === 0 || arr[i - 1].group !== c.group) && 'border-l')}
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
              : table.getRowModel().rows.map((row, ri) => (
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
                        style={{
                          ...stickyStyle(c),
                          ...(zebra && ri % 2 === 1 ? { backgroundColor: zebra } : null),
                          ...(rowBorder ? { borderBottomColor: rowBorder } : null),
                          ...c.cellStyle,
                        }}
                        className={cn(
                          bodyH, 'whitespace-nowrap border-b bg-card px-3 group-hover:bg-muted/60',
                          ALIGN[alignOf(c)],
                          c.numeric && 'tnum',
                          c.sticky && 'sticky z-[5]',
                          c.group && !c.headStyle && (i === 0 || cols[i - 1].group !== c.group) && 'border-l',
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
                    style={{ ...stickyStyle(c), ...c.footStyle }}
                    className={cn(
                      'sticky bottom-0 h-10 whitespace-nowrap border-t-2 bg-muted px-3 font-semibold',
                      ALIGN[alignOf(c)],
                      c.numeric && 'tnum',
                      c.sticky ? 'z-[15]' : 'z-10',
                      c.group && !c.footStyle && (i === 0 || cols[i - 1].group !== c.group) && 'border-l',
                    )}
                  >
                    {c.footRender
                      ? c.footRender(total)
                      : c.id === 'box' || c.id === 'rep' ? String(c.value(total) ?? '') : c.id === 'manager' || c.id === 'hire' ? '' : c.render(total)}
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
