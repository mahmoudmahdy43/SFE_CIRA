/**
 * Plan of a Territory visits upload: which rows of each section go to which line, and the dates each line replaces.
 * A chosen line takes every row; "auto" gives each row the line of its owner / first known member in that month
 * (the way pharmacy files are already split). Pure functions, unit-tested.
 */
import { planRawActivities, type PlannedActivityFile, type RawActivitiesPlan } from '../absence/rawActivitiesParse.ts'
import { planRawOfficeWork, type PlannedOfficeWorkFile, type RawOfficeWorkPlan } from '../absence/rawOfficeWorkParse.ts'
import { expandAutoFiles, lineOfOwner, type OwnerLineMap, type UnresolvedOwner } from './pharmacyLines.ts'
import { planRawUpload, type PlannedFile, type RawPlan } from './rawVisitsParse.ts'
import type { TerritoryReport } from './territoryParse.ts'

export type LineChoice = number | 'auto'
export type SectionId = 'visits' | 'pharmacy' | 'office_work' | 'activities'

export interface Unresolved extends UnresolvedOwner { section: SectionId }

export interface TerritoryPlan {
  /** Clinic + pharmacy visits (one load_visits_raw_chunk upload, two kinds of clear). */
  visits: { files: PlannedFile[]; plan: RawPlan } | null
  officeWork: { files: PlannedOfficeWorkFile[]; plan: RawOfficeWorkPlan } | null
  activities: { files: PlannedActivityFile[]; plan: RawActivitiesPlan } | null
  unresolved: Unresolved[]
}

interface Group<R> { rows: R[]; nums: number[] }

/** Rows grouped by line; rows whose people have no line that month come back in `lost` (by first name). */
function groupByLine<R>(rows: R[], nums: number[], choice: LineChoice, map: OwnerLineMap | null, people: (r: R) => string[], day: (r: R) => string): { byLine: Map<number, Group<R>>; lost: Map<string, number> } {
  const byLine = new Map<number, Group<R>>()
  const lost = new Map<string, number>()
  rows.forEach((r, k) => {
    let line: number | null = choice === 'auto' ? null : choice
    if (choice === 'auto' && map) for (const p of people(r)) { line = lineOfOwner(map, p, day(r)); if (line !== null) break }
    if (line === null) {
      const who = people(r)[0] || '(blank)'
      lost.set(who, (lost.get(who) ?? 0) + 1)
      return
    }
    const g = byLine.get(line) ?? { rows: [], nums: [] }
    g.rows.push(r)
    g.nums.push(nums[k])
    byLine.set(line, g)
  })
  return { byLine, lost }
}

const names = (members: string) => members.split(' | ').map((m) => m.trim()).filter((m) => m !== '')

export function buildTerritoryPlan(reports: TerritoryReport[], choice: LineChoice, map: OwnerLineMap | null): TerritoryPlan {
  const unresolved: Unresolved[] = []
  const lose = (section: SectionId, lost: Map<string, number>) => { for (const [owner, rows] of lost) unresolved.push({ section, owner, rows }) }

  const visitFiles: PlannedFile[] = []
  for (const rep of reports) {
    for (const [file, pharmacy, section] of [[rep.clinic, false, 'visits'], [rep.pharmacy, true, 'pharmacy']] as const) {
      if (!file || file.rows.length === 0) continue
      if (choice === 'auto') {
        const ex = expandAutoFiles([{ file, line: null, pharmacy, auto: true }], map)
        visitFiles.push(...ex.files)
        lose(section, new Map(ex.unresolved.map((u) => [u.owner, u.rows])))
      } else visitFiles.push({ file, line: choice, pharmacy })
    }
  }

  const officeFiles: PlannedOfficeWorkFile[] = []
  const activityFiles: PlannedActivityFile[] = []
  for (const rep of reports) {
    if (rep.officeWork && rep.officeWork.rows.length > 0) {
      const f = rep.officeWork
      const { byLine, lost } = groupByLine(f.rows, f.rowNumbers, choice, map, (r) => names(r.members), (r) => r.day)
      lose('office_work', lost)
      for (const [line, g] of [...byLine].sort((a, b) => a[0] - b[0])) officeFiles.push({ file: { ...f, rows: g.rows, rowNumbers: g.nums }, line })
    }
    if (rep.activities && rep.activities.rows.length > 0) {
      const f = rep.activities
      const { byLine, lost } = groupByLine(f.rows, f.rowNumbers, choice, map, (r) => names(r.members), (r) => r.day)
      lose('activities', lost)
      for (const [line, g] of [...byLine].sort((a, b) => a[0] - b[0])) activityFiles.push({ file: { ...f, rows: g.rows, rowNumbers: g.nums }, line })
    }
  }
  return {
    visits: visitFiles.length > 0 ? { files: visitFiles, plan: planRawUpload(visitFiles) } : null,
    officeWork: officeFiles.length > 0 ? { files: officeFiles, plan: planRawOfficeWork(officeFiles) } : null,
    activities: activityFiles.length > 0 ? { files: activityFiles, plan: planRawActivities(activityFiles) } : null,
    unresolved,
  }
}

/** Months to expect as touched by any section (for the confirmation line). */
export function planMonths(p: TerritoryPlan): string[] {
  return [...new Set([...(p.visits?.plan.months ?? []), ...(p.officeWork?.plan.months ?? []), ...(p.activities?.plan.months ?? [])])].sort()
}
