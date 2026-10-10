import { ChevronsUpDown, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { Avatar, Badge } from '../ui/misc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/overlay'
import { useAuth } from '../../context/AuthContext'
import { useTheme, type ThemeChoice } from '../../context/ThemeContext'
import { cn } from '../../lib/utils'

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

export function UserMenu({ collapsed }: { collapsed?: boolean }) {
  const { session, role, signOut } = useAuth()
  const { choice, setChoice } = useTheme()
  const email = session?.user.email ?? 'user'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="User menu"
          className={cn('flex w-full items-center gap-2.5 rounded-control p-2 text-left hover:bg-muted', collapsed && 'justify-center')}
        >
          <Avatar text={email} />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{email}</span>
                <span className="block text-xs capitalize text-muted-foreground">{role}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <div className="px-2 py-1.5">
          <div className="truncate text-sm font-medium">{email}</div>
          <Badge tone="accent" className="mt-1 capitalize">
            {role}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">Theme</div>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.value} onSelect={(e) => { e.preventDefault(); setChoice(t.value) }} aria-checked={choice === t.value} role="menuitemradio">
            <t.icon className="h-4 w-4" aria-hidden />
            {t.label}
            {choice === t.value && <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="h-4 w-4" aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
