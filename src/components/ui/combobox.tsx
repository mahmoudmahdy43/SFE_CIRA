import { useState } from 'react'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from './overlay'
import { cn } from '../../lib/utils'

export interface Option {
  value: string
  label: string
}

/** Searchable select with an "All" option. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  options: Option[]
  value: string | null
  onChange: (v: string | null) => void
  placeholder: string
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          className={cn(
            'inline-flex h-9 min-w-36 items-center justify-between gap-2 rounded-control border bg-card px-3 text-sm hover:bg-muted',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0">
        <Command>
          <Command.Input
            aria-label={`Search ${label}`}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="h-9 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-60 overflow-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results.
            </Command.Empty>
            <Command.Item
              value="All"
              onSelect={() => {
                onChange(null)
                setOpen(false)
              }}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground aria-selected:bg-muted"
            >
              <Check className={cn('h-3.5 w-3.5', value === null ? 'opacity-100' : 'opacity-0')} />
              All
            </Command.Item>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={o.label}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-muted"
              >
                <Check className={cn('h-3.5 w-3.5', o.value === value ? 'opacity-100' : 'opacity-0')} />
                {o.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
