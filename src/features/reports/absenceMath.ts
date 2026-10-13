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
}

export const toLeaveRow = (r: Record<string, unknown>): LeaveRow => ({
  ...identity(r), vacation_am: num(r.vacation_am), vacation_pm: num(r.vacation_pm), full_days: num(r.full_days), total_days: num(r.total_days),
})

export function toMissingRow(r: Record<string, unknown>): MissingRow {
  const list = Array.isArray(r.missing_dates_list) ? r.missing_dates_list.map(String) : []
  return {
    ...identity(r), missing_am: num(r.missing_am), missing_pm: num(r.missing_pm), missing_total: num(r.missing_total),
    missing_dates: str(r.missing_dates) ?? '', missing_dates_list: list,
  }
}

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
    ...rows.map((r) => ({ ...idCells(r), 'Missing AM': r.missing_am, 'Missing PM': r.missing_pm, Total: r.missing_total, Dates: r.missing_dates })),
    { Line: 'Total', 'Direct Manager': null, 'Medical Rep': null, Code: null, 'Hire Date': null, Box: null, 'Missing AM': total.missing_am, 'Missing PM': total.missing_pm, Total: total.missing_total, Dates: null },
  ]
}
export const exportMissingDetail = (rows: MissingRow[]): ExportRow[] =>
  missingDetail(rows).map((d) => ({ Line: d.line, 'Direct Manager': d.manager, Rep: d.rep, Code: d.code, 'Hire Date': hireDateValue(d.hire), Box: d.box, Date: d.date, Shift: d.shift }))
