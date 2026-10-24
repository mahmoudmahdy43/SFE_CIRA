import { useMemo, useState } from 'react'
import { FileSpreadsheet, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/misc'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchPlanActuals, fetchPlanInputs, fetchPlanReps, type PlanRep } from '../../lib/api/plan'
import { backtest, type Backtest } from './planner'

interface Result { rep: PlanRep; bt: Backtest | null; error: string | null }

const pct = (v: number) => `${(v * 100).toFixed(0)}%`
const pp = (a: number, b: number) => { const d = (a - b) * 100; return `${d >= 0 ? '+' : ''}${d.toFixed(0)} pp` }
const km = (v: number) => v.toFixed(1)
const gShare = (b: Backtest, g: 'A' | 'B' | 'C'): number => { const t = b.grades.A + b.grades.B + b.grades.C; return t > 0 ? b.grades[g] / t : 0 }
const levelText = (b: Backtest): string => (b.targetsMet ? `L${b.level}` : b.level ? `not reached (best L${b.level})` : '-')
const SELECT = 'h-8 rounded-control border bg-card px-2 text-sm text-foreground'

function prevMonth(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Runs the planner on a past month with the days the rep really worked and compares it with what he did. */
export function BacktestPanel({ reps, selected }: { reps: PlanRep[]; selected: PlanRep | null }) {
  const [month, setMonth] = useState(prevMonth)
  const [results, setResults] = useState<Result[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const run = async (list: PlanRep[]) => {
    setBusy(true)
    setResults([])
    const out: Result[] = []
    let done = 0
    const queue = [...list]
    const worker = async () => {
      for (let rep = queue.shift(); rep; rep = queue.shift()) {
        try {
          const [inputs, actuals] = await Promise.all([fetchPlanInputs(rep.rep_id, month), fetchPlanActuals(rep.rep_id, month)])
          out.push({ rep, bt: inputs.doctors.length === 0 ? null : backtest(inputs, actuals), error: inputs.doctors.length === 0 ? 'no list' : null })
        } catch (e) {
          out.push({ rep, bt: null, error: e instanceof Error ? e.message : 'failed' })
        }
        done++
        setProgress(`${done} / ${list.length}`)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    out.sort((a, b) => (b.bt ? b.bt.plan.cov15 - b.bt.actual.cov15 : -9) - (a.bt ? a.bt.plan.cov15 - a.bt.actual.cov15 : -9))
    setResults(out)
    setBusy(false)
    setProgress('')
  }

  const runAll = async () => {
    try {
      // the reps of the backtest month (not of the plan month), narrowed to the same line / manager filter
      const inMonth = await fetchPlanReps(month)
      const keep = new Set(reps.map((r) => r.rep_id))
      await run(inMonth.filter((r) => keep.has(r.rep_id)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Backtest failed')
      setBusy(false)
    }
  }

  const ok = results.filter((r) => r.bt)
  const avg = useMemo(() => {
    if (ok.length === 0) return null
    const m = (f: (b: Backtest) => number) => ok.reduce((a, r) => a + f(r.bt as Backtest), 0) / ok.length
    return { cp: m((b) => b.plan.cov15), ca: m((b) => b.actual.cov15), pp: m((b) => b.plan.pcf), pa: m((b) => b.actual.pcf), kp: m((b) => b.plan.avgKm), ka: m((b) => b.actual.avgKm), op: m((b) => b.plan.daysOver), oa: m((b) => b.actual.daysOver), mp: m((b) => b.plan.maxDay), ma: m((b) => b.actual.maxDay), ga: m((b) => gShare(b, 'A')), gb: m((b) => gShare(b, 'B')), gc: m((b) => gShare(b, 'C')), met: ok.filter((r) => (r.bt as Backtest).targetsMet).length }
  }, [ok])

  const exportXlsx = () => {
    void downloadXlsx(`Plan_Backtest_${month.slice(0, 7)}.xlsx`, 'Backtest', results.map((r) => ({
      Line: r.rep.line_name, Manager: r.rep.manager_name, Rep: r.rep.name,
      'Coverage d15 plan %': r.bt ? Math.round(r.bt.plan.cov15 * 100) : null, 'Coverage d15 actual %': r.bt ? Math.round(r.bt.actual.cov15 * 100) : null,
      'PCF plan %': r.bt ? Math.round(r.bt.plan.pcf * 100) : null, 'PCF actual %': r.bt ? Math.round(r.bt.actual.pcf * 100) : null,
      'Avg daily km plan': r.bt ? Number(r.bt.plan.avgKm.toFixed(1)) : null, 'Avg daily km actual': r.bt ? Number(r.bt.actual.avgKm.toFixed(1)) : null,
      'Days over target plan': r.bt ? r.bt.plan.daysOver : null, 'Days over target actual': r.bt ? r.bt.actual.daysOver : null,
      'Highest day plan': r.bt ? r.bt.plan.maxDay : null, 'Highest day actual': r.bt ? r.bt.actual.maxDay : null,
      'Grade A %': r.bt ? Math.round(gShare(r.bt, 'A') * 100) : null, 'Grade B %': r.bt ? Math.round(gShare(r.bt, 'B') * 100) : null, 'Grade C %': r.bt ? Math.round(gShare(r.bt, 'C') * 100) : null,
      'Level reached': r.bt ? levelText(r.bt) : '', Note: r.error ?? '',
    })))
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Backtest</h2>
        <input type="month" aria-label="Backtest month" className={SELECT} value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)} />
        <Button size="sm" disabled={busy || !selected} onClick={() => selected && void run([selected])}><FlaskConical className="h-4 w-4" aria-hidden /> This rep</Button>
        <Button size="sm" disabled={busy || reps.length === 0} onClick={() => void runAll()}><FlaskConical className="h-4 w-4" aria-hidden /> All {reps.length} reps in the filter</Button>
        <Button size="sm" disabled={results.length === 0} onClick={exportXlsx}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel</Button>
        {busy && <span className="text-sm text-muted-foreground" role="status">Running {progress}</span>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">The plan is generated for that month with the days that were really closed (leaves and registered PM activity / training) and compared with his actual PM visits to the doctors of his list. A day with no visit stays open. The PM window comes from his 3 months before. No planned day goes above 12 visits. Distance is the straight-line GPS distance between consecutive visits of a day.</p>
      {results.length > 0 && (
        <div className="mt-3 max-h-[60vh] overflow-auto rounded-card border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs">
              <tr>
                <th className="px-2 py-1.5 text-left">Line</th><th className="px-2 py-1.5 text-left">Manager</th><th className="px-2 py-1.5 text-left">Rep</th>
                <th className="px-2 py-1.5 text-right">Cov d15 plan</th><th className="px-2 py-1.5 text-right">actual</th><th className="px-2 py-1.5 text-right">gain</th>
                <th className="px-2 py-1.5 text-right">PCF plan</th><th className="px-2 py-1.5 text-right">actual</th>
                <th className="px-2 py-1.5 text-right">Est. km/day plan</th><th className="px-2 py-1.5 text-right">actual</th>
                <th className="px-2 py-1.5 text-right">Days over plan</th><th className="px-2 py-1.5 text-right">actual</th><th className="px-2 py-1.5 text-right">Peak day plan</th><th className="px-2 py-1.5 text-right">actual</th>
                <th className="px-2 py-1.5 text-right">A %</th><th className="px-2 py-1.5 text-right">B %</th><th className="px-2 py-1.5 text-right">C %</th><th className="px-2 py-1.5 text-left">Level</th>
              </tr>
            </thead>
            <tbody>
              {avg && (
                <tr className="bg-accent font-semibold">
                  <td className="px-2 py-1.5" colSpan={3}>Average of {ok.length} reps</td>
                  <td className="tnum px-2 py-1.5 text-right">{pct(avg.cp)}</td><td className="tnum px-2 py-1.5 text-right">{pct(avg.ca)}</td><td className="tnum px-2 py-1.5 text-right">{pp(avg.cp, avg.ca)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{pct(avg.pp)}</td><td className="tnum px-2 py-1.5 text-right">{pct(avg.pa)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{km(avg.kp)}</td><td className="tnum px-2 py-1.5 text-right">{km(avg.ka)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{avg.op.toFixed(1)}</td><td className="tnum px-2 py-1.5 text-right">{avg.oa.toFixed(1)}</td><td className="tnum px-2 py-1.5 text-right">{avg.mp.toFixed(1)}</td><td className="tnum px-2 py-1.5 text-right">{avg.ma.toFixed(1)}</td>
                  <td className="tnum px-2 py-1.5 text-right">{pct(avg.ga)}</td><td className="tnum px-2 py-1.5 text-right">{pct(avg.gb)}</td><td className="tnum px-2 py-1.5 text-right">{pct(avg.gc)}</td><td className="px-2 py-1.5">{avg.met} of {ok.length} met</td>
                </tr>
              )}
              {results.map((r) => (
                <tr key={r.rep.rep_id} className="border-t">
                  <td className="px-2 py-1">{r.rep.line_name}</td><td className="px-2 py-1">{r.rep.manager_name}</td><td className="px-2 py-1 font-medium">{r.rep.name}</td>
                  {r.bt ? (
                    <>
                      <td className="tnum px-2 py-1 text-right">{pct(r.bt.plan.cov15)}</td><td className="tnum px-2 py-1 text-right">{pct(r.bt.actual.cov15)}</td>
                      <td className="tnum px-2 py-1 text-right font-semibold">{pp(r.bt.plan.cov15, r.bt.actual.cov15)}</td>
                      <td className="tnum px-2 py-1 text-right">{pct(r.bt.plan.pcf)}</td><td className="tnum px-2 py-1 text-right">{pct(r.bt.actual.pcf)}</td>
                      <td className="tnum px-2 py-1 text-right">{km(r.bt.plan.avgKm)}</td><td className="tnum px-2 py-1 text-right">{km(r.bt.actual.avgKm)}</td>
                      <td className="tnum px-2 py-1 text-right">{r.bt.plan.daysOver}</td><td className="tnum px-2 py-1 text-right">{r.bt.actual.daysOver}</td><td className="tnum px-2 py-1 text-right">{r.bt.plan.maxDay}</td><td className={`tnum px-2 py-1 text-right ${r.bt.actual.maxDay > 12 ? 'font-bold text-red-700' : ''}`}>{r.bt.actual.maxDay}</td>
                      <td className="tnum px-2 py-1 text-right">{pct(gShare(r.bt, 'A'))}</td><td className="tnum px-2 py-1 text-right">{pct(gShare(r.bt, 'B'))}</td><td className="tnum px-2 py-1 text-right">{pct(gShare(r.bt, 'C'))}</td>
                      <td className={`px-2 py-1 ${r.bt.targetsMet ? '' : 'font-semibold text-red-700'}`}>{levelText(r.bt)}</td>
                    </>
                  ) : <td colSpan={15} className="px-2 py-1 text-muted-foreground">{r.error}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
