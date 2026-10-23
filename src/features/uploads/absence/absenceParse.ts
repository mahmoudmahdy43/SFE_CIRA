import type * as XLSX from 'xlsx'
import { addMonthsIso } from '../../../lib/norm'
import type { Cell } from '../list/listParse'

export type AbsenceKind = 'leaves' | 'office_work' | 'activities'

export interface LeaveRow {
  month: string
  code: string
  leave_type: string | null
  shift: string
  start_date: string
  end_date: string
  status: string | null
  notes: string | null
}
export interface OfficeWorkRow {
  month: string
  code: string
  ow_type: string | null
  shift: string
  day: string
  members: string | null
  comments: string | null
}
export interface ActivityRow {
  month: string
  code: string
  act_type: string | null
  shift: string
  day: string
  at_time: string | null
  members: string | null
  comments: string | null
}
export type AbsenceRow = LeaveRow | OfficeWorkRow | ActivityRow

export interface AbsenceColumn { key: string; label: string; required: boolean; aliases?: string[] }

export const ABSENCE_COLUMNS: Record<AbsenceKind, AbsenceColumn[]> = {
  leaves: [
    { key: 'code', label: 'CODE', required: true },
    { key: 'shift', label: 'Shift', required: true },
    { key: 'start_date', label: 'Start Date', required: true },
    { key: 'end_date', label: 'End Date', required: true },
    { key: 'status', label: 'STATUS', required: true },
    { key: 'leave_type', label: 'Type', required: false, aliases: ['Leave Type'] },
    { key: 'notes', label: 'Notes', required: false },
  ],
  office_work: [
    { key: 'code', label: 'CODE', required: true },
    { key: 'shift', label: 'Shift', required: true },
    { key: 'day', label: 'Date', required: true },
    { key: 'ow_type', label: 'Type', required: false },
    { key: 'members', label: 'Members', required: false },
    { key: 'comments', label: 'Comments', required: false },
  ],
  activities: [
    { key: 'code', label: 'CODE', required: true },
    { key: 'shift', label: 'Shift', required: true },
    { key: 'day', label: 'Date', required: true },
    { key: 'act_type', label: 'Type', required: false },
    { key: 'at_time', label: 'Time', required: false },
    { key: 'members', label: 'Members', required: false },
    { key: 'comments', label: 'Comments', required: false },
  ],
}

/** The date a row is replaced / ranged by: start date for leaves, the day otherwise. */
export function rowDate(row: AbsenceRow): string {
  return 'start_date' in row ? row.start_date : row.day
}

/** Every month a row touches: a leave 30 Oct -> 2 Nov touches October and November. */
export function monthsTouched(row: AbsenceRow): string[] {
  if (!('start_date' in row)) return [row.month]
  const out: string[] = []
  const end = `${row.end_date.slice(0, 7)}-01`
  for (let m = `${row.start_date.slice(0, 7)}-01`; m <= end; m = addMonthsIso(m, 1)) out.push(m)
  return out
}

export interface CodeResult { code: string | null; unusable: boolean }

/**
 * CODE is an Excel formula (XLOOKUP to another workbook) in the owner's files. We read the CACHED value
 * (cell.v) and never evaluate formulas. Error cells (#REF!, #N/A), missing cached values and blanks are unusable.
 */
export function codeFromCell(cell: XLSX.CellObject | undefined): CodeResult {
  if (!cell) return { code: null, unusable: true }
  if (cell.t === 'e') return { code: null, unusable: true }
  const v = cell.v
  if (v === undefined || v === null) return { code: null, unusable: true }
  if (typeof v === 'number') return { code: Number.isInteger(v) ? v.toLocaleString('fullwide', { useGrouping: false }) : String(v), unusable: false }
  const s = String(v).trim()
  if (s === '' || s.startsWith('#')) return { code: null, unusable: true }
  return { code: s, unusable: false }
}

/** Shift as the database accepts it (AM / PM / Full / Full Day / All Day, any case). Returned trimmed, as written. */
export function parseAbsenceShift(v: Cell): { value: string; kind: 'AM' | 'PM' | 'FULL' } | null {
  if (v === null) return null
  const s = String(v).trim()
  const u = s.toUpperCase().replace(/\s+/g, ' ')
  if (u === 'AM') return { value: s, kind: 'AM' }
  if (u === 'PM') return { value: s, kind: 'PM' }
  if (u === 'FULL' || u === 'FULL DAY' || u === 'ALL DAY') return { value: s, kind: 'FULL' }
  return null
}

/** Time of day: fraction of a day (0.9458 = 22:41:00) or text "HH:MM[:SS]" -> 'HH:MM:SS'. Blank -> null. */
export function parseTimeOfDay(v: Cell): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return { ok: false }
    const frac = v - Math.floor(v)
    const secs = Math.round(frac * 86400) % 86400
    return { ok: true, value: fmtTime(secs) }
  }
  const s = v.trim()
  if (s === '') return { ok: true, value: null }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?$/.exec(s)
  if (m) {
    let h = Number(m[1])
    const mi = Number(m[2])
    const se = Number(m[3] ?? 0)
    if (m[4]) {
      const pm = m[4].toLowerCase() === 'pm'
      if (h < 1 || h > 12) return { ok: false }
      h = (h % 12) + (pm ? 12 : 0)
    }
    if (h > 23 || mi > 59 || se > 59) return { ok: false }
    return { ok: true, value: fmtTime(h * 3600 + mi * 60 + se) }
  }
  if (/^\d*\.?\d+$/.test(s)) return parseTimeOfDay(Number(s))
  return { ok: false }
}

function fmtTime(secs: number): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(secs / 3600))}:${p(Math.floor((secs % 3600) / 60))}:${p(secs % 60)}`
}
