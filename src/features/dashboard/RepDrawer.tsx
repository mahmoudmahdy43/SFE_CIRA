import { ProfileLink } from '../../components/app/ProfileLink'
import { Skeleton } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { ErrorState } from '../../components/app/states'
import { fetchRepHistory } from '../../lib/api/kpi'
import { kpiTone, toneText } from '../../lib/kpi'
import { cn } from '../../lib/utils'
import { fmtInt, fmtPct, fmtRate, statusMix, type TreeNode } from './kpiMath'
import { useAsync } from './useAsync'

const ratio = (v: number | null) => <span className={cn(v !== null && toneText[kpiTone(v, 1)])}>{fmtPct(v)}</span>

/** Side drawer for a rep: this month's numbers + the last months from v_kpi_rep (the full profile is the 360° view). */
export function RepDrawer({ node, month, onClose }: { node: TreeNode | null; month: string; onClose: () => void }) {
  return (
    <Dialog open={node !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={node?.name ?? 'Rep'} side="right">
        {node && <Body node={node} month={month} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ node, month }: { node: TreeNode; month: string }) {
  const history = useAsync(`repHistory:${node.repId}`, () => fetchRepHistory(node.repId as number))
  const mix = statusMix(node)
  const facts: [string, React.ReactNode][] = [
    ['Total KPI', ratio(node.total_kpi)],
    ['Coverage', ratio(node.coverage)],
    ['PCF', ratio(node.pcf)],
    ['Ach CR', ratio(node.ach_cr)],
    ['Call rate AM', `${fmtRate(node.call_rate_am)}${node.target_am ? ` (target ${fmtRate(node.target_am)})` : ''}`],
    ['Call rate PM', `${fmtRate(node.call_rate_pm)}${node.target_pm ? ` (target ${fmtRate(node.target_pm)})` : ''}`],
    ['List doctors / covered', `${fmtInt(node.list_doctors)} / ${fmtInt(node.covered_doctors)}`],
    ['Visits (valid / total)', `${fmtInt(node.valid_visits)} / ${fmtInt(node.total_visits)}`],
    ['Planned / Direct', `${fmtInt(node.planned_visits)} / ${fmtInt(node.direct_visits)}`],
    ['Actual days AM / PM', `${fmtInt(node.days_am)} / ${fmtInt(node.days_pm)}`],
    ['Missing AM / PM', `${fmtInt(node.missing_am)} / ${fmtInt(node.missing_pm)}`],
    ['Leave / OW / Activity days', `${mix.leave} / ${mix.office_work} / ${mix.activity}`],
  ]
  return (
    <div className="h-full space-y-6 overflow-y-auto p-6">
      <div>
        <h2 className="text-lg font-semibold">{node.name}</h2>
        <p className="tnum text-sm text-muted-foreground">{node.code} · {node.boxName ?? 'no box'} · {month.slice(0, 7)}</p>
        <p className="mt-1 text-sm"><ProfileLink type="rep" id={node.repId} className="text-primary">Open 360° profile</ProfileLink></p>
      </div>
      <dl className="divide-y text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="tnum text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Last months</h3>
        {history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} className="py-6" />
        ) : !history.data ? (
          <Skeleton className="h-24" />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Month</th><th className="py-1.5 text-right font-medium">Coverage</th><th className="py-1.5 text-right font-medium">PCF</th><th className="py-1.5 text-right font-medium">Ach CR</th><th className="py-1.5 text-right font-medium">Total</th></tr></thead>
            <tbody>
              {history.data.map((h) => (
                <tr key={h.month} className={cn('border-b last:border-0', h.month === month && 'bg-accent/40')}>
                  <td className="tnum py-1.5">{h.month.slice(0, 7)}</td>
                  <td className="tnum py-1.5 text-right">{fmtPct(h.coverage)}</td>
                  <td className="tnum py-1.5 text-right">{fmtPct(h.pcf)}</td>
                  <td className="tnum py-1.5 text-right">{fmtPct(h.ach_cr)}</td>
                  <td className="tnum py-1.5 text-right font-semibold">{fmtPct(h.total_kpi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
