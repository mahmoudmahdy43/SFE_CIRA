/**
 * Pure helpers for the Leaves and Missing Days reports (v_leave_report / v_missing_report, values in DAYS:
 * an AM-only or PM-only slot = 0.5, a full day = 1). Totals are plain sums of the visible rows.
 * No runtime imports: also run by scripts/reportMath.test.mjs.
 */

export const DASH = '—'

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))
const intOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

export interface AbsenceIdentity {
  month: string
  rep_id: number
  line_id: number | null
  manager_id: number | null
  line: string | null
  /** Direct manager (named `manager` so the shared report filters work unchanged). */
  manager: string | null
  rep_code: string | null
  rep_name: string | null
  box: string | null
  hire_date: string | null
}

function identity(r: Record<string, unknown>): AbsenceIdentity {
  return {
    month: String(r.month ?? ''),
    rep_id: num(r.rep_id),
    line_id: intOrNull(r.line_id),
    manager_id: intOrNull(r.manager_id),
    line: str(r.line),
    manager: str(r.direct_manager),
    rep_code: str(r.rep_code),
    rep_name: str(r.rep_name),
    box: str(r.box),
    hire_date: str(r.hire_date),
  }
}

export interface LeaveRow extends AbsenceIdentity { vacation_am: number; vacation_pm: number; full_days: number; total_days: number }
export interface MissingRow extends AbsenceIdentity {
  missing_am: number
  missing_pm: number
  missing_total: number
  missing_dates: string
  missing_dates_list: string[]
  /** Days with the AM slot missing / the PM slot missing, e.g. "03 Sep, 07 Sep". */
  missing_dates_am: string
  missing_dates_pm: string
}

export const toLeaveRow = (r: Record<string, unknown>): LeaveRow => ({
  ...identity(r), vacation_am: num(r.vacation_am), vacation_pm: num(r.vacation_pm), full_days: num(r.full_days), total_days: num(r.total_days),
})

export function toMissingRow(r: Record<string, unknown>): MissingRow {
  const list = Array.isArray(r.missing_dates_list) ? r.missing_dates_list.map(String) : []
  return {
    ...identity(r), missing_am: num(r.missing_am), missing_pm: num(r.missing_pm), missing_total: num(r.missing_total),
    missing_dates: str(r.missing_dates) ?? '', missing_dates_list: list,
    missing_dates_am: str(r.missing_dates_am) ?? '', missing_dates_pm: str(r.missing_dates_pm) ?? '',
  }
}

/* ------------------------------ month range ------------------------------ */
/** From > To -> swapped. Months are 'YYYY-MM-01' strings, which sort as text. */
export const orderRange = (from: string, to: string): { from: string; to: string } => (from <= to ? { from, to } : { from: to, to: from })

/** Rep-month rows -> one row per rep (identity from the latest month, hire date from the latest month that has one). */
function byRep<T extends AbsenceIdentity>(rows: T[]): T[][] {
  const by = new Map<number, T[]>()
  for (const r of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    const l = by.get(r.rep_id)
    if (l) l.push(r)
    else by.set(r.rep_id, [r])
  }
  return [...by.values()]
}
const latestHire = (l: AbsenceIdentity[]): string | null => [...l].reverse().find((r) => r.hire_date)?.hire_date ?? null

export const mergeLeaves = (rows: LeaveRow[]): LeaveRow[] =>
  byRep(rows).map((l) => ({ ...l[l.length - 1], hire_date: latestHire(l), ...totalLeaves(l) }))

/** Sums the days; AM / PM date strings are joined in month order (each date already carries its month). */
export const mergeMissing = (rows: MissingRow[]): MissingRow[] =>
  byRep(rows).map((l) => {
    const join = (k: 'missing_dates' | 'missing_dates_am' | 'missing_dates_pm') => l.map((r) => r[k]).filter(Boolean).join(', ')
    return {
      ...l[l.length - 1], hire_date: latestHire(l), ...totalMissing(l),
      missing_dates: join('missing_dates'), missing_dates_am: join('missing_dates_am'), missing_dates_pm: join('missing_dates_pm'),
      missing_dates_list: l.flatMap((r) => r.missing_dates_list),
    }
  })

/** '2026-09-01' -> '2026-09'; a range -> '2026-09_to_2026-11' (file names) */
export const rangeSlug = (from: string, to: string): string => (from === to ? from.slice(0, 7) : `${from.slice(0, 7)}_to_${to.slice(0, 7)}`)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string): string => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
/** 'Sep 2026' or 'Sep 2026 – Nov 2026' */
export const rangeLabel = (from: string, to: string): string => (from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`)

/* ------------------------------ totals / roll-ups ------------------------------ */
export type LeaveSums = { vacation_am: number; vacation_pm: number; full_days: number; total_days: number }
export type MissingSums = { missing_am: number; missing_pm: number; missing_total: number }
const sumOf = <T,>(rows: T[], k: keyof T): number => rows.reduce((a, r) => a + num(r[k]), 0)

export const totalLeaves = (rows: LeaveRow[]): LeaveSums => ({
  vacation_am: sumOf(rows, 'vacation_am'), vacation_pm: sumOf(rows, 'vacation_pm'), full_days: sumOf(rows, 'full_days'), total_days: sumOf(rows, 'total_days'),
})
export const totalMissing = (rows: MissingRow[]): MissingSums => ({
  missing_am: sumOf(rows, 'missing_am'), missing_pm: sumOf(rows, 'missing_pm'), missing_total: sumOf(rows, 'missing_total'),
})

export interface LeaveGroup extends LeaveSums { key: string; label: string; line: string | null; reps: number }

function groupLeaves(rows: LeaveRow[], keyOf: (r: LeaveRow) => string, labelOf: (r: LeaveRow) => string): LeaveGroup[] {
  const by = new Map<string, LeaveRow[]>()
  for (const r of rows) {
    const k = keyOf(r)
    const l = by.get(k)
    if (l) l.push(r)
    else by.set(k, [r])
  }
  return [...by].map(([key, l]) => ({ key, label: labelOf(l[0]), line: l[0].line, reps: l.length, ...totalLeaves(l) }))
}
export const leavesByManager = (rows: LeaveRow[]) => groupLeaves(rows, (r) => `${r.line_id ?? 'x'}|${r.manager_id ?? 'x'}`, (r) => r.manager ?? 'No manager')
export const leavesByLine = (rows: LeaveRow[]) => groupLeaves(rows, (r) => String(r.line_id ?? 'x'), (r) => r.line ?? 'No line')

/* ------------------------------ formatting ------------------------------ */
/** Up to one decimal (0.5, 1, 1.5); zero is a dash. */
export const fmtDaysUpTo1 = (v: number | null): string => (v === null || v === 0 ? DASH : String(Number(v.toFixed(1))))
/** Always one decimal; zero is a dash. */
export const fmtDays1 = (v: number | null): string => (v === null || v === 0 ? DASH : v.toFixed(1))

/* ------------------------------ ordering ------------------------------ */
const cmpText = (a: string | null, b: string | null): number =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
/** Line, Direct Manager, Rep name. */
export function lineManagerRep<T extends AbsenceIdentity>(rows: T[]): T[] {
  return [...rows].sort((a, b) => cmpText(a.line, b.line) || cmpText(a.manager, b.manager) || cmpText(a.rep_name, b.rep_name))
}

/* ------------------------------ missing-days detail ------------------------------ */
export interface MissingDetail { line: string | null; manager: string | null; rep: string | null; code: string | null; hire: string | null; box: string | null; date: Date; shift: 'AM' | 'PM' | 'Both' }

/** One entry per missing day: the date comes from missing_dates_list, the shift from the AM / PM suffix in missing_dates ("07 Sep AM"). */
export function missingDetail(rows: MissingRow[]): MissingDetail[] {
  const out: MissingDetail[] = []
  for (const r of rows) {
    const dates = r.missing_dates_list.map((s) => {
      const [y, m, d] = s.slice(0, 10).split('-').map(Number)
      return { y, m, d }
    })
    const tokens = r.missing_dates.split(',').map((s) => s.trim()).filter(Boolean)
    const used = new Set<number>()
    for (const tok of tokens) {
      const mt = /^(\d{1,2})\b/.exec(tok)
      if (!mt) continue
      const sfx = /\b(AM|PM)$/i.exec(tok)
      const day = Number(mt[1])
      const shift = sfx ? (sfx[1].toUpperCase() as 'AM' | 'PM') : 'Both'
      const i = dates.findIndex((x, j) => !used.has(j) && x.d === day)
      if (i < 0) continue
      used.add(i)
      out.push({ line: r.line, manager: r.manager, rep: r.rep_name, code: r.rep_code, hire: r.hire_date, box: r.box, date: new Date(dates[i].y, dates[i].m - 1, dates[i].d), shift })
    }
  }
  return out
}

/* ------------------------------ export ------------------------------ */
export type ExportRow = Record<string, string | number | Date | null>
/** 'YYYY-MM-DD' -> a local Date (a real Excel date), null when missing / unparseable. */
export function hireDateValue(iso: string | null): Date | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-08-15' -> '15-Aug-2026'; empty -> a dash. */
export function fmtHire(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : DASH
}
const idCells = (r: AbsenceIdentity): ExportRow => ({ Line: r.line, 'Direct Manager': r.manager, 'Medical Rep': r.rep_name, Code: r.rep_code, 'Hire Date': hireDateValue(r.hire_date), Box: r.box })

export function exportLeaves(rows: LeaveRow[], total: LeaveSums): ExportRow[] {
  return [
    ...rows.map((r) => ({ ...idCells(r), 'Vacation AM': r.vacation_am, 'Vacation PM': r.vacation_pm, 'Full Day': r.full_days, Total: r.total_days })),
    { Line: 'Total', 'Direct Manager': null, 'Medical Rep': null, Code: null, 'Hire Date': null, Box: null, 'Vacation AM': total.vacation_am, 'Vacation PM': total.vacation_pm, 'Full Day': total.full_days, Total: total.total_days },
  ]
}
export function exportLeaveGroups(groups: LeaveGroup[], total: LeaveSums, label: string, reps: number): ExportRow[] {
  const cells = (g: LeaveSums) => ({ 'Vacation AM': g.vacation_am, 'Vacation PM': g.vacation_pm, 'Full Day': g.full_days, Total: g.total_days })
  return [...groups.map((g) => ({ [label]: g.label, Reps: g.reps, ...cells(g) })), { [label]: 'Total', Reps: reps, ...cells(total) }]
}
export function exportMissing(rows: MissingRow[], total: MissingSums): ExportRow[] {
  return [
    ...rows.map((r) => ({ ...idCells(r), 'Missing AM': r.missing_am, 'Missing PM': r.missing_pm, Total: r.missing_total, 'AM Dates': r.missing_dates_am, 'PM Dates': r.missing_dates_pm })),
    { Line: 'Total', 'Direct Manager': null, 'Medical Rep': null, Code: null, 'Hire Date': null, Box: null, 'Missing AM': total.missing_am, 'Missing PM': total.missing_pm, Total: total.missing_total, 'AM Dates': null, 'PM Dates': null },
  ]
}
/** Detail sheet: one row per rep per missing day. Built from the original rep-month rows (a day number alone is ambiguous across months), in the order of the visible reps. */
export function exportMissingDetail(rows: MissingRow[], rawRows: MissingRow[]): ExportRow[] {
  const raw = new Map<number, MissingRow[]>()
  for (const r of [...rawRows].sort((a, b) => a.month.localeCompare(b.month))) raw.set(r.rep_id, [...(raw.get(r.rep_id) ?? []), r])
  return rows.flatMap((r) =>
    missingDetail(raw.get(r.rep_id) ?? []).map((d) => ({ Line: r.line, 'Direct Manager': r.manager, Rep: d.rep, Code: d.code, 'Hire Date': hireDateValue(r.hire_date), Box: d.box, Date: d.date, Shift: d.shift })),
  )
}
