import { rpc } from '../../lib/api/core'
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
  /** Visits only: runs process_visits_month for each month before refreshing. */
  processVisits?: (month: string) => Promise<void>
  onProgress: (p: ProgressInfo) => void
}

/**
 * The end of every upload wizard, one request per step (never the old all-in-one finish_upload):
 * finish_upload_nr (records the batch) -> [process_visits_month per month] -> refresh_month per month.
 */
export function makeFinisher(f: FinishParams): Finisher {
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
  const processVisits = f.processVisits
  if (processVisits) {
    for (const m of months) {
      steps.push({ where: `matching visits for ${m.slice(0, 7)}`, phase: 'Matching visits', month: m, run: () => processVisits(m) })
    }
  }
  for (const m of months) {
    steps.push({ where: `refreshing ${m.slice(0, 7)}`, phase: 'Refreshing', month: m, run: () => rpc('refresh_month', { p_month: m }).then(() => undefined) })
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
