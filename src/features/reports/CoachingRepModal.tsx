import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Skeleton } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { ErrorState } from '../../components/app/states'
import { fetchCoachingRepVisits } from '../../lib/api/coaching'
import { useAsync } from '../dashboard/useAsync'
import { CPAL } from './coverageMath'
import { fmtDay, fmtScore, fmtSigned, isTraining, type EvalGroup, type RepSummary, type RepVisit } from './coachingMath'

interface Props {
  rep: RepSummary | null
  from: string
  to: string
  group: EvalGroup
  /** Questionnaire skills in order. */
  catalog: { code: string; name: string }[]
  onClose: () => void
}

interface DotProps { cx?: number; cy?: number; payload?: { training: boolean } }
/** Training = filled circle, Manager = filled diamond. */
function VisitDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return <g />
  return payload.training ? (
    <circle cx={cx} cy={cy} r={5} fill={CPAL.green} stroke="#fff" strokeWidth={1} />
  ) : (
    <rect x={cx - 4.5} y={cy - 4.5} width={9} height={9} transform={`rotate(45 ${cx} ${cy})`} fill={CPAL.red} stroke="#fff" strokeWidth={1} />
  )
}

function Delta({ v }: { v: number | null }) {
  const Icon = v === null || v === 0 ? Minus : v > 0 ? ArrowUpRight : ArrowDownRight
  const color = v === null || v === 0 ? CPAL.grey : v > 0 ? CPAL.green : CPAL.red
  return <span className="tnum inline-flex items-center justify-end gap-0.5 font-bold" style={{ color }}><Icon className="h-3.5 w-3.5" aria-hidden />{fmtSigned(v, 0)}</span>
}

function Body({ rep, from, to, group, catalog }: Omit<Props, 'rep' | 'onClose'> & { rep: RepSummary }) {
  const q = useAsync(`coach:visits:${rep.rep_key}:${from}:${to}:${group}`, () => fetchCoachingRepVisits(rep.rep_key, from, to, group))
  const visits = useMemo<RepVisit[]>(() => [...(q.data ?? [])].sort((a, b) => a.seq - b.seq), [q.data])
  const chart = visits.map((v) => ({ seq: v.seq, score: v.avg_score, training: isTraining(v.eval_group), evaluator: v.evaluator ?? '' }))
  const first = visits[0]
  const last = visits[visits.length - 1]

  if (q.error) return <ErrorState message={q.error} onRetry={q.reload} />
  if (q.loading) return <div className="mt-4 space-y-3" aria-busy="true"><Skeleton className="h-56" /><Skeleton className="h-32" /></div>
  if (visits.length === 0) return <p className="mt-6 text-center text-sm text-muted-foreground">No evaluation in this period.</p>
  return (
    <div className="mt-4 max-h-[70vh] space-y-5 overflow-auto pr-1">
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: CPAL.slate }}>Visit score by sequence</h3>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><svg width="10" height="10"><circle cx="5" cy="5" r="4.5" fill={CPAL.green} /></svg> Training</span>
            <span className="inline-flex items-center gap-1"><svg width="10" height="10"><rect x="1.5" y="1.5" width="7" height="7" transform="rotate(45 5 5)" fill={CPAL.red} /></svg> Manager</span>
          </span>
        </div>
        <div role="img" aria-label="Average score of each coaching visit in order" className="h-56">
          <ResponsiveContainer>
            <LineChart data={chart} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="seq" allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11 }} tickLine={false} />
              <Tooltip formatter={(v: number) => fmtScore(v)} labelFormatter={(s) => `Visit ${s}`} />
              <Line dataKey="score" name="Average score" stroke={CPAL.slate} strokeWidth={1.5} dot={VisitDot} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>{['#', 'Date', 'Evaluator', 'Group', 'Avg'].map((h, i) => <th key={h} className={`h-8 px-3 text-xs font-bold text-white ${i === 4 || i === 0 ? 'text-center' : 'text-left'}`} style={{ backgroundColor: CPAL.slate }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {visits.map((v, i) => (
              <tr key={v.visit_id} style={i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                <td className="tnum h-8 border-b px-3 text-center" style={{ borderBottomColor: CPAL.rowLine }}>{v.seq}</td>
                <td className="tnum whitespace-nowrap border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}>{fmtDay(v.visit_date)}</td>
                <td className="border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}>{v.evaluator ?? '—'}</td>
                <td className="border-b px-3 font-medium" style={{ borderBottomColor: CPAL.rowLine, color: isTraining(v.eval_group) ? CPAL.green : CPAL.red }}>{isTraining(v.eval_group) ? 'Training' : 'Manager'}</td>
                <td className="tnum border-b px-3 text-center font-bold" style={{ borderBottomColor: CPAL.rowLine, color: CPAL.navy }}>{fmtScore(v.avg_score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide" style={{ color: CPAL.slate }}>Skills: first visit vs last visit</h3>
        {visits.length < 2 ? (
          <p className="text-sm text-muted-foreground">Only one visit in this period: nothing to compare yet.</p>
        ) : (
          <>
            <div className="mb-1 flex gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: '#9AA5B4' }} /> First ({fmtDay(first.visit_date)})</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: CPAL.teal }} /> Last ({fmtDay(last.visit_date)})</span>
            </div>
            <div className="space-y-2">
              {catalog.filter((c) => first.scores[c.code] !== undefined || last.scores[c.code] !== undefined).map((c) => {
                const a = first.scores[c.code] ?? null
                const b = last.scores[c.code] ?? null
                return (
                  <div key={c.code} className="grid grid-cols-[minmax(7rem,14rem)_1fr_3.5rem] items-center gap-3 text-sm">
                    <span className="truncate" style={{ color: CPAL.navy }} title={c.name}>{c.name}</span>
                    <div className="space-y-0.5">
                      {([[a, '#9AA5B4'], [b, CPAL.teal]] as const).map(([v, color], i) => (
                        <div key={i} className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-sm" style={{ backgroundColor: CPAL.zebra }}>{v !== null && <div className="h-full rounded-sm" style={{ width: `${(v / 5) * 100}%`, backgroundColor: color }} />}</div>
                          <span className="tnum w-4 text-right text-xs">{v ?? '—'}</span>
                        </div>
                      ))}
                    </div>
                    <Delta v={a !== null && b !== null ? b - a : null} />
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export function CoachingRepModal({ rep, from, to, group, catalog, onClose }: Props) {
  return (
    <Dialog open={rep !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      {rep && (
        <DialogContent
          title={`${rep.rep_name}${rep.rep_code ? ` (${rep.rep_code})` : ''}`}
          description={`${rep.line ?? '—'} · Manager: ${rep.manager ?? '—'} · ${rep.visits} coaching visit${rep.visits === 1 ? '' : 's'} · average ${fmtScore(rep.avg_score)} / 5`}
          className="max-w-3xl"
        >
          <Body rep={rep} from={from} to={to} group={group} catalog={catalog} />
        </DialogContent>
      )}
    </Dialog>
  )
}
