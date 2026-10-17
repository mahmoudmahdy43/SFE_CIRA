import { useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CPAL } from './coverageMath'
import { achTone, fmtSignedPct, heatTone, type AchTone, type HeatTone } from './salesMath'

export const AMBER = '#B7791F'
export const AMBER_BODY = '#FDF3E0'
export const TONE_COLOR: Record<AchTone, string> = { red: CPAL.red, amber: AMBER, green: CPAL.green, none: CPAL.grey }
export const HEAT_BG: Record<HeatTone, string> = { red: '#F4B6B6', orange: '#F8CFA0', yellow: '#FBEBA6', green: '#BFE5CB', gray: '#E5E7EB' }
export const STATUS_COLOR = { ACTION: CPAL.red, WATCH: AMBER, OK: CPAL.green } as const

export function Logo() {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex h-12 w-32 shrink-0 items-center justify-start">
      {failed ? (
        <span className="text-2xl font-extrabold tracking-widest" style={{ color: CPAL.navy }}>CIRA</span>
      ) : (
        <img src={`${import.meta.env.BASE_URL}cira-logo.png`} alt="CIRA" className="max-h-12 max-w-full object-contain" onError={() => setFailed(true)} />
      )}
    </div>
  )
}

export function Section({ title, caption, actions, children }: { title: string; caption?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 rounded-sm px-3 py-1.5 text-white" style={{ backgroundColor: CPAL.navy }}>
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
        {actions && <div className="print:hidden">{actions}</div>}
      </div>
      {caption && <p className="text-xs italic" style={{ color: CPAL.grey }}>{caption}</p>}
      {children}
    </section>
  )
}

export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-control border bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={cn('whitespace-nowrap rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors', value === o.id && 'bg-accent font-medium text-accent-foreground')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Growth with an arrow: green up, red down. */
export function Growth({ v }: { v: number | null }) {
  if (v === null) return <span className="text-muted-foreground">-</span>
  const Icon = v === 0 ? Minus : v > 0 ? ArrowUpRight : ArrowDownRight
  const color = v === 0 ? CPAL.grey : v > 0 ? CPAL.green : CPAL.red
  return <span className="tnum inline-flex items-center justify-end gap-0.5 font-bold" style={{ color }}><Icon className="h-4 w-4" aria-hidden />{fmtSignedPct(v)}</span>
}

/** Ach % with a data bar behind the number (red below the threshold, amber up to 100, green from 100). */
export function AchBar({ ach, threshold }: { ach: number | null; threshold: number }) {
  if (ach === null) return <span className="text-muted-foreground">-</span>
  const tone = achTone(ach, threshold)
  const color = TONE_COLOR[tone]
  const w = Math.max(0, Math.min(1.2, ach)) / 1.2
  return (
    <div className="relative h-6 min-w-24 overflow-hidden rounded-sm" style={{ backgroundColor: CPAL.zebra }} title={`${(ach * 100).toFixed(1)}%`}>
      <div className="absolute inset-y-0 left-0" style={{ width: `${w * 100}%`, backgroundColor: color, opacity: 0.28 }} />
      <div className="absolute inset-y-0" style={{ left: `${(1 / 1.2) * 100}%`, width: 1, backgroundColor: CPAL.grey, opacity: 0.5 }} />
      <span className="tnum relative z-[1] flex h-full items-center justify-end px-2 text-sm font-bold" style={{ color }}>{(ach * 100).toFixed(1)}%</span>
    </div>
  )
}

export function StatusChip({ status }: { status: 'ACTION' | 'WATCH' | 'OK' }) {
  const c = STATUS_COLOR[status]
  return <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide" style={{ color: c, backgroundColor: status === 'ACTION' ? CPAL.redBody : status === 'WATCH' ? AMBER_BODY : CPAL.greenBody }}>{status}</span>
}

export function NoTargetTag() {
  return <span className="ml-1.5 rounded-sm border px-1 py-px align-middle text-[10px] font-medium uppercase" style={{ color: CPAL.grey, borderColor: CPAL.rowLine }}>No target</span>
}

export function HeatCell({ ach, tip }: { ach: number | null; tip: string }) {
  const tone = heatTone(ach)
  return (
    <td title={tip} className="tnum h-8 min-w-14 border border-white px-1 text-center text-xs font-semibold" style={{ backgroundColor: HEAT_BG[tone], color: tone === 'gray' ? CPAL.grey : CPAL.navy }}>
      {ach === null ? '' : `${Math.round(ach * 100)}%`}
    </td>
  )
}

export const TH = 'sticky top-0 z-10 h-9 whitespace-nowrap px-3 text-xs font-bold text-white'
export const thStyle = { backgroundColor: CPAL.slate } as const
export const tdBase = { color: CPAL.navy, borderBottomColor: CPAL.rowLine } as const
export const negStyle = (v: number | null) => (v !== null && v < 0 ? { color: CPAL.red } : undefined)
