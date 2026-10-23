/**
 * Pharmacy raw files cover all lines together: each row goes to the line its owner belongs to in that visit's month
 * (reps and managers via org_month). Pure functions, unit-tested.
 */
import { normName } from '../../../lib/norm.ts'
import type { PlannedFile, RawVisitsFile } from './rawVisitsParse.ts'

/** month (first of month) -> normalised owner name -> line id. */
export type OwnerLineMap = Map<string, Map<string, number>>

export interface UnresolvedOwner { owner: string; rows: number }

/** An auto pharmacy file is one the user left on "Auto (by owner)". */
export type AutoFile = PlannedFile

const monthOfDay = (d: string) => `${d.slice(0, 7)}-01`

export function lineOfOwner(map: OwnerLineMap, owner: string, visitDate: string): number | null {
  const key = normName(owner)
  return key === null ? null : map.get(monthOfDay(visitDate))?.get(key) ?? null
}

/**
 * Splits every auto pharmacy file into one file per line (rows keep their original row numbers); other files pass through.
 * Owners without a line are not sent: they come back in `unresolved` (owner, rows), most rows first.
 */
export function expandAutoFiles(files: AutoFile[], map: OwnerLineMap | null): { files: PlannedFile[]; unresolved: UnresolvedOwner[] } {
  const out: PlannedFile[] = []
  const lost = new Map<string, number>()
  for (const pf of files) {
    if (!pf.auto) { out.push(pf); continue }
    const f = pf.file
    const byLine = new Map<number, { rows: RawVisitsFile['rows']; nums: number[] }>()
    f.rows.forEach((r, k) => {
      const line = map ? lineOfOwner(map, r.owner, r.visit_date) : null
      if (line === null) { lost.set(r.owner || '(blank)', (lost.get(r.owner || '(blank)') ?? 0) + 1); return }
      const g = byLine.get(line) ?? { rows: [], nums: [] }
      g.rows.push(r)
      g.nums.push(f.rowNumbers[k])
      byLine.set(line, g)
    })
    for (const [line, g] of [...byLine].sort((a, b) => a[0] - b[0])) {
      out.push({ file: summarize({ ...f, rows: g.rows, rowNumbers: g.nums }), line, pharmacy: pf.pharmacy ?? true })
    }
  }
  const unresolved = [...lost].map(([owner, rows]) => ({ owner, rows })).sort((a, b) => b.rows - a.rows || a.owner.localeCompare(b.owner))
  return { files: out, unresolved }
}

/** Recomputes the per-file counters after the rows were split. */
function summarize(f: RawVisitsFile): RawVisitsFile {
  const owners = new Set(f.rows.map((r) => r.owner).filter((o) => o !== ''))
  const double = f.rows.filter((r) => r.visit_type === 'D').length
  return { ...f, single: f.rows.length - double, double, owners: owners.size }
}

export interface LineSummary { line: number; rows: number; single: number; double: number; owners: number; from: string | null; to: string | null }

/** Preview numbers per line: rows, S/D counts, distinct owners, date range. */
export function summarizeByLine(files: PlannedFile[]): LineSummary[] {
  const by = new Map<number, { rows: RawVisitsFile['rows'] }>()
  for (const pf of files) {
    if (pf.line === null) continue
    const g = by.get(pf.line) ?? { rows: [] }
    g.rows.push(...pf.file.rows)
    by.set(pf.line, g)
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([line, g]) => {
    const dates = g.rows.map((r) => r.visit_date).sort()
    const double = g.rows.filter((r) => r.visit_type === 'D').length
    return { line, rows: g.rows.length, single: g.rows.length - double, double, owners: new Set(g.rows.map((r) => r.owner)).size, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null }
  })
}
