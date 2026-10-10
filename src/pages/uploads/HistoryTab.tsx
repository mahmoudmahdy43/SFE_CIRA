import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge, Card, Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { UndoDialog } from '../../features/uploads/UploadWizard'
import { fetchBatches, type Batch } from '../../lib/api/lists'
import { cn } from '../../lib/utils'

const PAGE = 20
const KIND: Record<string, string> = {
  list: 'Target List', visits: 'Visits', sales: 'Sales', leaves: 'Leaves',
  office_work: 'Office Work', activities: 'Activities', coaching: 'Coaching',
}

export default function HistoryTab() {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Batch[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchBatches(page, PAGE)
      setRows(r.rows)
      setTotal(r.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [page])
  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / PAGE))
  return (
    <Card>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No uploads yet" description="Every upload is recorded here and can be undone." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                {['#', 'Date', 'Type', 'File', 'Months', 'Loaded', 'Rejected', 'Status', 'By', ''].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const deleted = b.status === 'deleted'
                return (
                  <tr key={b.id} className={cn('border-b last:border-0 hover:bg-muted/60', deleted && 'text-muted-foreground')}>
                    <td className="tnum px-3 py-2.5">{b.id}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5">{b.created_at.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-3 py-2.5">{KIND[b.kind] ?? b.kind}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2.5" title={b.file_name ?? ''}>{b.file_name ?? '—'}</td>
                    <td className="tnum px-3 py-2.5">{b.months.map((m) => m.slice(0, 7)).join(', ') || '—'}</td>
                    <td className="tnum px-3 py-2.5 text-right">{b.rows_loaded.toLocaleString()}</td>
                    <td className={cn('tnum px-3 py-2.5 text-right', b.rows_rejected > 0 && !deleted && 'text-danger')}>{b.rows_rejected.toLocaleString()}</td>
                    <td className="px-3 py-2.5"><Badge tone={deleted ? 'neutral' : b.status === 'replaced' ? 'warning' : 'success'} className="capitalize">{b.status}</Badge></td>
                    <td className="px-3 py-2.5 font-mono text-xs" title={b.created_by ?? ''}>{b.created_by?.slice(0, 8) ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {!deleted && (
                        <Button size="sm" variant="ghost" aria-label={`Undo upload ${b.id}`} onClick={() => setUndo(b.id)}>
                          <Undo2 className="h-4 w-4" aria-hidden /> Undo
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
        <span className="tnum">{total.toLocaleString()} upload(s)</span>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="tnum px-2">{page + 1} / {pages}</span>
          <Button size="icon-sm" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      {undo !== null && <UndoDialog batch={undo} onClose={() => setUndo(null)} onDone={() => { setUndo(null); void load() }} />}
    </Card>
  )
}
