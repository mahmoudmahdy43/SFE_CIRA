import { CalendarRange } from 'lucide-react'
import { Badge } from '../ui/misc'
import { useDateRange } from '../../context/DateRangeContext'
import { monthLabel, monthlyNote, periodLabel } from '../../lib/dateRange'

/**
 * Header line of a report: the period it covers, in words. A range report says so ("Range: 1 Oct - 15 Oct 2026");
 * a monthly-only report carries the "Monthly" badge and, when the active range is not exactly that month, the one-line note.
 */
export function PeriodBanner({ monthly = false, own = false, className }: { monthly?: boolean; /** Monthly report with its own month selector (starts at the month of the To date). */ own?: boolean; className?: string }) {
  const r = useDateRange()
  const note = monthly && !own ? monthlyNote(r) : null
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${className ?? ''}`} role="status">
      <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden />
      {monthly ? (
        <>
          <span className="font-medium">{monthLabel(r.month)}</span>
          <Badge tone="neutral" title="Built from monthly data: it does not follow a day range">Monthly</Badge>
          {own && <span className="text-xs text-muted-foreground">has its own month selector below (starts at the month of the To date)</span>}
          {note && <span className="text-xs text-warning">{note}</span>}
        </>
      ) : (
        <>
          <span className="font-medium tnum">{periodLabel(r.from, r.to)}</span>
          {!r.isFullMonth && <Badge tone="info" title="Computed from the days in the range">Day range</Badge>}
        </>
      )}
    </div>
  )
}
