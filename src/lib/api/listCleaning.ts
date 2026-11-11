import { fetchAll } from './core'
import type { ListRow } from '../../features/listCleaning/cleaningRules'

const COLS = 'month,line,manager,box,rep_code,rep_name,account_type,account_name,account_id,doctor_name,doctor_id,territory,brick,speciality,row_id'
const s = (v: unknown) => (v == null ? '' : String(v))

/** Every Target List row of the month (view v_list_cleaning, supabase/98). The rules are applied in the app. */
export async function fetchListForCleaning(month: string, line: string | null): Promise<ListRow[]> {
  const rows = await fetchAll<Record<string, unknown>>('v_list_cleaning', COLS, ['row_id'], (q) => {
    const f = q.eq('month', month)
    return line ? f.eq('line', line) : f
  })
  return rows.map((r) => ({
    month: s(r.month), line: s(r.line), manager: s(r.manager), box: s(r.box), rep_code: s(r.rep_code), rep_name: s(r.rep_name),
    account_type: s(r.account_type), account_name: s(r.account_name), account_id: s(r.account_id), doctor_name: s(r.doctor_name),
    doctor_id: s(r.doctor_id), territory: s(r.territory), brick: s(r.brick), speciality: s(r.speciality),
  }))
}
