// Run: npm run test:dashboard-requests
import assert from 'node:assert/strict'
import * as q from '../src/lib/api/requests.ts'
import * as k from '../src/features/dashboard/rangeKpi.ts'

let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const job = (log, name, ms = 10) => async () => { log.push(`start ${name}`); await sleep(ms); log.push(`end ${name}`); return name }

await t('never more than 3 in flight, and priority decides the order', async () => {
  const queue = new q.Queue(3)
  const log = []
  const all = [
    queue.run(4, undefined, job(log, 'other1')), queue.run(4, undefined, job(log, 'other2')), queue.run(4, undefined, job(log, 'other3')),
    queue.run(3, undefined, job(log, 'sales')), queue.run(2, undefined, job(log, 'visits')), queue.run(1, undefined, job(log, 'ytd')), queue.run(0, undefined, job(log, 'kpi')),
  ]
  await Promise.all(all)
  assert.equal(queue.peak, 3)
  assert.equal(queue.started, 7)
  const order = log.filter((l) => l.startsWith('start')).map((l) => l.slice(6))
  assert.deepEqual(order.slice(3), ['kpi', 'ytd', 'visits', 'sales'])
})

await t('a waiting job is dropped when cancelled, a running one is left to finish', async () => {
  const queue = new q.Queue(1)
  const log = []
  const ctl = new AbortController()
  const first = queue.run(0, undefined, job(log, 'first', 20))
  const second = queue.run(0, ctl.signal, job(log, 'second'))
  ctl.abort()
  await assert.rejects(second, (e) => q.isAbort(e))
  await first
  assert.deepEqual(log, ['start first', 'end first'])
  await assert.rejects(queue.run(0, ctl.signal, job(log, 'late')), (e) => q.isAbort(e))
})

await t('results are cached by key: same key = one call; a failure is not cached and retry repeats only that call', async () => {
  q.invalidateAll()
  const queue = new q.Queue(3)
  let calls = 0
  const ok = () => { calls++; return Promise.resolve(7) }
  assert.equal(await q.request(queue, 'a', 0, ok), 7)
  assert.equal(await q.request(queue, 'a', 0, ok), 7)
  assert.equal(calls, 1)
  assert.deepEqual(q.peek('a'), { value: 7 })
  let bad = 0
  await assert.rejects(q.request(queue, 'b', 0, () => { bad++; return Promise.reject(new Error('boom')) }), /boom/)
  assert.equal(q.peek('b'), null)
  assert.equal(await q.request(queue, 'b', 0, () => { bad++; return Promise.resolve(1) }), 1)
  assert.equal(bad, 2); assert.equal(calls, 1) // 'a' was not repeated
})

await t('when every caller cancels, the call itself is aborted and forgotten', async () => {
  q.invalidateAll()
  const queue = new q.Queue(3)
  let sawAbort = false
  const slow = (signal) => new Promise((_, rej) => { signal.addEventListener('abort', () => { sawAbort = true; rej(new q.AbortError()) }) })
  const c1 = new AbortController()
  const c2 = new AbortController()
  const p1 = q.request(queue, 'slow', 0, slow, c1.signal)
  const p2 = q.request(queue, 'slow', 0, slow, c2.signal)
  c1.abort()
  await assert.rejects(p1, (e) => q.isAbort(e))
  assert.equal(sawAbort, false) // another caller still wants it
  c2.abort()
  await assert.rejects(p2, (e) => q.isAbort(e))
  await sleep(5)
  assert.equal(sawAbort, true)
  assert.equal(q.peek('slow'), null)
})

await t('company = sum of the lines, a line filter = that line', () => {
  const m = (month, line_id, v) => ({ month, line_id, reps: 1, list_doctors: 10 * v, covered_doctors: 5 * v, total_visits: 20 * v, valid_visits: 10 * v, planned_visits: 0, direct_visits: 0, visits_am: 0, visits_pm: 20 * v, pharmacy_visits: 0,
    days_am: 0, days_pm: 10, missing_am: 0, missing_pm: 0, leave_days: 0, ow_days: 0, activity_days: 0, expected_visits: 25 * v })
  const rows = [m('2026-07-01', 1, 1), m('2026-07-01', 2, 3), m('2026-08-01', 1, 2)]
  const c = k.companyMonths(rows)
  assert.equal(c.length, 2); assert.equal(c[0].list_doctors, 40); assert.equal(c[0].reps, 2)
  assert.deepEqual(k.lineMonths(rows, 1).map((r) => r.month), ['2026-07-01', '2026-08-01'])
  assert.equal(k.aggregate(c).coverage, 0.5)
})

console.log(`\n${n} tests passed`)
