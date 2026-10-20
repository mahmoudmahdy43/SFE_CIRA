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
  /** Decimals of the change shown next to the arrow (default 1). */
  deltaDecimals?: number
  tone?: Tone
  spark?: number[]
  loading?: boolean
  empty?: boolean
  hint?: ReactNode
  /** Formula / explanation shown in a tooltip next to the label. */
  tooltip?: string
  /** Text after the change (default "vs prev."). */
  deltaLabel?: string
  /** Text when there is no change to show (default "vs prev. month: n/a"). */
  deltaNa?: string
  /** Thin progress bar under the value, 0-1 (capped at 100%). */
  progress?: number
  /** Shown instead of the value when empty (default "No data for this month"). */
  emptyText?: ReactNode
}

export function KpiCard({
  label,
  value,
  delta,
  deltaSuffix = ' pts',
  deltaDecimals = 1,
  tone = 'neutral',
  spark,
  loading,
  empty,
  hint,
  tooltip,
  deltaLabel = 'vs prev.',
  deltaNa = 'vs prev. month: n/a',
  progress,
  emptyText = 'No data for this month',
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
    <Card className={cn('relative overflow-hidden p-4 pl-5', tone === 'neutral' && 'before:bg-transparent', 'before:absolute before:inset-y-0 before:left-0 before:w-1', tone === 'success' && 'before:bg-success', tone === 'warning' && 'before:bg-warning', tone === 'danger' && 'before:bg-danger')}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {tooltip && (
            <Tooltip side="top" content={<span className="block max-w-xs">{tooltip}</span>}>
              <button type="button" aria-label={`How ${label} is calculated`} className="rounded text-muted-foreground hover:text-foreground"><Info className="h-3 w-3" /></button>
            </Tooltip>
          )}
        </span>
      </div>
      {empty || value == null ? (
        <div className="mt-2 text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="mt-1.5 flex items-end justify-between gap-2">
          <div>
            <div className={cn('tnum text-kpi font-semibold tracking-tight', toneText[tone])}>{value}</div>
            <div className={cn('mt-1 flex items-center gap-1 text-xs', deltaTone)}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta == null ? (
                <span className="text-muted-foreground">{deltaNa}</span>
              ) : (
                <span className="tnum">
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(deltaDecimals)}
                  {deltaSuffix}
                  <span className="ml-1 text-muted-foreground">{deltaLabel}</span>
                </span>
              )}
            </div>
          </div>
          {spark && <Sparkline data={spark} tone={tone} />}
        </div>
      )}
      {progress !== undefined && !empty && (
        <div role="progressbar" aria-label={`${label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(progress, 1) * 100)} className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', tone === 'danger' ? 'bg-danger' : tone === 'warning' ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }} />
        </div>
      )}
      {hint && <div className="mt-2 text-13 text-muted-foreground">{hint}</div>}
    </Card>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">{children}</div>
}
