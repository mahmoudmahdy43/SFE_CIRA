import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlay'
import { cn } from '../../lib/utils'

/** Segmented control: one choice out of a few, 8px radius, selected = white surface with a hairline. */
export function Segmented<T extends string | number>({ value, onChange, options, label, className }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex gap-0.5 rounded-control bg-muted p-0.5', className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cn('h-8 rounded-[6px] px-3 text-13 font-medium text-muted-foreground transition-colors hover:text-foreground', on && 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border))]')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** On / off chip (pill). `color` draws a small swatch so the chip doubles as a legend. */
export function ChipToggle({ on, onChange, children, color }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; color?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-13 transition-colors hover:bg-muted', on ? 'border-primary bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}>
      {color && <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: on ? color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${color}` }} />}
      {children}
    </button>
  )
}

export interface MultiOption { id: number; name: string }

/** Searchable multi-select; the trigger shows "All" or "n selected". Empty selection = no filter. */
export function MultiSelect({ label, options, value, onChange, allLabel = 'All', loading }: {
  label: string
  options: MultiOption[]
  value: number[]
  onChange: (v: number[]) => void
  allLabel?: string
  loading?: boolean
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())), [options, q])
  const set = new Set(value)
  const toggle = (id: number) => onChange(set.has(id) ? value.filter((x) => x !== id) : [...value, id])
  const text = value.length === 0 ? allLabel : value.length === 1 ? (options.find((o) => o.id === value[0])?.name ?? '1 selected') : `${value.length} selected`
  return (
    <Popover onOpenChange={(o) => !o && setQ('')}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${text}`} className="inline-flex h-8 max-w-[14rem] items-center gap-2 rounded-control border bg-card px-3 text-13 hover:bg-muted">
          <span className="text-muted-foreground">{label}</span>
          <span className="truncate font-medium">{loading ? '…' : text}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input aria-label={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <ul role="listbox" aria-multiselectable aria-label={label} className="max-h-64 overflow-auto p-1">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-13 text-muted-foreground">Nothing matches</li>}
          {shown.map((o) => (
            <li key={o.id} role="option" aria-selected={set.has(o.id)}>
              <button type="button" onClick={() => toggle(o.id)} className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', set.has(o.id) && 'border-primary bg-primary text-primary-foreground')}>
                  {set.has(o.id) && <Check className="h-3 w-3" aria-hidden />}
                </span>
                <span className="truncate">{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t px-3 py-2 text-13">
          <span className="text-muted-foreground">{value.length === 0 ? allLabel : `${value.length} selected`}</span>
          <button type="button" disabled={value.length === 0} onClick={() => onChange([])} className="font-medium text-accent-foreground underline-offset-2 hover:underline disabled:opacity-40 disabled:no-underline">Clear</button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
