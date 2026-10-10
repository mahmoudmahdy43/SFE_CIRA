import {
  Building2,
  CalendarDays,
  Database,
  LayoutDashboard,
  Palette,
  ScanSearch,
  Settings,
  ShieldCheck,
  Target,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  description: string
  icon: LucideIcon
}
export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Analytics',
    items: [
      { to: '/', label: 'Dashboard', description: 'Company overview and system status.', icon: LayoutDashboard },
      { to: '/360', label: '360° View', description: 'Full profile of a rep, manager or box.', icon: ScanSearch },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/uploads', label: 'Uploads', description: 'Load Excel exports and review upload history.', icon: Upload },
      { to: '/data-quality', label: 'Data Quality', description: 'Unmatched visits, unmapped sales and missing days.', icon: ShieldCheck },
    ],
  },
  {
    label: 'Organisation',
    items: [
      { to: '/personnel', label: 'Personnel', description: 'Hire, resign and transfer reps; assign managers.', icon: Users },
      { to: '/org', label: 'Org & Territories', description: 'Boxes, territories and aliases.', icon: Building2 },
      { to: '/targets', label: 'Targets', description: 'Call-rate targets per box per shift.', icon: Target },
      { to: '/calendar', label: 'Calendar', description: 'Holidays and working days per month.', icon: CalendarDays },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Settings', description: 'Application settings and design preview.', icon: Settings }],
  },
]

export const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export const EXTRA_TITLES: Record<string, string> = { '/design': 'Design preview' }

export const SOON_ICONS = { Database, Palette }

export function titleFor(pathname: string): string {
  return ALL_NAV.find((n) => n.to === pathname)?.label ?? EXTRA_TITLES[pathname] ?? 'SFE Hub'
}
