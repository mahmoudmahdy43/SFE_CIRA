import { KpiCard } from '../../components/app/KpiCard'
import { useAuth } from '../../context/AuthContext'
import { fetchCoachingTrend } from '../../lib/api/coaching'
import { fmtScore, monthName } from '../reports/coachingMath'
import { PRIORITY, useDash } from './useDash'

const TIP = 'Average coaching score (1-5) of all coaching visits in the latest month with coaching data up to the end of the selected period. The change is against the previous month with data.'

function Inner({ upTo }: { upTo?: string }) {
  const q = useDash('coaching:dashboard', PRIORITY.other, () => fetchCoachingTrend('2000-01-01', '2100-01-01'))
  const rows = q.data ?? []
  const scored = rows.filter((r) => r.avg_score !== null && (!upTo || r.month.slice(0, 7) <= upTo.slice(0, 7)))
  const cur = scored[scored.length - 1]
  if (!cur || q.error) return null // no data (or not allowed): the card stays hidden
  const prev = scored.length > 1 ? scored[scored.length - 2] : null
  const delta = prev ? (cur.avg_score as number) - (prev.avg_score as number) : undefined
  return (
    <KpiCard
      label="Company Skills"
      tooltip={TIP}
      value={`${fmtScore(cur.avg_score)} / 5`}
      delta={delta}
      deltaSuffix=""
      deltaDecimals={2}
      spark={scored.slice(-6).map((r) => r.avg_score as number)}
      hint={`${monthName(cur.month)} · ${cur.visits.toLocaleString()} coaching visits`}
    />
  )
}

/** Dashboard KPI card (admin only; hidden when there is no coaching data). */
export function CompanySkillsCard({ upTo }: { upTo?: string } = {}) {
  const { role } = useAuth()
  return role === 'admin' ? <Inner upTo={upTo} /> : null
}
