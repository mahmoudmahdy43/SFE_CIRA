/**
 * Leaves and Missing Days rebuilt from the daily slots (rep_day_shift: one row per rep x day x shift, with
 * status leave / office_work / activity / worked / missing) for a range that is not made of whole months.
 * Same units as v_leave_report / v_missing_report: DAYS, where one AM-only or PM-only slot = 0.5 and a full day = 1.
 * Pure: also run by scripts/dateRange.test.mjs.
 */
import type { LeaveRow, MissingRow } from './absenceMath.ts'

export interface SlotRow { rep_id: number; day: string; shift: string; status: string }
export interface RepIdentity {
  rep_id: number
  line_id: number | null
  manager_id: number | null
  line: string | null
  manager: string | null
  rep_code: string | null
  rep_name: string | null
  box: string | null
  hire_date: string | null
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dd = (iso: string) => `${iso.slice(8, 10)} ${MON[Number(iso.slice(5, 7)) - 1]}`

/** Slots of one status, grouped by rep then day: which of AM / PM are set. */
function byRepDay(slots: SlotRow[], status: string): Map<number, Map<string, { am: boolean; pm: boolean }>> {
  const out = new Map<number, Map<string, { am: boolean; pm: boolean }>>()
  for (const s of slots) {
    if (s.status !== status) continue
    let days = out.get(s.rep_id)
    if (!days) out.set(s.rep_id, (days = new Map()))
    const d = days.get(s.day) ?? { am: false, pm: false }
    if (s.shift === 'AM') d.am = true
    else if (s.shift === 'PM') d.pm = true
    days.set(s.day, d)
  }
  return out
}

/** Reps with at least one leave slot: Vacation AM / PM = AM-only / PM-only slots x 0.5, Full Day = days with both slots. */
export function leavesFromSlots(slots: SlotRow[], reps: Map<number, RepIdentity>, month: string): LeaveRow[] {
  const out: LeaveRow[] = []
  for (const [repId, days] of byRepDay(slots, 'leave')) {
    const id = reps.get(repId)
    if (!id) continue
    let am = 0
    let pm = 0
    let full = 0
    for (const d of days.values()) {
      if (d.am && d.pm) full += 1
      else if (d.am) am += 0.5
      else if (d.pm) pm += 0.5
    }
    out.push({ ...id, month, vacation_am: am, vacation_pm: pm, full_days: full, total_days: am + pm + full })
  }
  return out
}

/** Reps with at least one missing slot: Missing AM / PM = slots x 0.5; the date strings follow the monthly view's format. */
export function missingFromSlots(slots: SlotRow[], reps: Map<number, RepIdentity>, month: string): MissingRow[] {
  const out: MissingRow[] = []
  for (const [repId, days] of byRepDay(slots, 'missing')) {
    const id = reps.get(repId)
    if (!id) continue
    const sorted = [...days].sort((a, b) => a[0].localeCompare(b[0]))
    let am = 0
    let pm = 0
    for (const [, d] of sorted) {
      if (d.am) am += 0.5
      if (d.pm) pm += 0.5
    }
    out.push({
      ...id, month, missing_am: am, missing_pm: pm, missing_total: am + pm,
      missing_dates: sorted.map(([day, d]) => `${dd(day)}${d.am && d.pm ? '' : d.am ? ' AM' : ' PM'}`).join(', '),
      missing_dates_list: sorted.map(([day]) => day),
      missing_dates_am: sorted.filter(([, d]) => d.am).map(([day]) => dd(day)).join(', '),
      missing_dates_pm: sorted.filter(([, d]) => d.pm).map(([day]) => dd(day)).join(', '),
    })
  }
  return out
}
