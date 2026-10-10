export interface TimelineItem {
  id: string | number
  title: string
  range: string
  muted?: boolean
}

export function Timeline({ items, empty }: { items: TimelineItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ol className="space-y-3 border-l pl-4">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card ${i.muted ? 'bg-muted-foreground/40' : 'bg-primary'}`} />
          <div className="text-sm font-medium">{i.title}</div>
          <div className="tnum text-xs text-muted-foreground">{i.range}</div>
        </li>
      ))}
    </ol>
  )
}

export const spanText = (from: string, to: string | null) => `${from} → ${to ?? 'present'}`
