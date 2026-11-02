import { RELINK_LINES } from './relink.ts'
import type { ProgressInfo } from './types'

interface Step {
  where: string
  phase: string
  month: string
  run: () => Promise<void>
}

export interface Finisher {
  /** Runs the remaining steps; a failed step stays current, so calling it again retries only that step. */
  run: () => Promise<void>
  /** Label of the step that is next to run (the failed one after an error). */
  current: () => string
}

export interface FinishParams {
  batch: number
  total: number
  loaded: number
  rejectedCount: number
  months: string[]
  /** Visits only: relink_strict per line, then process_visits_month, per month (the finisher adds Manager Joint Days at the end). */
  visits?: {
    relink: (month: string, line: number) => Promise<void>
    process: (month: string) => Promise<void>
  }
  onProgress: (p: ProgressInfo) => void
  /** Request function; tests inject a fake (default: the Supabase rpc). */
  rpc?: (name: string, args: Record<string, unknown>) => Promise<unknown>
}

const defaultRpc = async (name: string, args: Record<string, unknown>) => (await import('../../lib/api/core')).rpc(name, args)

/**
 * The end of every upload wizard, one request per step (never the old all-in-one finish_upload):
 * finish_upload_nr (records the batch) -> [visits: relink_strict per line per month -> process_visits_month per month]
 * -> refresh_month per month -> [visits: refresh_joint_days per month].
 */
export function makeFinisher(f: FinishParams): Finisher {
  const rpc = f.rpc ?? defaultRpc
  const months = [...new Set(f.months)].sort()
  const steps: Step[] = [
    {
      where: 'recording the batch',
      phase: 'Recording batch',
      month: '',
      run: async () => {
        await rpc('finish_upload_nr', { p_batch: f.batch, p_total: f.total, p_loaded: f.loaded, p_rejected: f.rejectedCount, p_months: months })
      },
    },
  ]
  const visits = f.visits
  if (visits) {
    for (const m of months) {
      for (const line of RELINK_LINES) {
        steps.push({ where: `linking visits ${m.slice(0, 7)} (CIRA ${line})`, phase: 'Linking visits', month: m, run: () => visits.relink(m, line) })
      }
    }
    for (const m of months) {
      steps.push({ where: `matching visits for ${m.slice(0, 7)}`, phase: 'Matching visits', month: m, run: () => visits.process(m) })
    }
  }
  for (const m of months) {
    steps.push({ where: `refreshing ${m.slice(0, 7)}`, phase: 'Refreshing', month: m, run: () => rpc('refresh_month', { p_month: m }).then(() => undefined) })
  }
  if (visits) {
    for (const m of months) {
      steps.push({ where: `Manager Joint Days ${m.slice(0, 7)}`, phase: 'Manager Joint Days', month: m, run: () => rpc('refresh_joint_days', { p_month: m }).then(() => undefined) })
    }
  }

  let i = 0
  return {
    current: () => steps[Math.min(i, steps.length - 1)].where,
    run: async () => {
      while (i < steps.length) {
        const s = steps[i]
        f.onProgress({ done: i, total: steps.length, month: '', phase: s.phase === 'Recording batch' ? s.phase : `Processing ${s.month.slice(0, 7)} — ${s.phase.toLowerCase()}` })
        await s.run()
        i++
      }
      f.onProgress({ done: steps.length, total: steps.length, month: '', phase: 'Done' })
    },
  }
}
