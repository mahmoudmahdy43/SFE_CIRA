import { useMemo } from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Badge, Card } from '../../../components/ui/misc'
import { downloadCsv } from '../../../lib/csv'
import RejectedGroups from '../RejectedGroups'
import type { LoadOutcome } from '../types'
import type { RawLeavesExtra } from './rawLeavesLoad'
import { splitEmployeeRejections } from './rawLeavesParse'

const TONE = { Approved: 'success', Pending: 'warning', Rejected: 'danger' } as const

/** Result of the raw leaves upload: loaded / rejected, status counts, employees to add in Personnel, other rejected rows, CSV. */
export default function RawLeavesResult({ outcome }: { outcome: LoadOutcome }) {
  const split = useMemo(() => splitEmployeeRejections(outcome.rejected), [outcome.rejected])
  const other = useMemo(() => ({ ...outcome, rejected: split.other }), [outcome, split.other])
  const status = (outcome.extra as RawLeavesExtra | undefined)?.status ?? {}
  const exportCsv = () =>
    downloadCsv(`rejected-leaves-batch-${outcome.batch}.csv`, outcome.rejected.map((r) => ({ Row: r.excelRow ?? '', Reason: r.reason, Details: r.context })))
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <dl className="grid gap-x-8 sm:grid-cols-3">
          <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Loaded</dt><dd className="tnum text-xl font-semibold">{outcome.loaded.toLocaleString()}</dd></div>
          <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Rejected</dt><dd className={`tnum text-xl font-semibold ${outcome.rejectedCount > 0 ? 'text-danger' : ''}`}>{outcome.rejectedCount.toLocaleString()}</dd></div>
          <div className="border-b py-1.5 text-sm"><dt className="text-muted-foreground">Months refreshed</dt><dd className="tnum text-xl font-semibold">{outcome.months.length}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status of the loaded leaves:</span>
          {Object.keys(status).length === 0 ? <span className="text-muted-foreground">not reported</span> : Object.entries(status).map(([k, n]) => <Badge key={k} tone={TONE[k as keyof typeof TONE] ?? 'neutral'}>{k}: <span className="tnum ml-1">{Number(n).toLocaleString()}</span></Badge>)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Only Approved leaves count in the calculations; the others are stored but ignored. {outcome.months.map((m) => m.slice(0, 7)).join(', ')} · batch #{outcome.batch}.</p>
      </Card>

      {split.employees.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> Employees to add in Personnel ({split.employees.length.toLocaleString()})</h3>
          <p className="mb-3 text-sm text-muted-foreground">These names could not be matched. Add them in Personnel (reps / managers, with a CODE), then upload the file again.</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Employee (name in the CRM)</th><th className="py-1.5 font-medium">Problem</th><th className="py-1.5 text-right font-medium">Rejected leaves</th></tr></thead>
            <tbody>
              {split.employees.map((o) => (
                <tr key={`${o.kind}|${o.employee}`} className="border-b last:border-0"><td className="py-1.5">{o.employee}</td><td className="py-1.5 text-muted-foreground">{o.kind === 'unknown employee' ? 'Not found in reps / managers' : 'Found, but has no CODE'}</td><td className="tnum py-1.5 text-right">{o.count.toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {split.other.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold">Other rejected rows</h3>
          <RejectedGroups outcome={other} />
        </Card>
      )}

      {outcome.rejected.length > 0 && <Button onClick={exportCsv}><Download className="h-4 w-4" aria-hidden /> Export rejected rows (CSV)</Button>}
    </div>
  )
}
