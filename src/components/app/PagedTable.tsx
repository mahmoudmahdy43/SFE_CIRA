import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Card, Skeleton } from '../ui/misc'
import { EmptyState, ErrorState } from './states'
import { downloadCsv } from '../../lib/csv'

export interface PagedColumn<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

/**
 * Server-paginated table. Remount it (change `key`) when filters change so it returns to page 1.
 * `load` fetches ONE page; `exportAll` fetches everything for the CSV button.
 */
export function PagedTable<T>({
  columns,
  load,
  exportAll,
  csvName,
  toolbar,
  size = 25,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  refreshKey = 0,
}: {
  columns: PagedColumn<T>[]
  load: (page: number, size: number) => Promise<{ rows: T[]; total: number }>
  exportAll?: () => Promise<Record<string, unknown>[]>
  csvName: string
  toolbar?: ReactNode
  size?: number
  emptyTitle?: string
  emptyDescription?: string
  refreshKey?: number
}) {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await load(page, size)
      setRows(r.rows)
      setTotal(r.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, refreshKey])
  useEffect(() => {
    void run()
  }, [run])

  const doExport = async () => {
    if (!exportAll) return
    setExporting(true)
    try {
      downloadCsv(`${csvName}.csv`, await exportAll())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {toolbar}
        {exportAll && (
          <Button size="sm" className="ml-auto" disabled={exporting || total === 0} onClick={() => void doExport()}>
            <Download className="h-4 w-4" aria-hidden /> {exporting ? 'Exporting…' : 'CSV'}
          </Button>
        )}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => void run()} />
      ) : loading ? (
        <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                {columns.map((c) => <th key={c.header} className="whitespace-nowrap px-3 py-2 font-medium">{c.header}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/60">
                  {columns.map((c) => <td key={c.header} className={c.className ?? 'px-3 py-2.5'}>{c.cell(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
        <span className="tnum">{total.toLocaleString()} row(s)</span>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="tnum px-2">{page + 1} / {pages}</span>
          <Button size="icon-sm" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </Card>
  )
}
