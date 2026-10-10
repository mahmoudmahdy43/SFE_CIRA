import { NavLink } from 'react-router-dom'
import { BarChart3, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV_GROUPS } from '../../lib/nav'
import { Tooltip } from '../ui/overlay'
import { Button } from '../ui/button'
import { UserMenu } from './UserMenu'
import { cn } from '../../lib/utils'

export function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className={cn('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <BarChart3 className="h-4 w-4" aria-hidden />
      </span>
      {!collapsed && <span className="text-[15px] font-semibold tracking-tight">SFE Hub</span>}
    </div>
  )
}

export function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-2">
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="mb-4">
          {!collapsed ? (
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{g.label}</div>
          ) : (
            <div className="mx-3 mb-1 h-px bg-border" aria-hidden />
          )}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const link = (
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'relative flex h-9 items-center gap-2.5 rounded-control px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      collapsed && 'justify-center px-0',
                      isActive && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span aria-hidden className="absolute -left-2 top-2 h-5 w-[3px] rounded-r bg-primary" />}
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed && item.label}
                    </>
                  )}
                </NavLink>
              )
              return (
                <li key={item.to}>
                  {collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-card transition-[width] duration-200 md:flex',
        collapsed ? 'w-[60px]' : 'w-60',
      )}
    >
      <Brand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <div className="space-y-1 border-t p-2">
        <UserMenu collapsed={collapsed} />
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          className={cn('w-full text-muted-foreground', !collapsed && 'justify-start')}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  )
}
