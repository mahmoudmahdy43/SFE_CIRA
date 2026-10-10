import { fetchAll } from './core'

export interface VisitMonth {
  month: string
  rows: number
  unique_visits: number
  reps: number
  days: number
  first_day: string
  last_day: string
  unmatched: number
  not_in_list: number
}

export interface ProcessResult {
  rows: number
  unique_visits: number
  matched: number
  not_in_list: number
  unmatched: number
  no_territory: number
  rep_rows: number
  manager_rows: number
}

export const fetchVisitMonths = () =>
  fetchAll<VisitMonth>('v_visits_months', 'month,rows,unique_visits,reps,days,first_day,last_day,unmatched,not_in_list', ['month'])
