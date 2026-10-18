import { ProfileLink } from '../../components/app/ProfileLink'
import { useMemo } from 'react'
import { Skeleton } from '../../components/ui/misc'
import { cn } from '../../lib/utils'
import { CPAL } from './coverageMath'
import { FieldlessNote } from './SalesNotes'
import { AchBar, HEAT_BG, HeatCell, Section, Seg, TH, negStyle, tdBase, thStyle } from './SalesUi'
import { GAP_TABS, fmtNum, fmtSigned, heatMap, type GapGroup, type GapView, type RepProductRow } from './salesMath'

export function GapSection({ tab, onTab, rows, threshold, loading, error }: { tab: GapGroup; onTab: (t: GapGroup) => void; rows: GapView[]; threshold: number; loading: boolean; error: string | null }) {
  const label = GAP_TABS.find((t) => t.id === tab)?.label ?? ''
  const heads = [label, 'Line', 'Manager', 'Sales', 'Target', 'Ach %', 'Gap', 'Vacant months']
  return (
    <Section
      title="Gap analysis"
      caption="Sorted by gap, worst first. Value (EGP). The Vacant row is territories with no rep that month; its sales count in line and company totals."
      actions={<Seg label="Gap analysis by" value={tab} options={GAP_TABS} onChange={onTab} />}
    >
      <div className="max-h-[60vh] overflow-auto rounded-card border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead><tr>{heads.map((h, i) => <th key={h} className={cn(TH, i < 3 ? 'text-left' : 'text-right')} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }, (_, r) => <tr key={r}>{heads.map((h) => <td key={h} className="h-9 border-b px-3"><Skeleton className="h-4" /></td>)}</tr>)
              : rows.map((r, i) => (
                <tr key={`${r.key_id}|${r.key_name}`} style={r.isVacant ? { backgroundColor: CPAL.topBody } : i % 2 === 1 ? { backgroundColor: CPAL.zebra } : undefined}>
                  <td className="h-9 whitespace-nowrap border-b px-3 font-medium" style={tdBase}>{tab === 'rep' ? <ProfileLink type="rep" id={Number(r.key_id) || null}>{r.key_name}</ProfileLink> : tab === 'manager' ? <ProfileLink type="manager" id={Number(r.key_id) || null}>{r.key_name}</ProfileLink> : r.key_name}</td>
                  <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{r.line_names ?? '-'}</td>
                  <td className="whitespace-nowrap border-b px-3 text-muted-foreground" style={{ borderBottomColor: CPAL.rowLine }}>{r.manager_names ?? '-'}</td>
                  <td className="tnum border-b px-3 text-right font-semibold" style={tdBase}>{fmtNum(r.s_value)}</td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{fmtNum(r.t_value)}</td>
                  <td className="w-36 border-b px-3" style={{ borderBottomColor: CPAL.rowLine }}><AchBar ach={r.ach} threshold={threshold} /></td>
                  <td className="tnum border-b px-3 text-right font-bold" style={{ ...tdBase, ...negStyle(r.gap) }}>{fmtSigned(r.gap)}</td>
                  <td className="tnum border-b px-3 text-right" style={tdBase}>{r.vacant_months > 0 ? r.vacant_months : '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {!loading && error && <p className="px-4 py-6 text-center text-sm" style={{ color: CPAL.red }}>{error}</p>}
        {!loading && !error && rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No rows for this selection.</p>}
      </div>
    </Section>
  )
}

const LEGEND: { tone: keyof typeof HEAT_BG; label: string }[] = [
  { tone: 'red', label: '< 60%' }, { tone: 'orange', label: '60-80%' }, { tone: 'yellow', label: '80-100%' }, { tone: 'green', label: '≥ 100%' }, { tone: 'gray', label: 'No target' },
]

export function HeatSection({ rows, lines, line, onLine, loading, error }: { rows: RepProductRow[]; lines: { id: number; name: string }[]; line: number | null; onLine: (l: number) => void; loading: boolean; error: string | null }) {
  const heat = useMemo(() => heatMap(rows), [rows])
  return (
    <Section
      title="Heat map — rep × product"
      caption="Ach % per cell (sales of the product ÷ its target for that rep), one line at a time. Reps worst first."
      actions={
        <select aria-label="Heat map line" value={line ?? ''} onChange={(e) => onLine(Number(e.target.value))} className="h-7 rounded-control border bg-card px-2 text-xs text-foreground">
          {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      }
    >
      <div className="flex flex-wrap gap-3 text-xs" style={{ color: CPAL.grey }}>
        {LEGEND.map((l) => <span key={l.tone} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: HEAT_BG[l.tone] }} />{l.label}</span>)}
      </div>
      {loading ? <Skeleton className="h-72" /> : error ? <p className="rounded-card border bg-card px-4 py-6 text-center text-sm" style={{ color: CPAL.red }}>{error}</p> : heat.reps.length === 0 ? <FieldlessNote text="No rep × product data for this line." /> : (
        <div className="max-h-[70vh] overflow-auto rounded-card border bg-card">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 h-28 min-w-44 px-3 text-left text-xs font-bold text-white" style={thStyle}>Rep</th>
                <th className="sticky top-0 z-20 h-28 px-2 text-center text-xs font-bold text-white" style={thStyle}>Total</th>
                {heat.products.map((p) => (
                  <th key={p.id} className="sticky top-0 z-20 h-28 w-14 min-w-14 p-0 align-bottom text-xs font-bold text-white" style={thStyle}>
                    <span className="mx-auto block max-h-28 overflow-hidden whitespace-nowrap py-2 text-center" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{p.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {heat.reps.map((r) => (
                <tr key={`${r.rep}|${r.manager}`}>
                  <td className="sticky left-0 z-10 h-8 whitespace-nowrap border-b bg-card px-3 font-medium" style={tdBase} title={r.manager ?? ''}>{r.rep}</td>
                  <HeatCell ach={r.ach} tip={`${r.rep}: total`} />
                  {heat.products.map((p) => {
                    const c = r.cells.get(p.id)
                    return <HeatCell key={p.id} ach={c ? c.ach : null} tip={c ? `${r.rep} · ${p.name}\nSales ${fmtNum(c.sales)} · Target ${fmtNum(c.target)}` : `${r.rep} · ${p.name}: no sales`} />
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
