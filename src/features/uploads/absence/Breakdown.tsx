import { Card } from '../../../components/ui/misc'

export interface BreakdownGroup { title: string; items: { label: string; count: number }[] }

/** Compact "counts per category" card used in upload previews. */
export function Breakdown({ groups }: { groups: BreakdownGroup[] }) {
  const shown = groups.filter((g) => g.items.length > 0)
  if (shown.length === 0) return null
  return (
    <Card className="p-5">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((g) => (
          <div key={g.title}>
            <h3 className="mb-2 text-sm font-semibold">{g.title}</h3>
            <ul className="space-y-1 text-sm">
              {g.items.slice(0, 12).map((i) => (
                <li key={i.label} className="flex justify-between gap-3"><span className="truncate text-muted-foreground">{i.label}</span><span className="tnum font-medium">{i.count.toLocaleString()}</span></li>
              ))}
              {g.items.length > 12 && <li className="text-xs text-muted-foreground">… and {g.items.length - 12} more</li>}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}
