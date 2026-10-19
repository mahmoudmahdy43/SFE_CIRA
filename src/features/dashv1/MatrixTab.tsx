import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card, Input } from '../../components/ui/misc'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART } from '../../components/app/charts'
import { useAsync } from '../dashboard/useAsync'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchMatrix, type Group, type MatrixRow, type Range } from '../../lib/api/dashV1'
import { groupRows, money, num, pctPt } from './dashMath'
import { AXIS, Loadable, SortTable, type Col } from './ui'

const QUADS: { id: Exclude<Group, 'NO_DATA'>; title: string; hint: string; color: string }[] = [
  { id: 'STAR', title: 'Star', hint: 'High effort, high sales', color: CHART[2] },
  { id: 'NOT_CONVERTING', title: 'Not converting', hint: 'High effort, low sales — check targeting / quality', color: CHART[1] },
  { id: 'EFFICIENT', title: 'Efficient', hint: 'Low effort, high sales', color: CHART[4] },
  { id: 'INTERVENTION', title: 'Intervention', hint: 'Low effort, low sales', color: CHART[3] },
]
const LABEL: Record<Group, string> = { STAR: 'Star', NOT_CONVERTING: 'Not converting', EFFICIENT: 'Efficient', INTERVENTION: 'Intervention', NO_DATA: 'No data' }

function Slider({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: string }) {
  return (
    <label className="block min-w-[14rem] flex-1 text-xs text-muted-foreground">
      <span className="flex justify-between"><span>{label}</span><span className="tnum font-medium text-foreground">{value}%</span></span>
      <input type="range" min={0} max={150} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[hsl(var(--primary))]" />
      <span className="block">{hint}</span>
    </label>
  )
}

export function MatrixTab({ range }: { range: Range }) {
  const [effort, setEffort] = useState(85)
  const [sales, setSales] = useState(90)
  // the RPC runs once the sliders rest, not on every tick
  const [applied, setApplied] = useState({ effort: 85, sales: 90 })
  useEffect(() => {
    const t = setTimeout(() => setApplied({ effort, sales }), 350)
    return () => clearTimeout(t)
  }, [effort, sales])
  const state = useAsync(`dashv1:matrix:${range.from}:${range.to}:${range.line ?? 'all'}:${applied.effort}:${applied.sales}`, () => fetchMatrix(range, applied.effort, applied.sales))

  const [grp, setGrp] = useState<'' | Group>('')
  const [mgr, setMgr] = useState('')
  const [q, setQ] = useState('')
  const all = useMemo(() => state.data ?? [], [state.data])
  const groups = useMemo(() => groupRows(all), [all])
  const managers = useMemo(() => [...new Set(all.map((r) => r.manager_name).filter(Boolean))].sort(), [all])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter((r) => (!grp || r.grp === grp) && (!mgr || r.manager_name === mgr) && (!s || `${r.rep_name} ${r.line_name}`.toLowerCase().includes(s)))
  }, [all, grp, mgr, q])

  const cols: Col<MatrixRow>[] = [
    { id: 'rep', header: 'Rep', sort: (r) => r.rep_name, cell: (r) => r.rep_name },
    { id: 'line', header: 'Line', sort: (r) => r.line_name, cell: (r) => r.line_name },
    { id: 'mgr', header: 'Manager', sort: (r) => r.manager_name, cell: (r) => r.manager_name || '–' },
    { id: 'ter', header: 'Territories', align: 'right', sort: (r) => r.territories, cell: (r) => r.territories },
    { id: 'vis', header: 'Visits', align: 'right', sort: (r) => r.visits, cell: (r) => num(r.visits) },
    { id: 'cr', header: 'Call rate PM', align: 'right', sort: (r) => r.call_rate_pm, cell: (r) => num(r.call_rate_pm, 1) },
    { id: 'eff', header: 'Effort %', align: 'right', sort: (r) => r.effort_pct, cell: (r) => pctPt(r.effort_pct, 0) },
    { id: 'sal', header: 'Sales', align: 'right', sort: (r) => r.s_value, cell: (r) => money(r.s_value) },
    { id: 'ach', header: 'Achievement %', align: 'right', sort: (r) => r.ach_pct, cell: (r) => pctPt(r.ach_pct, 0) },
    { id: 'grp', header: 'Group', sort: (r) => r.grp, cell: (r) => LABEL[r.grp] },
  ]

  const exportXlsx = () =>
    void downloadXlsx(`dashboard-v1-reps-${range.from.slice(0, 7)}-${range.to.slice(0, 7)}.xlsx`, 'Reps matrix', rows.map((r) => ({
      Rep: r.rep_name, Line: r.line_name, Manager: r.manager_name, Territories: r.territories, Visits: r.visits, 'PM days': r.days_pm,
      'Call rate PM': r.call_rate_pm, 'Target PM': r.target_pm, 'Effort %': r.effort_pct, Sales: r.s_value, Target: r.t_value, 'Achievement %': r.ach_pct, Group: LABEL[r.grp],
    })))

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap gap-6 p-4">
        <Slider label="Effort threshold" value={effort} onChange={setEffort} hint="Visits ÷ expected visits" />
        <Slider label="Sales threshold" value={sales} onChange={setSales} hint="Sales achievement" />
      </Card>

      <Loadable state={state} height="h-72">
        {() => (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {QUADS.map((qd) => {
                const list = groups[qd.id]
                return (
                  <Card key={qd.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold"><span aria-hidden className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: qd.color }} />{qd.title}</h3>
                      <span className="tnum text-2xl font-semibold">{list.length}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{qd.hint}</p>
                    <p className="mt-2 text-sm">{list.slice(0, 5).map((r) => r.rep_name).join(', ') || '—'}{list.length > 5 && ` +${list.length - 5} more`}</p>
                  </Card>
                )
              })}
            </div>
            {groups.NO_DATA.length > 0 && (
              <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">No data ({groups.NO_DATA.length}):</span> {groups.NO_DATA.map((r) => r.rep_name).join(', ')}</p>
            )}

            <ChartCard title="Effort vs sales" description="Each dot is a rep. Dashed lines are the thresholds.">
              <div role="img" aria-label="Reps by effort and sales achievement" className="h-80">
                <ResponsiveContainer>
                  <ComposedChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="hsl(var(--border))" />
                    <XAxis type="number" dataKey="x" name="Effort %" {...AXIS} tickFormatter={(v: number) => `${v}%`} />
                    <YAxis type="number" dataKey="y" name="Achievement %" {...AXIS} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                      const p = active ? (payload?.[0]?.payload as { name?: string; x: number; y: number } | undefined) : undefined
                      return p ? <div className="rounded-control border bg-popover px-3 py-2 text-xs shadow-pop"><div className="font-medium">{p.name}</div>Effort {p.x.toFixed(0)}% · Sales {p.y.toFixed(0)}%</div> : null
                    }} />
                    <ReferenceLine x={applied.effort} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />
                    <ReferenceLine y={applied.sales} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />
                    {QUADS.map((qd) => (
                      <Scatter key={qd.id} name={qd.title} fill={qd.color} fillOpacity={0.75}
                        data={groups[qd.id].filter((r) => r.effort_pct !== null && r.ach_pct !== null).map((r) => ({ x: r.effort_pct as number, y: r.ach_pct as number, name: r.rep_name }))} />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Search reps" placeholder="Search rep…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
              <select aria-label="Filter by group" value={grp} onChange={(e) => setGrp(e.target.value as '' | Group)} className="h-9 rounded-control border bg-card px-2 text-sm">
                <option value="">All groups</option>
                {(Object.keys(LABEL) as Group[]).map((g) => <option key={g} value={g}>{LABEL[g]}</option>)}
              </select>
              <select aria-label="Filter by manager" value={mgr} onChange={(e) => setMgr(e.target.value)} className="h-9 rounded-control border bg-card px-2 text-sm">
                <option value="">All managers</option>
                {managers.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <Button size="sm" onClick={exportXlsx} disabled={rows.length === 0}><Download className="h-4 w-4" aria-hidden /> Excel</Button>
              <span className="text-xs text-muted-foreground">{rows.length} reps</span>
            </div>
            <SortTable rows={rows} cols={cols} rowKey={(r, i) => `${r.rep_name}|${r.line_name}|${i}`} initialSort={{ id: 'ach', desc: true }} />
          </>
        )}
      </Loadable>
    </div>
  )
}
