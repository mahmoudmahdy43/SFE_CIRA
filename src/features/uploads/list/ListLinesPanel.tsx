import { Card } from '../../../components/ui/misc'
import { cn } from '../../../lib/utils'
import type { LineDivisionStat } from './listJoin.ts'

/** Preview: per line, how many rows and how many distinct Divisions (territories) — Line + Division is what finds the Box. */
export default function ListLinesPanel({ stats }: { stats: LineDivisionStat[] }) {
  return (
    <Card className="p-5">
      <h3 className="mb-1 text-sm font-semibold">Rows and Divisions per line</h3>
      <p className="mb-3 text-sm text-muted-foreground">The database finds each Box from Line + Division (the territory name) and takes the rep from whoever covers that Box.</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Line</th><th className="py-1.5 text-right font-medium">Rows</th><th className="py-1.5 text-right font-medium">Distinct Divisions</th><th className="py-1.5 text-right font-medium">Rows with empty Division</th></tr></thead>
        <tbody>
          {stats.map((l) => (
            <tr key={l.line} className="border-b last:border-0">
              <td className="py-1.5">{l.line}</td>
              <td className="tnum py-1.5 text-right">{l.rows.toLocaleString()}</td>
              <td className="tnum py-1.5 text-right">{l.divisions.toLocaleString()}</td>
              <td className={cn('tnum py-1.5 text-right', l.noDivision > 0 && 'font-medium text-warning')}>{l.noDivision.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
