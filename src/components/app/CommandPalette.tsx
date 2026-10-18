import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Search } from 'lucide-react'
import { KIND_ICON, hitMeta } from '../../features/profile/SearchView'
import { profileHref } from '../../features/profile/profileLinks'
import { useProfileSearch } from '../../features/profile/useProfileSearch'
import { ALL_NAV } from '../../lib/nav'
import { Kbd } from '../ui/misc'
import { Dialog, DialogContent } from '../ui/overlay'

const itemCls =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm aria-selected:bg-muted aria-disabled:cursor-default aria-disabled:opacity-60'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const found = useProfileSearch(query)
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Command palette" description="Search pages and records" className="left-1/2 top-[18%] translate-y-0 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card p-0 animate-pop-in">
        <Command label="Command palette" className="mt-0">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden />
            <Command.Input
              autoFocus
              aria-label="Search pages and records"
              value={query}
              onValueChange={setQuery}
              placeholder="Search pages, reps, managers, staff, boxes…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="max-h-80 overflow-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">No results found.</Command.Empty>
            <Command.Group heading="Pages" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
              {ALL_NAV.map((n) => (
                <Command.Item
                  key={n.to}
                  value={n.label}
                  onSelect={() => {
                    onOpenChange(false)
                    navigate(n.to)
                  }}
                  className={itemCls + ' text-foreground'}
                >
                  <n.icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {n.label}
                </Command.Item>
              ))}
            </Command.Group>
            {found.error && <div role="alert" className="px-2.5 py-2 text-xs text-danger">Search failed: {found.error}</div>}
            {found.groups.map((g) => {
              const Icon = KIND_ICON[g.kind]
              return (
                <Command.Group key={g.kind} forceMount heading={g.label} className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
                  {g.hits.map((h) => (
                    <Command.Item
                      key={`${h.kind}-${h.id}`} forceMount value={`profile ${h.kind} ${h.id} ${h.name}`}
                      onSelect={() => { onOpenChange(false); navigate(profileHref(h.kind, h.id)) }}
                      className={itemCls + ' text-foreground'}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      <span className="flex-1 truncate">{h.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{hitMeta(h)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )
            })}
          </Command.List>
        </Command>
        <DialogPrimitive.Close className="sr-only">Close</DialogPrimitive.Close>
      </DialogContent>
    </Dialog>
  )
}
