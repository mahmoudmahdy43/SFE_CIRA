import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlay'
import { useDateRange } from '../../context/DateRangeContext'
import { useAsync } from '../../features/dashboard/useAsync'
import { fetchLatestVisitDate } from '../../lib/api/range'
import { MAX_DAY, MIN_DAY, customRange, periodLabel, presets, type Preset } from '../../lib/dateRange'
import { todayIso } from '../../lib/norm'
import { cn } from '../../lib/utils'

const iso = (d: Date) => format(d, 'yyyy-MM-01')

/**
 * The global period picker: a month (default) or a custom From / To range, with quick chips.
 * Kept under its old name because the Top bar and the filter bars already use it.
 */
export function MonthPicker() {
  const r = useDateRange()
  const current = parseISO(r.month)
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(current.getFullYear())
  const [from, setFrom] = useState(r.from)
  const [to, setTo] = useState(r.to)
  const latest = useAsync('visits:latest-date', fetchLatestVisitDate)
  const chips = presets(todayIso(), latest.data ?? null)

  const draft = customRange(from, to)
  const problem = from === '' || to === '' ? 'Pick both dates.' : from > to ? 'From must be on or before To.' : draft ? null : `Dates must be inside 2026.`
  const apply = (f: string, t: string) => { if (r.setCustom(f, t)) setOpen(false) }
  const chip = (p: Preset) => {
    const active = r.from === p.from && r.to === p.to
    return (
      <button
        key={p.id}
        aria-pressed={active}
        onClick={() => { if (p.id === 'this-month' || p.id === 'last-month') { r.setMonth(p.from); setOpen(false) } else apply(p.from, p.to) }}
        className={cn('rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted', active && 'border-primary bg-accent font-medium text-accent-foreground')}
      >
        {p.label}
      </button>
    )
  }

  return (
    <div className="inline-flex items-center rounded-control border bg-card">
      <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => r.stepMonth(-1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (o) { setYear(current.getFullYear()); setFrom(r.from); setTo(r.to) }
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={r.custom && !r.isFullMonth ? `Selected period ${periodLabel(r.from, r.to)}. Change period` : `Selected month ${format(current, 'MMMM yyyy')}. Change month`}
            className="inline-flex h-8 items-center gap-2 px-2 text-sm font-medium hover:bg-muted"
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="tnum min-w-[5.5rem] text-left">{r.custom && !r.isFullMonth ? periodLabel(r.from, r.to) : format(current, 'MMM yyyy')}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3">
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">{chips.map(chip)}</div>
          <div className="mb-2 flex items-center justify-between">
            <Button variant="ghost" size="icon-sm" aria-label="Previous year" onClick={() => setYear((y) => y - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="tnum text-sm font-semibold">{year}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next year" onClick={() => setYear((y) => y + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, m) => {
              const d = new Date(year, m, 1)
              const selected = !r.custom && iso(d) === r.month
              return (
                <button
                  key={m}
                  onClick={() => {
                    r.setMonth(iso(d))
                    setOpen(false)
                  }}
                  aria-pressed={selected}
                  className={cn(
                    'rounded-control py-2 text-sm hover:bg-muted',
                    selected && 'bg-primary font-medium text-primary-foreground hover:bg-primary',
                  )}
                >
                  {format(d, 'MMM')}
                </button>
              )
            })}
          </div>
          <div className="mt-3 border-t pt-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Custom range</div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">From
                <input type="date" aria-label="From date" value={from} min={MIN_DAY} max={MAX_DAY} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-8 w-full rounded-control border bg-card px-2 text-sm text-foreground" />
              </label>
              <label className="text-xs text-muted-foreground">To
                <input type="date" aria-label="To date" value={to} min={MIN_DAY} max={MAX_DAY} onChange={(e) => setTo(e.target.value)} className="mt-1 h-8 w-full rounded-control border bg-card px-2 text-sm text-foreground" />
              </label>
            </div>
            {problem && <p role="alert" className="mt-1.5 text-xs text-danger">{problem}</p>}
            <Button size="sm" className="mt-2 w-full" disabled={problem !== null} onClick={() => apply(from, to)}>Apply range</Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => r.stepMonth(1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

