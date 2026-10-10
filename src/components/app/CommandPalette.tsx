import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Box, Search, UserRound, Users } from 'lucide-react'
import { ALL_NAV } from '../../lib/nav'
import { Kbd } from '../ui/misc'
import { Dialog, DialogContent } from '../ui/overlay'

const itemCls =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm aria-selected:bg-muted aria-disabled:cursor-default aria-disabled:opacity-60'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
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
              placeholder="Search pages…"
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
            <Command.Group heading="Reps / Managers / Boxes (coming soon)" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5">
              {[
                { l: 'Search reps', i: UserRound },
                { l: 'Search managers', i: Users },
                { l: 'Search boxes', i: Box },
              ].map((x) => (
                <Command.Item key={x.l} value={x.l} disabled className={itemCls + ' text-muted-foreground'}>
                  <x.i className="h-4 w-4" aria-hidden /> {x.l}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
        <DialogPrimitive.Close className="sr-only">Close</DialogPrimitive.Close>
      </DialogContent>
    </Dialog>
  )
}
