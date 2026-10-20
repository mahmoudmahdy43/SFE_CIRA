import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { titleFor } from '../../lib/nav'
import { Button } from '../ui/button'
import { Kbd } from '../ui/misc'
import { Tooltip } from '../ui/overlay'
import { MonthPicker } from './MonthPicker'
import { cn } from '../../lib/utils'

type Sync = 'checking' | 'ok' | 'error'

function SyncDot() {
  const [state, setState] = useState<Sync>('checking')
  useEffect(() => {
    let cancelled = false
    supabase.rpc('ping').then(({ error }) => {
      if (!cancelled) setState(error ? 'error' : 'ok')
    })
    return () => {
      cancelled = true
    }
  }, [])
  const text = { checking: 'Checking connection…', ok: 'Connected to database', error: 'Database unreachable' }[state]
  return (
    <Tooltip content={text} side="bottom">
      <span role="status" aria-label={text} className="flex h-8 w-8 items-center justify-center">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            state === 'ok' && 'bg-success',
            state === 'error' && 'bg-danger',
            state === 'checking' && 'animate-pulse bg-muted-foreground',
          )}
        />
      </span>
    </Tooltip>
  )
}

export function Topbar({ onOpenPalette, onOpenMenu }: { onOpenPalette: () => void; onOpenMenu: () => void }) {
  const { pathname } = useLocation()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" onClick={onOpenMenu}>
        <Menu className="h-5 w-5" />
      </Button>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="hidden text-muted-foreground sm:inline">SFE Hub</span>
        <span className="hidden text-muted-foreground sm:inline" aria-hidden>/</span>
        <span className="truncate font-medium" aria-current="page">{titleFor(pathname)}</span>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onOpenPalette}
          aria-label="Open command palette"
          className="hidden h-9 w-56 items-center gap-2 rounded-control border bg-card px-3 text-sm text-muted-foreground hover:bg-muted lg:flex"
        >
          <Search className="h-4 w-4" aria-hidden />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open command palette" onClick={onOpenPalette}>
          <Search className="h-4 w-4" />
        </Button>
        {pathname !== '/' && <MonthPicker />}
        <SyncDot />
      </div>
    </header>
  )
}
