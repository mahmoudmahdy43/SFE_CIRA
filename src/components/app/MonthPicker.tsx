import { useState } from 'react'
import { addMonths, format, parseISO } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlay'
import { useMonth } from '../../context/MonthContext'
import { cn } from '../../lib/utils'

const iso = (d: Date) => format(d, 'yyyy-MM-01')

export function MonthPicker() {
  const { month, setMonth } = useMonth()
  const current = parseISO(month)
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(current.getFullYear())

  return (
    <div className="inline-flex items-center rounded-control border bg-card">
      <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(iso(addMonths(current, -1)))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (o) setYear(current.getFullYear())
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={`Selected month ${format(current, 'MMMM yyyy')}. Change month`}
            className="inline-flex h-8 items-center gap-2 px-2 text-sm font-medium hover:bg-muted"
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="tnum min-w-[5.5rem] text-left">{format(current, 'MMM yyyy')}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3">
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
              const selected = iso(d) === month
              return (
                <button
                  key={m}
                  onClick={() => {
                    setMonth(iso(d))
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
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => setMonth(iso(addMonths(current, 1)))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
