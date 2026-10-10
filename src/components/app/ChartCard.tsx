import type { ReactNode } from 'react'
import { Card } from '../ui/misc'
import { cn } from '../../lib/utils'

export interface LegendItem {
  label: string
  color: string
}

export function ChartCard({
  title,
  description,
  legend,
  actions,
  children,
  className,
}: {
  title: string
  description?: string
  legend?: LegendItem[]
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
      {legend && (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
