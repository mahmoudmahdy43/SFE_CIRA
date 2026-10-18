import { ProfileLink } from '../../components/app/ProfileLink'
import { useMemo, useState } from 'react'
import {
  flexRender, getCoreRowModel, getExpandedRowModel, getFilteredRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type ExpandedState, type SortingState, type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Columns3, Download, Search } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input, Skeleton } from '../../components/ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/overlay'
import { EmptyState } from '../../components/app/states'
import { downloadCsv } from '../../lib/csv'
import { kpiTone, toneText } from '../../lib/kpi'
import { cn } from '../../lib/utils'
import { fmtInt, fmtPct, fmtRate, flattenForCsv, type TreeNode } from './kpiMath'

const ratioCell = (v: number | null) => <span className={cn(v !== null && toneText[kpiTone(v, 1)])}>{fmtPct(v)}</span>

/** Line -> Manager -> Rep with expandable rows, sorting within siblings, search (keeps parents of matches), column toggle, CSV. */
export function KpiTreeTable({
  data,
  loading,
  month,
  onRepClick,
}: {
  data: TreeNode[]
  loading?: boolean
  month: string
  onRepClick: (node: TreeNode) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [filter, setFilter] = useState('')
  const [visibility, setVisibility] = useState<VisibilityState>({})
  const [expanded, setExpanded] = useState<ExpandedState>(() => Object.fromEntries(data.map((d) => [d.id, true])))

  const columns = useMemo<ColumnDef<TreeNode, unknown>[]>(
    () => [
      {
        id: 'name',
        header: 'Line / manager / rep',
        accessorFn: (r) => `${r.name} ${r.code ?? ''}`,
        enableHiding: false,
        cell: ({ row }) => {
          const n = row.original
          return (
            <span className="flex items-center gap-1" style={{ paddingLeft: row.depth * 18 }}>
              {row.getCanExpand() ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); row.toggleExpanded() }}
                  aria-label={`${row.getIsExpanded() ? 'Collapse' : 'Expand'} ${n.name}`}
                  aria-expanded={row.getIsExpanded()}
                  className="rounded p-0.5 hover:bg-muted"
                >
                  {row.getIsExpanded() ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              ) : (
                <span className="w-5" aria-hidden />
              )}
              <span className={cn(n.level === 'line' && 'font-semibold', n.level === 'manager' && 'font-medium', n.name.startsWith('Vacant') && 'italic text-muted-foreground')}>{n.level === 'rep' ? <ProfileLink type="rep" id={n.repId}>{n.name}</ProfileLink> : n.level === 'manager' ? <ProfileLink type="manager" id={n.managerId}>{n.name}</ProfileLink> : n.name}</span>
              {n.code && <span className="tnum text-xs text-muted-foreground">{n.code}</span>}
            </span>
          )
        },
      },
      { id: 'reps', header: 'Reps', accessorFn: (r) => r.reps, cell: (c) => fmtInt(c.row.original.reps) },
      { id: 'list_doctors', header: 'List doctors', accessorFn: (r) => r.list_doctors, cell: (c) => fmtInt(c.row.original.list_doctors) },
      { id: 'coverage', header: 'Coverage', accessorFn: (r) => r.coverage, cell: (c) => ratioCell(c.row.original.coverage) },
      { id: 'pcf', header: 'PCF', accessorFn: (r) => r.pcf, cell: (c) => ratioCell(c.row.original.pcf) },
      { id: 'ach_cr', header: 'Ach CR', accessorFn: (r) => r.ach_cr, cell: (c) => ratioCell(c.row.original.ach_cr) },
      {
        id: 'call_rate_am', header: 'Call rate AM', accessorFn: (r) => r.call_rate_am,
        cell: (c) => {
          const r = c.row.original
          return <span className={cn(r.call_rate_am !== null && r.target_am ? toneText[kpiTone(r.call_rate_am, r.target_am)] : '')}>{fmtRate(r.call_rate_am)}</span>
        },
      },
      {
        id: 'call_rate_pm', header: 'Call rate PM', accessorFn: (r) => r.call_rate_pm,
        cell: (c) => {
          const r = c.row.original
          return <span className={cn(r.call_rate_pm !== null && r.target_pm ? toneText[kpiTone(r.call_rate_pm, r.target_pm)] : '')}>{fmtRate(r.call_rate_pm)}</span>
        },
      },
      { id: 'target_am', header: 'Target AM', accessorFn: (r) => r.target_am, cell: (c) => (c.row.original.level === 'rep' ? fmtRate(c.row.original.target_am) : '') },
      { id: 'target_pm', header: 'Target PM', accessorFn: (r) => r.target_pm, cell: (c) => (c.row.original.level === 'rep' ? fmtRate(c.row.original.target_pm) : '') },
      { id: 'total_visits', header: 'Visits', accessorFn: (r) => r.total_visits, cell: (c) => fmtInt(c.row.original.total_visits) },
      { id: 'planned_pct', header: 'Planned %', accessorFn: (r) => r.planned_pct, cell: (c) => fmtPct(c.row.original.planned_pct) },
      { id: 'missing_am', header: 'Missing AM', accessorFn: (r) => r.missing_am, cell: (c) => fmtInt(c.row.original.missing_am) },
      { id: 'missing_pm', header: 'Missing PM', accessorFn: (r) => r.missing_pm, cell: (c) => fmtInt(c.row.original.missing_pm) },
      { id: 'total_kpi', header: 'Total KPI', accessorFn: (r) => r.total_kpi, cell: (c) => <span className="font-semibold">{ratioCell(c.row.original.total_kpi)}</span> },
    ],
    [],
  )
  const numeric = useMemo(() => new Set(columns.map((c) => c.id as string).filter((id) => id !== 'name')), [columns])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filter, columnVisibility: visibility, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onColumnVisibilityChange: setVisibility,
    onExpandedChange: setExpanded,
    getSubRows: (r) => r.children,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    filterFromLeafRows: true,
    getRowCanExpand: (r) => r.original.children.length > 0,
  })
  const rows = table.getRowModel().rows

  return (
    <div className="rounded-card border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search lines, managers and reps" placeholder="Search name or code…" value={filter} onChange={(e) => { setFilter(e.target.value); if (e.target.value) setExpanded(true) }} className="pl-8" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => setExpanded(expanded === true ? Object.fromEntries(data.map((d) => [d.id, true])) : true)}>
            {expanded === true ? 'Collapse to lines' : 'Expand all'}
          </Button>
          <Popover>
            <PopoverTrigger asChild><Button size="sm" aria-label="Choose columns"><Columns3 className="h-4 w-4" /> Columns</Button></PopoverTrigger>
            <PopoverContent className="max-h-72 w-52 overflow-auto">
              {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                  {String(c.columnDef.header)}
                </label>
              ))}
            </PopoverContent>
          </Popover>
          <Button size="sm" disabled={data.length === 0} onClick={() => downloadCsv(`kpi-drilldown-${month.slice(0, 7)}.csv`, flattenForCsv(data))}>
            <Download className="h-4 w-4" aria-hidden /> CSV
          </Button>
        </div>
      </div>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h, i) => {
                  const sorted = h.column.getIsSorted()
                  const isNum = numeric.has(h.column.id)
                  return (
                    <th
                      key={h.id}
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      className={cn('sticky top-0 z-10 whitespace-nowrap border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground', isNum ? 'text-right' : 'text-left', i === 0 && 'left-0 z-20 min-w-[16rem]')}
                    >
                      <button onClick={h.column.getToggleSortingHandler()} className={cn('inline-flex items-center gap-1 hover:text-foreground', isNum && 'flex-row-reverse')}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> : sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
                      </button>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }, (_, r) => (
                  <tr key={r}>{table.getVisibleLeafColumns().map((c) => <td key={c.id} className="border-b px-3 py-3"><Skeleton className="h-4" /></td>)}</tr>
                ))
              : rows.map((row) => {
                  const isRep = row.original.level === 'rep'
                  return (
                    <tr
                      key={row.id}
                      onClick={isRep ? () => onRepClick(row.original) : undefined}
                      onKeyDown={isRep ? (e) => { if (e.key === 'Enter') onRepClick(row.original) } : undefined}
                      tabIndex={isRep ? 0 : undefined}
                      className={cn('group', isRep && 'cursor-pointer', row.original.level === 'line' && 'bg-muted/40')}
                    >
                      {row.getVisibleCells().map((cell, i) => (
                        <td key={cell.id} className={cn('whitespace-nowrap border-b px-3 py-2 group-hover:bg-muted/60', numeric.has(cell.column.id) && 'tnum text-right', i === 0 ? 'sticky left-0 z-[1] bg-card' : '', i === 0 && row.original.level === 'line' && 'bg-muted')}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  )
                })}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <EmptyState title="Nothing to show" description={filter ? 'No line, manager or rep matches your search.' : 'No KPI rows for this month.'} />}
      </div>
    </div>
  )
}
