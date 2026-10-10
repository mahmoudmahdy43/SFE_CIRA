export type Tone = 'success' | 'warning' | 'danger' | 'neutral'

/** >= 100% of target green, 80-99% amber, < 80% red. */
export function kpiTone(value: number | null | undefined, target: number): Tone {
  if (value == null || !Number.isFinite(value) || target <= 0) return 'neutral'
  const r = value / target
  if (r >= 1) return 'success'
  if (r >= 0.8) return 'warning'
  return 'danger'
}

export const toneText: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-foreground',
}
export const toneBg: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-primary',
}
