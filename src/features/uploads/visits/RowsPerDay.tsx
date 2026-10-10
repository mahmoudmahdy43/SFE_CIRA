import { Card } from '../../../components/ui/misc'

/** Small bar chart (plain divs, no chart library): rows per day in the file. */
export function RowsPerDay({ days }: { days: { day: string; rows: number }[] }) {
  if (days.length === 0) return null
  const max = Math.max(...days.map((d) => d.rows))
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold">Rows per day</h3>
      <div role="img" aria-label={`Rows per day, ${days.length} day(s), maximum ${max}`} className="flex h-32 items-end gap-1 overflow-x-auto">
        {days.map((d) => (
          <div key={d.day} className="group flex h-full min-w-[14px] flex-1 flex-col items-center justify-end" title={`${d.day}: ${d.rows.toLocaleString()} rows`}>
            <span className="tnum mb-0.5 hidden text-[10px] text-muted-foreground group-hover:block">{d.rows}</span>
            <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(3, (d.rows / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="tnum mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
    </Card>
  )
}
