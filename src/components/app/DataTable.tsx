import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, Rows3, Search } from 'lucide-react'
import { Button } from '../ui/button'
import { Input, Skeleton } from '../ui/misc'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlay'
import { EmptyState, ErrorState } from './states'
import { downloadCsv } from '../../lib/csv'
import { cn } from '../../lib/utils'

export interface DataTableProps<T extends object> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  /** Column ids right-aligned with tabular numbers. */
  numericColumns?: string[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  csvName?: string
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  toolbar?: React.ReactNode
}

export function DataTable<T extends object>({
  data,
  columns,
  numericColumns = [],
  loading,
  error,
  onRetry,
  csvName = 'export',
  pageSize = 10,
  emptyTitle = 'No rows to show',
  emptyDescription = 'Nothing matches the current filters.',
  onRowClick,
  toolbar,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [filter, setFilter] = useState('')
  const [visibility, setVisibility] = useState<VisibilityState>({})
  const [dense, setDense] = useState(false)

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: filter, columnVisibility: visibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  const numeric = useMemo(() => new Set(numericColumns), [numericColumns])
  const rows = table.getRowModel().rows
  const filteredCount = table.getFilteredRowModel().rows.length
  const { pageIndex, pageSize: ps } = table.getState().pagination

  const exportCsv = () => {
    const visible = table.getVisibleLeafColumns()
    downloadCsv(
      `${csvName}.csv`,
      table.getFilteredRowModel().rows.map((r) =>
        Object.fromEntries(visible.map((c) => [String(c.columnDef.header ?? c.id), r.getValue(c.id)])),
      ),
    )
  }

  return (
    <div className="rounded-card border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input aria-label="Search table" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" aria-label="Choose columns">
                <Columns3 className="h-4 w-4" /> Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48">
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                    {String(c.columnDef.header ?? c.id)}
                  </label>
                ))}
            </PopoverContent>
          </Popover>
          <Button size="icon-sm" aria-label="Toggle row density" aria-pressed={dense} onClick={() => setDense((d) => !d)}>
            <Rows3 className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={filteredCount === 0}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <div className="max-h-[560px] overflow-auto">
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
                        className={cn(
                          'sticky top-0 z-10 whitespace-nowrap border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground',
                          isNum ? 'text-right' : 'text-left',
                          i === 0 && 'left-0 z-20',
                        )}
                      >
                        {h.column.getCanSort() ? (
                          <button
                            onClick={h.column.getToggleSortingHandler()}
                            className={cn('inline-flex items-center gap-1 hover:text-foreground', isNum && 'flex-row-reverse')}
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> : sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }, (_, r) => (
                    <tr key={r}>
                      {table.getVisibleLeafColumns().map((c) => (
                        <td key={c.id} className="border-b px-3 py-3">
                          <Skeleton className="h-4" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((row) => (
                    <tr
                      key={row.id}
                      className={cn("group", onRowClick && "cursor-pointer")}
                      tabIndex={onRowClick ? 0 : undefined}
                      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                      onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(row.original) } : undefined}
                    >
                      {row.getVisibleCells().map((cell, i) => (
                        <td
                          key={cell.id}
                          className={cn(
                            'whitespace-nowrap border-b bg-card px-3 group-hover:bg-muted/60',
                            dense ? 'py-1.5' : 'py-2.5',
                            numeric.has(cell.column.id) && 'tnum text-right',
                            i === 0 && 'sticky left-0 z-[1] font-medium',
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <EmptyState title={emptyTitle} description={emptyDescription} />}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground">
        <span className="tnum">
          {filteredCount === 0 ? '0 rows' : `${pageIndex * ps + 1}–${Math.min((pageIndex + 1) * ps, filteredCount)} of ${filteredCount}`}
        </span>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="tnum px-2">
            {table.getPageCount() === 0 ? 0 : pageIndex + 1} / {table.getPageCount()}
          </span>
          <Button size="icon-sm" aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
