import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, initials } from '../../lib/utils'
import { toneBg, type Tone } from '../../lib/kpi'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 w-full', className)} />
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-control border bg-card px-3 text-sm placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border bg-card', className)} {...props} />
}

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground',
      success: 'bg-success-soft text-success',
      warning: 'bg-warning-soft text-warning',
      danger: 'bg-danger-soft text-danger',
      info: 'bg-info-soft text-info',
      accent: 'bg-accent text-accent-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({
  tone,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export type PillKey =
  | 'Active'
  | 'Vacant'
  | 'Resigned'
  | 'Missing'
  | 'Matched'
  | 'Unmatched'
  | 'Approved'
  | 'Pending'

const PILL_TONE: Record<PillKey, VariantProps<typeof badgeVariants>['tone']> = {
  Active: 'success',
  Matched: 'success',
  Approved: 'success',
  Vacant: 'warning',
  Pending: 'warning',
  Resigned: 'neutral',
  Missing: 'danger',
  Unmatched: 'danger',
}

export function StatusPill({ status }: { status: PillKey }) {
  return (
    <Badge tone={PILL_TONE[status]}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </Badge>
  )
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground',
        className,
      )}
    >
      {initials(text)}
    </span>
  )
}

export function Progress({ value, tone = 'neutral', label }: { value: number; tone?: Tone; label: string }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className={cn('h-full rounded-full transition-[width]', toneBg[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Progress bar with a value label (for coverage-like percentages). */
export function Meter({ value, tone = 'neutral', label }: { value: number; tone?: Tone; label: string }) {
  return (
    <div className="flex min-w-[120px] items-center gap-2">
      <Progress value={value} tone={tone} label={label} />
      <span className="tnum w-10 shrink-0 text-right text-xs">{Math.round(value * 100)}%</span>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}
