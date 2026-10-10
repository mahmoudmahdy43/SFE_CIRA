import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Badge, Card, Skeleton } from '../components/ui/misc'
import { PageHeader, ErrorState } from '../components/app/states'
import { StatGrid, KpiCard } from '../components/app/KpiCard'

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  )
}

function CountValue({ r }: { r: Result<number> }) {
  return r.ok ? <span className="tnum">{r.value.toLocaleString()}</span> : <span className="text-danger">Failed: {r.error}</span>
}

export default function Dashboard() {
  const { session, role } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setStatus(null)
    setFailure(null)
    load()
      .then(setStatus)
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : 'Unexpected error'))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div>
      <PageHeader title="Dashboard" description="Company overview — KPIs arrive in a later phase." />

      <StatGrid>
        <KpiCard label="Reps" loading={!status && !failure} value={status?.reps.ok ? status.reps.value.toLocaleString() : undefined} empty={!!status && !status.reps.ok} />
        <KpiCard label="Boxes" loading={!status && !failure} value={status?.boxes.ok ? status.boxes.value.toLocaleString() : undefined} empty={!!status && !status.boxes.ok} />
        <KpiCard label="Territories" loading={!status && !failure} value={status?.territories.ok ? status.territories.value.toLocaleString() : undefined} empty={!!status && !status.territories.ok} />
      </StatGrid>

      <Card className="mt-6 max-w-2xl p-5">
        <h2 className="mb-1 text-sm font-semibold">System status</h2>
        {failure ? (
          <ErrorState message={failure} onRetry={refresh} />
        ) : !status ? (
          <div className="space-y-4 py-3" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : (
          <div>
            <Row label="Supabase connection">
              {status.ping.ok ? (
                <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> OK</Badge>
              ) : (
                <Badge tone="danger"><XCircle className="h-3.5 w-3.5" aria-hidden /> Failed: {status.ping.error}</Badge>
              )}
            </Row>
            <Row label="Logged in as">{session?.user.email ?? '—'}</Row>
            <Row label="Role"><Badge tone="accent" className="capitalize">{role ?? '—'}</Badge></Row>
            <Row label="Reps"><CountValue r={status.reps} /></Row>
            <Row label="Boxes"><CountValue r={status.boxes} /></Row>
            <Row label="Territories"><CountValue r={status.territories} /></Row>
          </div>
        )}
      </Card>
    </div>
  )
}
