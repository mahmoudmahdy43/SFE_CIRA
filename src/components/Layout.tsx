import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useMonth } from '../context/MonthContext'

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/360', label: '360° View' },
  { to: '/uploads', label: 'Uploads' },
  { to: '/personnel', label: 'Personnel' },
  { to: '/org', label: 'Org & Territories' },
  { to: '/targets', label: 'Targets' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/data-quality', label: 'Data Quality' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  const { session, signOut } = useAuth()
  const { month, setMonth } = useMonth()

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <div className="mb-6 px-2 text-lg font-bold text-accent-600">SFE Hub</div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-accent-50 text-accent-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Month
            <input
              type="month"
              value={month.slice(0, 7)}
              onChange={(e) => e.target.value && setMonth(`${e.target.value}-01`)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{session?.user.email}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-100"
            >
              Log out
            </button>
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
