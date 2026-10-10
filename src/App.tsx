import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Clock, LogOut, ShieldAlert } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { MonthProvider } from './context/MonthContext'
import { missingEnv } from './lib/supabase'
import { ALL_NAV } from './lib/nav'
import Layout from './components/Layout'
import { Button } from './components/ui/button'
import { Skeleton } from './components/ui/misc'
import { EmptyState } from './components/app/states'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Placeholder from './pages/Placeholder'
import Settings from './pages/Settings'
import Org from './pages/Org'
import Personnel from './pages/Personnel'
import Targets from './pages/Targets'
import Calendar from './pages/Calendar'
import Uploads from './pages/Uploads'

const BUILT = new Set(['/', '/settings', '/org', '/personnel', '/targets', '/calendar', '/uploads'])

const Design = lazy(() => import('./pages/Design'))

function FullScreenCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-card border bg-card shadow-sm">{children}</div>
    </main>
  )
}

function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function LogoutButton() {
  const { signOut } = useAuth()
  return (
    <Button onClick={() => void signOut()}>
      <LogOut className="h-4 w-4" aria-hidden /> Log out
    </Button>
  )
}

function Guarded() {
  const { session, role, roleError, loading } = useAuth()
  if (loading)
    return (
      <div className="p-8">
        <PageSkeleton />
      </div>
    )
  if (!session) return <Navigate to="/login" replace />
  if (!role) {
    return (
      <FullScreenCard>
        <EmptyState
          icon={ShieldAlert}
          title="No role assigned"
          description={`Your account has no role yet — contact the admin.${roleError ? ` (${roleError})` : ''}`}
          action={<LogoutButton />}
        />
      </FullScreenCard>
    )
  }
  if (role !== 'admin') {
    return (
      <FullScreenCard>
        <EmptyState
          icon={Clock}
          title="Portal coming soon"
          description={`The ${role === 'dm' ? 'District Manager' : 'Rep'} portal is not available yet.`}
          action={<LogoutButton />}
        />
      </FullScreenCard>
    )
  }
  return (
    <MonthProvider>
      <Layout />
    </MonthProvider>
  )
}

export default function App() {
  if (missingEnv.length > 0) {
    return (
      <FullScreenCard>
        <EmptyState
          icon={ShieldAlert}
          title="Missing configuration"
          description={`The app was built without: ${missingEnv.join(', ')}. Add them as GitHub repository Variables (or in .env.local) and rebuild.`}
        />
      </FullScreenCard>
    )
  }
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Guarded />}>
            <Route index element={<Dashboard />} />
            {ALL_NAV.filter((n) => !BUILT.has(n.to)).map((n) => (
              <Route key={n.to} path={n.to.slice(1)} element={<Placeholder item={n} />} />
            ))}
            <Route path="settings" element={<Settings />} />
            <Route path="org" element={<Org />} />
            <Route path="personnel" element={<Personnel />} />
            <Route path="targets" element={<Targets />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="uploads" element={<Uploads />} />
            <Route
              path="design"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <Design />
                </Suspense>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </HashRouter>
  )
}
