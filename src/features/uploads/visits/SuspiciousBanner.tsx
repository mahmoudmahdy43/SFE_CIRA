import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { Card } from '../../../components/ui/misc'
import { useAuth } from '../../../context/AuthContext'
import { fetchSuspiciousClusters } from '../../../lib/api/suspicious'
import { MIN_CLINICS, monthLabel, monthRange } from '../../reports/suspiciousMath'

/** After a visits upload: High / Medium suspicious cases of the latest uploaded month (one RPC call), with a link to the report on that month. Admin only. */
export default function SuspiciousBanner({ months }: { months: string[] }) {
  const { role } = useAuth()
  const month = [...months].map((m) => m.slice(0, 7)).sort().pop() ?? null
  const [state, setState] = useState<{ high: number; medium: number } | { error: string } | null>(null)

  useEffect(() => {
    if (role !== 'admin' || !month) return
    let cancelled = false
    const { from, to } = monthRange(month)
    fetchSuspiciousClusters(from, to, MIN_CLINICS)
      .then((rows) => !cancelled && setState({ high: rows.filter((r) => r.severity === 'High').length, medium: rows.filter((r) => r.severity === 'Medium').length }))
      .catch((e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : 'Failed to load' }))
    return () => { cancelled = true }
  }, [role, month])

  if (role !== 'admin' || !month) return null
  return (
    <Card className="flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50 p-4">
      <ShieldAlert className="h-5 w-5 text-amber-800" aria-hidden />
      <div className="text-sm text-amber-950">
        {!state ? 'Checking suspicious cases…' : 'error' in state ? <span role="alert">Could not check suspicious cases: {state.error}</span> : (
          <><b>{state.high}</b> High and <b>{state.medium}</b> Medium suspicious case{state.high + state.medium === 1 ? '' : 's'} in {monthLabel(month)}.</>
        )}
      </div>
      <Link to={`/reports?tab=suspicious&month=${month}`} className="ml-auto rounded-control border border-amber-400 bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted">View suspicious cases for {monthLabel(month)}</Link>
    </Card>
  )
}
