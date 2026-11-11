import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, SearchCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, PageHeader } from '../components/app/states'
import { Button } from '../components/ui/button'
import { Combobox } from '../components/ui/combobox'
import { Badge, Card, Input, Skeleton } from '../components/ui/misc'
import { useMonth } from '../context/MonthContext'
import { useAsync } from '../features/dashboard/useAsync'
import { classify, SEVERITIES, type CleaningRow, type Severity } from '../features/listCleaning/cleaningRules'
import { fetchListForCleaning } from '../lib/api/listCleaning'
import { fetchLineNames } from '../lib/api/reports'
import { downloadXlsxStyled } from '../lib/xlsxExport'
import { cn } from '../lib/utils'

const PAGE = 50
const TONE: Record<Severity, 'danger' | 'warning' | 'neutral'> = { High: 'danger', Medium: 'warning', Low: 'neutral' }
const TYPES = ['Clinics', 'Hospital', 'AM Center', 'Poly Clinics', 'Pharmacy', 'Distributors']
const HEADERS = ['Severity', 'Issues', 'Line', 'Direct Manager', 'Box', 'Medical Rep', 'Account Type', 'Account Name', 'Account ID', 'Doctor Name', 'Doctor ID', 'Territory', 'Brick', 'Speciality'] as const

const toSheetRow = (r: CleaningRow) => ({
  Severity: r.severity, Issues: r.issues, Line: r.line, 'Direct Manager': r.manager, Box: r.box, 'Medical Rep': r.rep_name,
  'Account Type': r.account_type, 'Account Name': r.account_name, 'Account ID': r.account_id, 'Doctor Name': r.doctor_name,
  'Doctor ID': r.doctor_id, Territory: r.territory, Brick: r.brick, Speciality: r.speciality,
})

export default function ListCleaning() {
  const { month } = useMonth()
  const [line, setLine] = useState<string | null>(null)
  const [severity, setSeverity] = useState<Severity | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [manager, setManager] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)

  const lines = useAsync('list-cleaning:lines', fetchLineNames)
  const data = useAsync(`list-cleaning:${month}:${line ?? 'all'}`, async () => {
    const rows = await fetchListForCleaning(month, line)
    return { total: rows.length, issues: classify(rows) }
  })

  const issues = useMemo(() => data.data?.issues ?? [], [data.data])
  const managers = useMemo(() => [...new Set(issues.map((r) => r.manager).filter(Boolean))].sort(), [issues])
  const counts = useMemo(() => {
    const c: Record<Severity, number> = { High: 0, Medium: 0, Low: 0 }
    for (const r of issues) c[r.severity]++
    return c
  }, [issues])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return issues.filter((r) =>
      (!severity || r.severity === severity) && (!type || r.account_type === type) && (!manager || r.manager === manager) &&
      (!needle || [r.rep_name, r.rep_code, r.account_name, r.doctor_name, r.account_id, r.doctor_id].some((v) => v.toLowerCase().includes(needle))))
  }, [issues, severity, type, manager, q])

  const pages = Math.max(1, Math.ceil(shown.length / PAGE))
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE)
  const reset = () => setPage(0)

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const rows = shown.map(toSheetRow)
      const red = new Set<string>()
      shown.forEach((r, i) => { if (r.severity === 'High') red.add(`${i}|Severity`) })
      await downloadXlsxStyled(`list-cleaning-${month.slice(0, 7)}${line ? `-${line.replace(/\s+/g, '')}` : ''}${severity ? `-${severity}` : ''}.xlsx`, [{ name: 'List Cleaning', rows, redCells: red }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader title="List Cleaning" description="Checks the Account Name and Doctor Name the reps typed in the Target List. Review only, it never blocks an upload." />
      <p className="-mt-3 mb-5 text-sm text-muted-foreground">Target List of <b className="tnum text-foreground">{month.slice(0, 7)}</b> — change the month with the picker in the top bar.</p>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-card border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">List rows checked</div>
          {data.data ? <div className="tnum mt-1 text-2xl font-semibold">{data.data.total.toLocaleString()}</div> : <Skeleton className="mt-2 h-8 w-16" />}
          <div className="mt-1 text-xs text-muted-foreground">{data.data ? `${issues.length.toLocaleString()} with at least one issue` : ' '}</div>
        </div>
        {SEVERITIES.map((s) => (
          <button key={s} aria-pressed={severity === s} onClick={() => { setSeverity(severity === s ? null : s); reset() }}
            className={cn('rounded-card border bg-card p-4 text-left transition-colors hover:bg-muted', severity === s && 'border-primary ring-1 ring-primary')}>
            <div className="text-xs font-medium text-muted-foreground">{s}</div>
            {data.data ? <div className={cn('tnum mt-1 text-2xl font-semibold', s === 'High' && counts.High > 0 && 'text-danger')}>{counts[s].toLocaleString()}</div> : <Skeleton className="mt-2 h-8 w-16" />}
            <div className="mt-1 text-xs text-muted-foreground">{s === 'High' ? 'English letters, one-word doctor, wrong form' : s === 'Medium' ? 'Titles (د. / دكتور), missing عيادة / مستشفى / تعاقد / صيدلية' : 'Small deviations, extra spaces'}</div>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Combobox label="Line" placeholder="All lines" className="h-8" options={(lines.data ?? []).map((l) => ({ value: l.name, label: l.name }))} value={line} onChange={(v) => { setLine(v); reset() }} />
          <Combobox label="Severity" placeholder="All severities" className="h-8" options={SEVERITIES.map((s) => ({ value: s, label: s }))} value={severity} onChange={(v) => { setSeverity(v as Severity | null); reset() }} />
          <Combobox label="Account type" placeholder="All account types" className="h-8" options={TYPES.map((t) => ({ value: t, label: t }))} value={type} onChange={(v) => { setType(v); reset() }} />
          <Combobox label="Direct manager" placeholder="All managers" className="h-8" options={managers.map((m) => ({ value: m, label: m }))} value={manager} onChange={(v) => { setManager(v); reset() }} />
          <Input aria-label="Search" placeholder="Search rep, account, doctor…" className="h-8 w-56" value={q} onChange={(e) => { setQ(e.target.value); reset() }} />
          <Button size="sm" className="ml-auto" disabled={exporting || shown.length === 0} onClick={() => void exportXlsx()}>
            <Download className="h-4 w-4" aria-hidden /> {exporting ? 'Exporting…' : `Export (${shown.length.toLocaleString()})`}
          </Button>
        </div>
        {data.error ? (
          <ErrorState message={data.error} onRetry={data.reload} />
        ) : data.loading ? (
          <div className="space-y-3 p-4" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
        ) : data.data && data.data.total === 0 ? (
          <EmptyState icon={SearchCheck} title="No Target List for this month" description="Upload the list first, or pick another month in the top bar." />
        ) : shown.length === 0 ? (
          <EmptyState icon={Sparkles} title="Nothing to clean" description="No row matches this selection." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                  {HEADERS.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={`${r.account_id}-${r.doctor_id}-${r.rep_code}-${i}`} className="border-b align-top last:border-0 hover:bg-muted/60">
                    <td className="px-3 py-2.5"><Badge tone={TONE[r.severity]}>{r.severity}</Badge></td>
                    <td className="min-w-72 px-3 py-2.5 text-xs text-muted-foreground">{r.issues.split(' | ').map((m, k) => <div key={k}>{m}</div>)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.line}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.manager}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.box}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.rep_name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.account_type}</td>
                    <td dir="auto" className="px-3 py-2.5">{r.account_name}</td>
                    <td className="tnum px-3 py-2.5">{r.account_id}</td>
                    <td dir="auto" className="px-3 py-2.5">{r.doctor_name}</td>
                    <td className="tnum px-3 py-2.5">{r.doctor_id}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.territory}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.brick}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{r.speciality}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between border-t p-3 text-xs text-muted-foreground">
          <span className="tnum">{shown.length.toLocaleString()} row(s)</span>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="tnum px-2">{page + 1} / {pages}</span>
            <Button size="icon-sm" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
