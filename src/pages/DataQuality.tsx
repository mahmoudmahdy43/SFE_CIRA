import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, EmptyState, ErrorState } from '../components/app/states'
import { Combobox } from '../components/ui/combobox'
import { Button } from '../components/ui/button'
import { Badge, Card, Skeleton } from '../components/ui/misc'
import {
  DQ_HINT, DQ_ISSUES, DQ_LABEL, fetchDqAll, fetchDqCounts, fetchDqPage, fetchListMonths,
  type DqIssue, type DqRow,
} from '../lib/api/lists'
import { downloadCsv } from '../lib/csv'
import { cn } from '../lib/utils'

const PAGE = 25

export default function DataQuality() {
  return (
    <div>
      <PageHeader title="Data Quality" description="Checks on loaded data. These are warnings for review — they never block an upload." />
      <ActiveFromSection />
      <Card className="mt-8">
        <EmptyState icon={ShieldCheck} title="More checks coming" description="Unmatched visits, unmapped sales and missing days will appear here in later phases." className="py-10" />
      </Card>
    </div>
  )
}

function ActiveFromSection() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month')
  const [months, setMonths] = useState<string[]>([])
  const [issue, setIssue] = useState<DqIssue | null>(null)
  const [counts, setCounts] = useState<Record<DqIssue, number> | null>(null)
  const [rows, setRows] = useState<DqRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetchListMonths().then((m) => setMonths(m.map((x) => x.month))).catch(() => undefined)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [c, p] = await Promise.all([fetchDqCounts(month ? [month] : null), fetchDqPage(month, issue, page, PAGE)])
      setCounts(c)
      setRows(p.rows)
      setTotal(p.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data-quality checks')
    } finally {
      setLoading(false)
    }
  }, [month, issue, page])
  useEffect(() => {
    void load()
  }, [load])

  const setMonth = (m: string | null) => {
    setPage(0)
    setParams(m ? { month: m } : {}, { replace: true })
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = await fetchDqAll(month, issue)
      downloadCsv(`dq-active-from${month ? `-${month.slice(0, 7)}` : ''}.csv`, all.map((r) => ({
        month: r.month.slice(0, 7), doctor: r.doctor, account: r.account, rep_code: r.repCode, rep_name: r.repName,
        active_from: r.active_from ?? '', issue: DQ_LABEL[r.issue],
      })))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE))
  return (
    <section aria-labelledby="dq-af">
      <h2 id="dq-af" className="text-base font-semibold">Target List — Active From</h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">Active From is for review only — the month is determined by the snapshot.</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {DQ_ISSUES.map((i) => (
          <button
            key={i}
            onClick={() => { setIssue(issue === i ? null : i); setPage(0) }}
            aria-pressed={issue === i}
            className={cn('rounded-card border bg-card p-4 text-left transition-colors hover:bg-muted', issue === i && 'border-primary ring-1 ring-primary')}
          >
            <div className="text-xs font-medium text-muted-foreground">{DQ_LABEL[i]}</div>
            {counts ? <div className={cn('tnum mt-1 text-2xl font-semibold', counts[i] > 0 && 'text-warning')}>{counts[i].toLocaleString()}</div> : <Skeleton className="mt-2 h-8 w-16" />}
            <div className="mt-1 text-xs text-muted-foreground">{DQ_HINT[i]}</div>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Combobox label="Month" placeholder="All months" className="h-8" options={months.map((m) => ({ value: m, label: m.slice(0, 7) }))} value={month} onChange={setMonth} />
          {issue && <Badge tone="accent">{DQ_LABEL[issue]}</Badge>}
          {issue && <Button size="sm" variant="ghost" onClick={() => setIssue(null)}>Clear</Button>}
          <Button size="sm" className="ml-auto" disabled={exporting || total === 0} onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" aria-hidden /> {exporting ? 'Exporting…' : 'CSV'}
          </Button>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : loading ? (
          <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No issues found" description="Nothing to review for this selection." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                  {['Month', 'Doctor', 'Account', 'Rep code', 'Rep', 'Active From', 'Issue'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.month}-${r.doctor_id}-${r.issue}-${i}`} className="border-b last:border-0 hover:bg-muted/60">
                    <td className="tnum whitespace-nowrap px-3 py-2.5">{r.month.slice(0, 7)}</td>
                    <td className="px-3 py-2.5">{r.doctor}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.account}</td>
                    <td className="tnum px-3 py-2.5">{r.repCode}</td>
                    <td className="px-3 py-2.5">{r.repName}</td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5">{r.active_from ?? '—'}</td>
                    <td className="px-3 py-2.5"><Badge tone="warning">{DQ_LABEL[r.issue]}</Badge></td>
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
    </section>
  )
}
