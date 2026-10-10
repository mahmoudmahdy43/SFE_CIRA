import { fetchAll } from './core'
import type { AbsenceKind } from '../../features/uploads/absence/absenceParse'

export interface AbsenceMonth {
  month: string
  rows: number
  reps: number
  /** office work / activities only */
  days?: number
  /** leaves only */
  approved?: number
  not_approved?: number
  first_day: string
  last_day: string
}

export const ABSENCE_VIEW: Record<AbsenceKind, { view: string; columns: string; label: string }> = {
  leaves: { view: 'v_leaves_months', columns: 'month,rows,approved,not_approved,reps,first_day,last_day', label: 'Leaves' },
  office_work: { view: 'v_office_work_months', columns: 'month,rows,reps,days,first_day,last_day', label: 'Office Work' },
  activities: { view: 'v_activities_months', columns: 'month,rows,reps,days,first_day,last_day', label: 'Activities' },
}

export const fetchAbsenceMonths = (kind: AbsenceKind) =>
  fetchAll<AbsenceMonth>(ABSENCE_VIEW[kind].view, ABSENCE_VIEW[kind].columns, ['month'])
