import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, Skeleton } from '../ui/misc'
import { Tooltip } from '../ui/overlay'
import { cn } from '../../lib/utils'
import { toneText, type Tone } from '../../lib/kpi'

function Sparkline({ data, tone }: { data: number[]; tone: Tone }) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const w = 96
  const h = 28
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className={cn('shrink-0', toneText[tone === 'neutral' ? 'neutral' : tone])}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export interface KpiCardProps {
  label: string
  /** Pre-formatted value, e.g. "87%". Omit with `empty` for no data. */
  value?: string
  /** Change vs previous month, in percentage points or percent (already formatted number, e.g. 2.4). */
  delta?: number
  deltaSuffix?: string
  tone?: Tone
  spark?: number[]
  loading?: boolean
  empty?: boolean
  hint?: ReactNode
  /** Formula / explanation shown in a tooltip next to the label. */
  tooltip?: string
}

export function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = ' pts',
  tone = 'neutral',
  spark,
  loading,
  empty,
  hint,
  tooltip,
}: KpiCardProps) {
  if (loading) {
    return (
      <Card className="p-4" aria-busy="true">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-8 w-24" />
        <Skeleton className="mt-3 h-3 w-28" />
      </Card>
    )
  }
  const DeltaIcon = delta == null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight
  const deltaTone = delta == null || delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-success' : 'text-danger'
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {tooltip && (
            <Tooltip side="top" content={<span className="block max-w-xs">{tooltip}</span>}>
              <button type="button" aria-label={`How ${label} is calculated`} className="rounded text-muted-foreground hover:text-foreground"><Info className="h-3 w-3" /></button>
            </Tooltip>
          )}
        </span>
        {tone !== 'neutral' && (
          <span aria-hidden className={cn('h-2 w-2 rounded-full', { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone])} />
        )}
      </div>
      {empty || value == null ? (
        <div className="mt-2 text-sm text-muted-foreground">No data for this month</div>
      ) : (
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <div>
            <div className={cn('tnum text-2xl font-semibold tracking-tight', toneText[tone])}>{value}</div>
            <div className={cn('mt-1 flex items-center gap-1 text-xs', deltaTone)}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta == null ? (
                <span className="text-muted-foreground">vs prev. month: n/a</span>
              ) : (
                <span className="tnum">
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(1)}
                  {deltaSuffix}
                  <span className="ml-1 text-muted-foreground">vs prev.</span>
                </span>
              )}
            </div>
          </div>
          {spark && <Sparkline data={spark} tone={tone} />}
        </div>
      )}
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">{children}</div>
}
