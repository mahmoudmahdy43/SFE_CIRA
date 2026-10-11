import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge, Skeleton } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { ErrorState } from '../../components/app/states'
import { fetchCoverageDoctors, type CoverageDoctor, type DoctorStatus } from '../../lib/api/reports'
import { downloadCsv } from '../../lib/csv'
import { cn } from '../../lib/utils'
import { useAsync } from '../dashboard/useAsync'
import { DASH, type CoverageRow } from './reportMath'

const STATUS: Record<DoctorStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  fully: { label: 'Fully', tone: 'success' },
  partially: { label: 'Partial', tone: 'warning' },
  not_visited: { label: 'Not visited', tone: 'danger' },
}

export function CoverageDrawer({ rep, month, onClose }: { rep: CoverageRow | null; month: string; onClose: () => void }) {
  return (
    <Dialog open={rep !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={rep?.rep_name ?? 'Rep'} description="Doctors on the rep's list this month" side="right" className="sm:w-[34rem]">
        {rep && <Body rep={rep} month={month} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ rep, month }: { rep: CoverageRow; month: string }) {
  const [filter, setFilter] = useState<DoctorStatus | 'all'>('all')
  const docs = useAsync(`cov:doctors:${rep.rep_id}:${month}`, () => fetchCoverageDoctors(rep.rep_id, month))
  const all = useMemo(() => docs.data ?? [], [docs.data])
  const shown = useMemo(() => (filter === 'all' ? all : all.filter((d) => d.status === filter)), [all, filter])
  const count = (s: DoctorStatus) => all.filter((d) => d.status === s).length

  const exportCsv = () =>
    downloadCsv(
      `coverage-doctors-${rep.rep_code ?? rep.rep_id}-${month.slice(0, 7)}.csv`,
      shown.map((d: CoverageDoctor) => ({ Doctor: d.doctor_name, Account: d.account_name, Class: d.class, Freq: d.freq, Visits: d.visits, Status: STATUS[d.status].label })),
    )

  const chips: { id: DoctorStatus | 'all'; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: all.length },
    { id: 'fully', label: 'Fully', n: count('fully') },
    { id: 'partially', label: 'Partial', n: count('partially') },
    { id: 'not_visited', label: 'Not visited', n: count('not_visited') },
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b p-6 pb-4">
        <div>
          <h2 className="text-lg font-semibold">{rep.rep_name}</h2>
          <p className="tnum text-sm text-muted-foreground">{rep.rep_code ?? DASH} · {rep.box ?? 'no box'} · {month.slice(0, 7)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Status filter">
          {chips.map((c) => (
            <button
              key={c.id}
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted', filter === c.id && 'border-primary bg-accent font-medium text-accent-foreground')}
            >
              {c.label} <span className="tnum">{docs.data ? c.n : ''}</span>
            </button>
          ))}
          <Button size="sm" className="ml-auto" onClick={exportCsv} disabled={shown.length === 0}><Download className="h-4 w-4" /> CSV</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {docs.error ? (
          <ErrorState message={docs.error} onRetry={docs.reload} className="py-10" />
        ) : !docs.data ? (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : (
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {['Doctor', 'Account', 'Class', 'Freq', 'Visits', 'Status'].map((h, i) => (
                  <th key={h} className={cn('sticky top-0 border-b bg-muted px-3 py-2 font-medium', i >= 3 && i < 5 && 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <tr key={d.doctor_id}>
                  <td className="border-b px-3 py-2 font-medium">{d.doctor_name}</td>
                  <td className="border-b px-3 py-2 text-muted-foreground">{d.account_name ?? DASH}</td>
                  <td className="border-b px-3 py-2">{d.class ?? DASH}</td>
                  <td className="tnum border-b px-3 py-2 text-right">{d.freq ?? DASH}</td>
                  <td className="tnum border-b px-3 py-2 text-right">{d.visits}</td>
                  <td className="border-b px-3 py-2"><Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge></td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">No doctors match this filter.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
