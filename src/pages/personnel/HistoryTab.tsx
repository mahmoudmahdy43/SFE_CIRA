import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Combobox } from '../../components/ui/combobox'
import { Button } from '../../components/ui/button'
import { Badge, Card, Input, Skeleton } from '../../components/ui/misc'
import { EmptyState, ErrorState } from '../../components/app/states'
import { supabase } from '../../lib/supabase'
import { addMonthsIso, monthStart } from '../../lib/norm'

interface EventRow {
  id: number
  event_type: string
  event_date: string
  notes: string | null
  created_by: string | null
  created_at: string
  reps: { name: string } | null
  managers: { name: string } | null
  boxes: { name: string } | null
}

const TYPES = [
  { value: 'hire', label: 'Hire' },
  { value: 'resign', label: 'Resign' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'manager_assign', label: 'Manager assigned' },
  { value: 'manager_resign', label: 'Manager resigned / unassigned' },
  { value: 'nsm_change', label: 'NSM change' },
]
const PAGE = 25

export default function HistoryTab() {
  const [type, setType] = useState<string | null>(null)
  const [month, setMonth] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<EventRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('personnel_events')
      .select('id,event_type,event_date,notes,created_by,created_at,reps(name),managers(name),boxes(name)', { count: 'exact' })
      .order('event_date', { ascending: false })
      .order('id', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (type) q = q.eq('event_type', type)
    if (month) q = q.gte('event_date', monthStart(`${month}-01`)).lt('event_date', addMonthsIso(`${month}-01`, 1))
    const { data, count, error: err } = await q
    if (err) setError(err.message)
    else {
      setRows((data ?? []) as unknown as EventRow[])
      setTotal(count ?? 0)
    }
    setLoading(false)
  }, [type, month, page])
  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / PAGE))
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Combobox label="Type" placeholder="All types" className="h-8" options={TYPES} value={type} onChange={(v) => { setType(v); setPage(0) }} />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Month
          <Input type="month" aria-label="Filter by month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(0) }} className="h-8 w-40" />
        </label>
        {month && <Button size="sm" variant="ghost" onClick={() => setMonth('')}>Clear month</Button>}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No personnel events" description="Hires, resignations, transfers and manager changes will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                {['Date', 'Type', 'Person', 'Box', 'Notes', 'By'].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/60">
                  <td className="tnum whitespace-nowrap px-3 py-2.5">{r.event_date}</td>
                  <td className="px-3 py-2.5"><Badge tone="accent">{TYPES.find((t) => t.value === r.event_type)?.label ?? r.event_type}</Badge></td>
                  <td className="px-3 py-2.5">{r.reps?.name ?? r.managers?.name ?? '—'}</td>
                  <td className="px-3 py-2.5">{r.boxes?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.notes ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground" title={r.created_by ?? ''}>{r.created_by ? r.created_by.slice(0, 8) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
        <span className="tnum">{total.toLocaleString()} event(s)</span>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="tnum px-2">{page + 1} / {pages}</span>
          <Button size="icon-sm" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </Card>
  )
}
