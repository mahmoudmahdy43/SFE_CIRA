import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { BarChart3, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/misc'

export default function Login() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setBusy(false)
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">
            <BarChart3 className="h-4 w-4" aria-hidden />
          </span>
          SFE Hub
        </div>
        <div>
          <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
            Field-force analytics, from the visit to the company view.
          </p>
          <p className="mt-3 max-w-md text-sm opacity-80">
            Coverage, PCF, call rate and sales — one trusted source for the whole sales organisation.
          </p>
        </div>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
        <p className="text-xs opacity-70">Authorised users only.</p>
      </div>

      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-in">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Sign in to your account to continue.</p>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">Email</label>
              <Input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">Password</label>
              <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <div role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
