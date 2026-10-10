import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { MonthProvider } from './context/MonthContext'
import { missingEnv } from './lib/supabase'
import Layout from './components/Layout'
import { CenterScreen, Spinner } from './components/Screen'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Placeholder from './pages/Placeholder'

function LogoutButton() {
  const { signOut } = useAuth()
  return (
    <button
      onClick={signOut}
      className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-white hover:bg-accent-700"
    >
      Log out
    </button>
  )
}

function Guarded() {
  const { session, role, roleError, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  if (!role) {
    return (
      <CenterScreen>
        <h1 className="text-xl font-bold text-slate-900">No role assigned</h1>
        <p className="mt-2 text-slate-600">Your account has no role yet — contact the admin.</p>
        {roleError && <p className="mt-2 text-sm text-red-600">{roleError}</p>}
        <LogoutButton />
      </CenterScreen>
    )
  }
  if (role !== 'admin') {
    return (
      <CenterScreen>
        <h1 className="text-xl font-bold text-slate-900">Portal coming soon</h1>
        <p className="mt-2 text-slate-600">
          The {role === 'dm' ? 'District Manager' : 'Rep'} portal is not available yet.
        </p>
        <LogoutButton />
      </CenterScreen>
    )
  }
  return (
    <MonthProvider>
      <Layout />
    </MonthProvider>
  )
}

const PAGES = [
  { path: '360', title: '360° View', description: 'Full profile of a rep, manager or box.' },
  { path: 'uploads', title: 'Uploads', description: 'Load Excel exports and review upload history.' },
  { path: 'personnel', title: 'Personnel', description: 'Hire, resign and transfer reps; assign managers.' },
  { path: 'org', title: 'Org & Territories', description: 'Boxes, territories and aliases.' },
  { path: 'targets', title: 'Targets', description: 'Call-rate targets per box per shift.' },
  { path: 'calendar', title: 'Calendar', description: 'Holidays and working days per month.' },
  { path: 'data-quality', title: 'Data Quality', description: 'Unmatched visits, unmapped sales and missing days.' },
  { path: 'settings', title: 'Settings', description: 'Application settings.' },
]

export default function App() {
  if (missingEnv.length > 0) {
    return (
      <CenterScreen>
        <h1 className="text-xl font-bold text-red-700">Missing configuration</h1>
        <p className="mt-2 text-slate-600">
          The app was built without: <code>{missingEnv.join(', ')}</code>. Add them as GitHub
          repository Variables (or in <code>.env.local</code>) and rebuild.
        </p>
      </CenterScreen>
    )
  }
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Guarded />}>
            <Route index element={<Dashboard />} />
            {PAGES.map((p) => (
              <Route
                key={p.path}
                path={p.path}
                element={<Placeholder title={p.title} description={p.description} />}
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </HashRouter>
  )
}
