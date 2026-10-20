import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from '../../components/app/ChartCard'
import { CHART, ChartTip, axisProps } from '../../components/app/charts'
import { ChipToggle, MultiSelect } from '../../components/app/Controls'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Skeleton } from '../../components/ui/misc'
import { fetchSpecialities, fetchVisitsMonthly } from '../../lib/api/dash'
import { monthShort, type Resolved } from './periodMath'
import { fmtMoney } from './rangeKpi'
import { useAsync } from './useAsync'

type Kind = 'am' | 'pm' | 'pharmacy'
const KINDS: { key: Kind; label: string; color: string }[] = [
  { key: 'am', label: 'AM', color: CHART[0] },
  { key: 'pm', label: 'PM', color: CHART[1] },
  { key: 'pharmacy', label: 'Pharmacy', color: CHART[2] },
]

/** Chart A: visits per month, stacked AM / PM / Pharmacy, company-wide (a double visit counts once). Follows Line + period; Speciality is local to this chart. */
export function VisitsChart({ line, fromYM, toYM, r }: { line: number | null; fromYM: string; toYM: string; r: Resolved }) {
  const [on, setOn] = useState<Record<Kind, boolean>>({ am: true, pm: true, pharmacy: true })
  const [specs, setSpecs] = useState<number[]>([])
  const specOpts = useAsync('opt:specialities', fetchSpecialities)
  // one month selected: show that year's months up to it, for context
  const ctxFrom = r.n === 1 ? `${toYM.slice(0, 4)}-01` : fromYM
  const from = `${ctxFrom}-01`
  const key = `dash:visits:${from}:${r.to}:${line ?? 'all'}:${specs.join(',')}`
  const q = useAsync(key, () => fetchVisitsMonthly(from, r.to, line, specs))

  const active = KINDS.filter((k) => on[k.key])
  const top = active[active.length - 1]?.key
  const data = useMemo(
    () => (q.data ?? []).map((m) => {
      const total = active.reduce((a, k) => a + m[k.key], 0)
      return { ...m, ym: m.month.slice(0, 7), label: monthShort(m.month.slice(0, 7)), shown: total, inRange: m.month.slice(0, 7) >= fromYM && m.month.slice(0, 7) <= toYM }
    }),
    [q.data, active, fromYM, toYM],
  )
  const emptyAll = !q.loading && !q.error && data.every((d) => d.total === 0)

  return (
    <ChartCard
      className="xl:col-span-12"
      title="Visits per month"
      description={r.n === 1 ? 'Company-wide, a double visit counts once. The selected month is highlighted.' : 'Company-wide, a double visit counts once.'}
      actions={<MultiSelect label="Speciality" options={specOpts.data ?? []} value={specs} onChange={setSpecs} allLabel="All" loading={specOpts.loading} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Visit types">
        {KINDS.map((k) => <ChipToggle key={k.key} on={on[k.key]} color={k.color} onChange={(v) => setOn({ ...on, [k.key]: v })}>{k.label}</ChipToggle>)}
        {specs.length > 0 && <span className="text-13 text-muted-foreground">Pharmacy visits have no speciality, so they are not included.</span>}
      </div>
      {q.error ? (
        <ErrorState title="Could not load visits" message={q.error} onRetry={q.reload} className="py-10" />
      ) : q.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : emptyAll || active.length === 0 ? (
        <EmptyState title={active.length === 0 ? 'Turn on at least one visit type' : 'No visits for this period'} description={active.length === 0 ? undefined : 'Upload the visits file or pick another period.'} className="py-10" />
      ) : (
        <div role="img" aria-label="Stacked columns of AM, PM and pharmacy visits per month" className="h-72">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={(v: number) => fmtMoney(v)} />
              <Tooltip content={<ChartTip fmt={fmtMoney} />} cursor={{ fill: 'hsl(var(--muted))' }} />
              {active.map((k) => (
                <Bar key={k.key} dataKey={k.key} name={k.label} stackId="v" fill={k.color} maxBarSize={44} isAnimationActive={false}>
                  {data.map((d) => <Cell key={d.ym} fill={k.color} fillOpacity={r.n === 1 && !d.inRange ? 0.4 : 1} />)}
                  {k.key === top && (
                    <LabelList dataKey="shown" position="top" formatter={(v: number) => fmtMoney(v)} className="tnum" style={{ fontSize: 12, fill: 'hsl(var(--foreground))', fontWeight: 600 }} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  )
}
