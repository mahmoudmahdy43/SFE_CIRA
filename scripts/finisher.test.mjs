// Run: npm run test:finisher
import assert from 'node:assert/strict'
import { makeFinisher } from '../src/features/uploads/finish.ts'
import { sumRelinks } from '../src/features/uploads/relink.ts'

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name) }

function setup({ visits, months = ['2026-10-01'], failOn } = {}) {
  const log = []
  let failed = false
  const rpc = async (name, args) => {
    log.push(`${name}${args.p_line ? ' L' + args.p_line : ''}`)
    if (name === failOn && !failed) { failed = true; throw new Error('canceling statement due to statement timeout') }
    return {}
  }
  const v = visits ? {
    relink: async (m, line) => { await rpc('relink_strict', { p_month: m, p_line: line, p_apply: true }) },
    process: async (m) => { await rpc('process_visits_month', { p_month: m }) },
  } : undefined
  const fin = makeFinisher({ batch: 1, total: 1, loaded: 1, rejectedCount: 0, months, visits: v, onProgress: () => {}, rpc })
  return { log, fin }
}

await t('visits: finish -> relink L1..3 -> process -> refresh -> joint days', async () => {
  const { log, fin } = setup({ visits: true })
  await fin.run()
  assert.deepEqual(log, ['finish_upload_nr', 'relink_strict L1', 'relink_strict L2', 'relink_strict L3', 'process_visits_month', 'refresh_month', 'refresh_joint_days'])
})
await t('visits, two months: each stage runs for every month', async () => {
  const { log, fin } = setup({ visits: true, months: ['2026-11-01', '2026-10-01'] })
  await fin.run()
  assert.equal(log.length, 1 + 6 + 2 + 2 + 2)
  assert.equal(log[log.length - 1], 'refresh_joint_days')
})
await t('non-visits uploads keep exactly finish + refresh', async () => {
  const { log, fin } = setup()
  await fin.run()
  assert.deepEqual(log, ['finish_upload_nr', 'refresh_month'])
})
await t('a failed relink step stays current, shows the real error, and the retry runs only that step', async () => {
  const { log, fin } = setup({ visits: true, failOn: 'relink_strict' })
  // fail on the 2nd relink call: wrap by failing first call of line 1 is enough to check retry semantics
  await assert.rejects(fin.run(), /statement timeout/)
  assert.equal(fin.current(), 'linking visits 2026-10 (CIRA 1)')
  await fin.run()
  assert.deepEqual(log, ['finish_upload_nr', 'relink_strict L1', 'relink_strict L1', 'relink_strict L2', 'relink_strict L3', 'process_visits_month', 'refresh_month', 'refresh_joint_days'])
})
await t('a failed joint-days step is retried alone', async () => {
  const { log, fin } = setup({ visits: true, failOn: 'refresh_joint_days' })
  await assert.rejects(fin.run())
  assert.equal(fin.current(), 'Manager Joint Days 2026-10')
  await fin.run()
  assert.deepEqual(log.slice(-2), ['refresh_joint_days', 'refresh_joint_days'])
})
await t('sumRelinks adds the three lines', () => {
  const r = { would_newly_link: 1, would_relink_to_other_doctor: 2, would_unlink_bad_links: 3, unlinked_stay_unlinked: 4 }
  assert.deepEqual(sumRelinks([r, r, r]), { newlyLinked: 3, relinked: 6, unlinked: 9, stillUnlinked: 12 })
})
console.log(`${n} passed`)
