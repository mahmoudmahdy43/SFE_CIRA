import { useMemo } from 'react'
import { Badge, Card } from '../../components/ui/misc'
import { ChartCard } from '../../components/app/ChartCard'
import { useAsync } from '../dashboard/useAsync'
import { fetchAbsenceCost, fetchMatrix, fetchTerritorySummary, type Range } from '../../lib/api/dashV1'
import { biggestGaps, money, num, pct } from './dashMath'
import { ListWarning, Loadable, SortTable } from './ui'

const key = (n: string, r: Range) => `dashv1:${n}:${r.from}:${r.to}:${r.line ?? 'all'}`

export function OpportunitiesTab({ range }: { range: Range }) {
  const terr = useAsync(key('terr', range), () => fetchTerritorySummary(range))
  const cost = useAsync(key('cost', range), () => fetchAbsenceCost(range))
  // same default thresholds as the Reps matrix tab, so the cache is shared
  const matrix = useAsync(`dashv1:matrix:${range.from}:${range.to}:${range.line ?? 'all'}:85:90`, () => fetchMatrix(range, 85, 90))
  const gaps = useMemo(() => biggestGaps(terr.data ?? []), [terr.data])

  const actions = useMemo(() => {
    const out: string[] = []
    const m = matrix.data ?? []
    const nc = m.filter((r) => r.grp === 'NOT_CONVERTING').length
    const iv = m.filter((r) => r.grp === 'INTERVENTION').length
    if (iv) out.push(`${iv} rep${iv > 1 ? 's' : ''} in Intervention (low effort, low sales): agree an effort plan with their managers.`)
    if (nc) out.push(`${nc} rep${nc > 1 ? 's' : ''} are working hard but not converting: review targeting and call quality.`)
    const vacant = (terr.data ?? []).filter((t) => t.vacant_months > 0)
    if (vacant.length) out.push(`${vacant.length} vacant territor${vacant.length > 1 ? 'ies' : 'y'}: fill or cover them.`)
    if (gaps[0]) out.push(`Biggest gap: ${gaps[0].territory_name} holds ${pct(gaps[0].list_share)} of the list but ${pct(gaps[0].sales_share)} of sales.`)
    return out
  }, [matrix.data, terr.data, gaps])

  return (
    <div className="space-y-4">
      <ListWarning from={range.from} to={range.to} />
      <ChartCard title="Biggest gaps" description="Territories with share index below 0.8, by list share minus sales share.">
        <Loadable state={terr} empty={() => gaps.length === 0}>
          {() => (
            <SortTable
              rows={gaps}
              rowKey={(r, i) => `${r.territory_name}|${i}`}
              maxHeight="max-h-none"
              cols={[
                { id: 't', header: 'Territory', cell: (r) => <span>{r.territory_name}{r.vacant_months > 0 && <Badge tone="warning" className="ml-2">Vacant</Badge>}</span> },
                { id: 'l', header: 'List share', align: 'right', cell: (r) => pct(r.list_share) },
                { id: 's', header: 'Sales share', align: 'right', cell: (r) => pct(r.sales_share) },
                { id: 'g', header: 'Gap (points)', align: 'right', cell: (r) => <span className="text-danger">{r.gap.toFixed(1)}</span> },
                { id: 'r', header: 'Rep', cell: (r) => r.rep_name || '–' },
              ]}
            />
          )}
        </Loadable>
      </ChartCard>

      <Loadable state={cost} empty={(d) => d.length === 0}>
        {(rows) => {
          const absence = rows.filter((r) => r.kind === 'absence')
          const vacancy = rows.filter((r) => r.kind === 'vacancy')
          const filled = vacancy.find((r) => r.label.toLowerCase() === 'filled territory-months')
          const vacant = vacancy.find((r) => r.label.toLowerCase() === 'vacant territory-months')
          return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <ChartCard title="Cost of absence" className="lg:col-span-2">
                {absence.length === 0 ? <p className="text-sm text-muted-foreground">No absence in this period.</p> : (
                  <SortTable rows={absence} rowKey={(r) => r.label} maxHeight="max-h-none" cols={[
                    { id: 'c', header: 'Cause', cell: (r) => r.label },
                    { id: 'd', header: 'Days', align: 'right', cell: (r) => num(r.days) },
                    { id: 'v', header: 'Lost visits', align: 'right', cell: (r) => num(r.lost_visits) },
                    { id: 'e', header: 'Est. lost sales', title: 'estimate = lost visits × average sales per visit', align: 'right', cell: (r) => money(r.est_lost_sales) },
                  ]} />
                )}
                <p className="mt-2 text-xs text-muted-foreground">Est. lost sales: estimate = lost visits × average sales per visit.</p>
              </ChartCard>
              <div className="space-y-4">
                <Card className="p-4"><div className="text-xs text-muted-foreground">Filled territories — avg achievement</div><div className="tnum mt-1 text-2xl font-semibold">{pct(filled?.avg_ach ?? null)}</div></Card>
                <Card className="p-4">
                  <div className="text-xs text-muted-foreground">Vacant territories — avg achievement</div>
                  <div className="tnum mt-1 text-2xl font-semibold">{pct(vacant?.avg_ach ?? null)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Sales in vacant territories: {money(vacant?.est_lost_sales ?? null)}{vacant ? ` · ${vacant.territories} territories` : ''}</div>
                </Card>
              </div>
            </div>
          )
        }}
      </Loadable>

      <Card className="p-5">
        <h3 className="mb-2 text-sm font-semibold">Next actions</h3>
        {terr.loading || matrix.loading ? <p className="text-sm text-muted-foreground">Reading the numbers…</p>
          : actions.length === 0 ? <p className="text-sm text-muted-foreground">Nothing stands out for this period.</p>
          : <ul className="list-disc space-y-1 pl-5 text-sm">{actions.map((a) => <li key={a}>{a}</li>)}</ul>}
      </Card>
    </div>
  )
}

