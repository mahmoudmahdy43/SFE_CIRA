import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Segmented } from './Controls'
import { addYM, normalizePeriod, periodLabel, type Period, type PeriodMode } from '../../features/dashboard/periodMath'

const MODES: { value: PeriodMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'semester', label: 'Semester' },
  { value: 'custom', label: 'Custom' },
]
const YEARS = [2025, 2026, 2027]
const sel = 'h-8 rounded-control border bg-card px-2 text-13'

/** Whole-month period control: Month (picker + arrows), Quarter, Semester or Custom (from month → to month). */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const set = (p: Period) => onChange(normalizePeriod(p))
  const year = Number(value.fromYM.slice(0, 4))
  const m = Number(value.fromYM.slice(5, 7))
  const q = Math.floor((m - 1) / 3) + 1
  const h = m <= 6 ? 1 : 2
  const step = (n: number) => set({ ...value, fromYM: addYM(value.fromYM, n), toYM: addYM(value.toYM, n) })

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
      <Segmented label="Period type" value={value.mode} onChange={(mode) => set({ ...value, mode })} options={MODES} />
      {value.mode === 'month' && (
        <div className="inline-flex items-center rounded-control border bg-card">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <input type="month" aria-label="Month" value={value.fromYM} onChange={(e) => e.target.value && set({ mode: 'month', fromYM: e.target.value, toYM: e.target.value })} className="h-8 bg-transparent px-1 text-13 font-medium" />
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
      {value.mode === 'quarter' && (
        <>
          <Segmented label="Quarter" value={q} onChange={(n) => set({ mode: 'quarter', fromYM: `${year}-${String((n - 1) * 3 + 1).padStart(2, '0')}`, toYM: value.toYM })} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `Q${n}` }))} />
          <YearSelect year={year} onChange={(y) => set({ ...value, fromYM: `${y}${value.fromYM.slice(4)}` })} />
        </>
      )}
      {value.mode === 'semester' && (
        <>
          <Segmented label="Semester" value={h} onChange={(n) => set({ mode: 'semester', fromYM: `${year}-${n === 1 ? '01' : '07'}`, toYM: value.toYM })} options={[{ value: 1, label: 'H1' }, { value: 2, label: 'H2' }]} />
          <YearSelect year={year} onChange={(y) => set({ ...value, fromYM: `${y}${value.fromYM.slice(4)}` })} />
        </>
      )}
      {value.mode === 'custom' && (
        <div className="flex items-center gap-2 text-13 text-muted-foreground">
          <input type="month" aria-label="From month" value={value.fromYM} max={value.toYM} onChange={(e) => e.target.value && set({ ...value, fromYM: e.target.value })} className={sel} />
          <span aria-hidden>→</span>
          <input type="month" aria-label="To month" value={value.toYM} min={value.fromYM} onChange={(e) => e.target.value && set({ ...value, toYM: e.target.value })} className={sel} />
        </div>
      )}
      {value.mode !== 'month' && <span className="tnum text-13 text-muted-foreground">{periodLabel(value)} · {value.fromYM} → {value.toYM}</span>}
    </div>
  )
}

function YearSelect({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  return (
    <select aria-label="Year" value={year} onChange={(e) => onChange(Number(e.target.value))} className={sel}>
      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
    </select>
  )
}
