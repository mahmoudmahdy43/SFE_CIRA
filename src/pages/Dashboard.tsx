import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/Card'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

interface Status {
  ping: Result<string>
  reps: Result<number>
  boxes: Result<number>
  territories: Result<number>
}

async function count(table: string): Promise<Result<number>> {
  const { count: c, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
  return error ? { ok: false, error: error.message } : { ok: true, value: c ?? 0 }
}

async function load(): Promise<Status> {
  const [pingRes, reps, boxes, territories] = await Promise.all([
    supabase.rpc('ping'),
    count('reps'),
    count('boxes'),
    count('territories'),
  ])
  return {
    ping: pingRes.error
      ? { ok: false, error: pingRes.error.message }
      : { ok: true, value: JSON.stringify(pingRes.data) },
    reps,
    boxes,
    territories,
  }
}

function Row({ label, result }: { label: string; result: Result<string | number> }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
      <span className="text-slate-600">{label}</span>
      {result.ok ? (
        <span className="font-medium text-slate-900">{result.value}</span>
      ) : (
        <span className="text-sm text-red-600">Failed: {result.error}</span>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { session, role } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let cancelled = false
    load().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mb-6 mt-1 text-slate-500">Company overview — KPIs arrive in a later phase.</p>
      <Card title="System status">
        {!status ? (
          <div className="text-slate-400">Checking…</div>
        ) : (
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 py-3">
              <span className="text-slate-600">Supabase connection</span>
              {status.ping.ok ? (
                <span className="rounded-full bg-green-100 px-3 py-0.5 text-sm font-medium text-green-700">
                  OK
                </span>
              ) : (
                <span className="text-sm text-red-600">Failed: {status.ping.error}</span>
              )}
            </div>
            <Row label="Logged in as" result={{ ok: true, value: session?.user.email ?? '—' }} />
            <Row label="Role" result={{ ok: true, value: role ?? '—' }} />
            <Row label="Reps" result={status.reps} />
            <Row label="Boxes" result={status.boxes} />
            <Row label="Territories" result={status.territories} />
          </div>
        )}
      </Card>
    </div>
  )
}
