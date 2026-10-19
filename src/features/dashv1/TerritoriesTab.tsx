import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Badge, Input } from '../../components/ui/misc'
import { Tooltip as UiTooltip } from '../../components/ui/overlay'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART } from '../../components/app/charts'
import { useAsync } from '../dashboard/useAsync'
import { downloadXlsx } from '../../lib/xlsxExport'
import { fetchTerritorySummary, type Range, type TerritoryRow } from '../../lib/api/dashV1'
import { money, num, pct } from './dashMath'
import { AXIS, Loadable, SortTable, signTone, type Col } from './ui'

export function TerritoriesTab({ range }: { range: Range }) {
  const state = useAsync(`dashv1:terr:${range.from}:${range.to}:${range.line ?? 'all'}`, () => fetchTerritorySummary(range))
  const [q, setQ] = useState('')
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (state.data ?? []).filter((r) => !s || `${r.territory_name} ${r.rep_name} ${r.line_name} ${r.box_name}`.toLowerCase().includes(s))
  }, [state.data, q])
  const dots = useMemo(
    () => rows.filter((r) => r.list_share !== null && r.sales_share !== null).map((r) => ({ x: (r.list_share as number) * 100, y: (r.sales_share as number) * 100, name: r.territory_name })),
    [rows],
  )
  const maxV = Math.max(1, ...dots.map((d) => Math.max(d.x, d.y)))

  const cols: Col<TerritoryRow>[] = [
    { id: 'line', header: 'Line', sort: (r) => r.line_name, cell: (r) => r.line_name },
    {
      id: 'terr', header: 'Territory', sort: (r) => r.territory_name,
      cell: (r) => <span>{r.territory_name}{r.vacant_months > 0 && <Badge tone="warning" className="ml-2">Vacant</Badge>}</span>,
    },
    { id: 'rep', header: 'Rep', sort: (r) => r.rep_name, cell: (r) => r.rep_name || '–' },
    { id: 'docs', header: 'Doctors in list', align: 'right', sort: (r) => r.list_doctors, cell: (r) => num(r.list_doctors) },
    { id: 'lshare', header: '% of line list', align: 'right', sort: (r) => r.list_share, cell: (r) => pct(r.list_share) },
    { id: 'cov', header: 'Coverage', align: 'right', sort: (r) => r.coverage, cell: (r) => pct(r.coverage) },
    { id: 'pcf', header: 'PCF', align: 'right', sort: (r) => r.pcf, cell: (r) => pct(r.pcf) },
    { id: 'sales', header: 'Sales', align: 'right', sort: (r) => r.s_value, cell: (r) => money(r.s_value) },
    { id: 'sshare', header: '% of line sales', align: 'right', sort: (r) => r.sales_share, cell: (r) => pct(r.sales_share) },
    {
      id: 'idx', header: 'Share index', align: 'right', sort: (r) => r.share_index, title: '% of sales ÷ % of list',
      cell: (r) => (
        <UiTooltip content="% of sales ÷ % of list">
          <span className={r.share_index === null ? '' : r.share_index >= 1.1 ? 'text-success' : r.share_index < 0.9 ? 'text-danger' : ''}>{r.share_index === null ? '–' : r.share_index.toFixed(2)}</span>
        </UiTooltip>
      ),
    },
    { id: 'spd', header: 'Sales / doctor', align: 'right', sort: (r) => r.sales_per_doctor, cell: (r) => money(r.sales_per_doctor) },
    { id: 'ach', header: 'Achievement', align: 'right', sort: (r) => r.ach, cell: (r) => pct(r.ach) },
    { id: 'growth', header: 'Growth', align: 'right', title: 'Second half vs first half of the period', sort: (r) => r.growth, cell: (r) => <span className={signTone(r.growth)}>{pct(r.growth)}</span> },
  ]

  const exportXlsx = () =>
    void downloadXlsx(`dashboard-v1-territories-${range.from.slice(0, 7)}-${range.to.slice(0, 7)}.xlsx`, 'Territories', rows.map((r) => ({
      Line: r.line_name, Territory: r.territory_name, Box: r.box_name, Rep: r.rep_name, Manager: r.manager_name, 'Vacant months': r.vacant_months,
      'Doctors in list': r.list_doctors, '% of line list': r.list_share === null ? null : +(r.list_share * 100).toFixed(2),
      'Coverage %': r.coverage === null ? null : +(r.coverage * 100).toFixed(1), 'PCF %': r.pcf === null ? null : +(r.pcf * 100).toFixed(1),
      Visits: r.visits, 'Visits / doctor': r.visits_per_doctor, Sales: r.s_value, Target: r.t_value,
      '% of line sales': r.sales_share === null ? null : +(r.sales_share * 100).toFixed(2), 'Share index': r.share_index,
      'Sales / doctor': r.sales_per_doctor, 'Achievement %': r.ach === null ? null : +(r.ach * 100).toFixed(1), 'Growth %': r.growth === null ? null : +(r.growth * 100).toFixed(1),
    })))

  return (
    <div className="space-y-4">
      <ChartCard title="List share vs sales share" description="Each dot is a territory. Above the diagonal = sells more than its share of the list.">
        <Loadable state={state}>
          {() => (
            <div role="img" aria-label="Sales share against list share per territory" className="h-72">
              <ResponsiveContainer>
                <ComposedChart margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" />
                  <XAxis type="number" dataKey="x" name="% of list" domain={[0, Math.ceil(maxV)]} {...AXIS} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis type="number" dataKey="y" name="% of sales" domain={[0, Math.ceil(maxV)]} {...AXIS} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v: number) => `${v.toFixed(2)}%`} labelFormatter={() => ''} />
                  <Line data={[{ x: 0, y: 0 }, { x: Math.ceil(maxV), y: Math.ceil(maxV) }]} dataKey="y" name="Fair share" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" dot={false} isAnimationActive={false} legendType="none" />
                  <Scatter data={dots} name="Territory" fill={CHART[0]} fillOpacity={0.6} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Loadable>
      </ChartCard>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Search territories" placeholder="Search territory, rep, line…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={exportXlsx} disabled={rows.length === 0}><Download className="h-4 w-4" aria-hidden /> Excel</Button>
        <span className="text-xs text-muted-foreground">{rows.length} territories</span>
      </div>
      <Loadable state={state} height="h-72">
        {() => <SortTable rows={rows} cols={cols} rowKey={(r, i) => `${r.line_name}|${r.territory_name}|${i}`} initialSort={{ id: 'sales', desc: true }} maxHeight="max-h-[70vh]" />}
      </Loadable>
    </div>
  )
}
