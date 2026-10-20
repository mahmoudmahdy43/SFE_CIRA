/**
 * Request control for the Dashboard: a small priority queue (at most `max` calls in flight, so the database
 * connection pool is never flooded) and an in-memory result cache keyed by (function, params) with
 * cancellation. Pure (no imports): also run by scripts/dashboardRequests.test.mjs.
 */

export class AbortError extends Error {
  constructor() {
    super('Request cancelled')
    this.name = 'AbortError'
  }
}
export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError'

interface Job { priority: number; seq: number; start: () => void; cancel: () => void }

/** Runs at most `max` jobs at once; waiting jobs start lowest `priority` number first, then first come first served. */
export class Queue {
  private running = 0
  private seq = 0
  private pending: Job[] = []
  /** Highest number of jobs seen in flight at the same time, and how many jobs ever started (for tests and checks). */
  peak = 0
  started = 0

  readonly max: number
  constructor(max: number) {
    this.max = max
  }

  run<T>(priority: number, signal: AbortSignal | undefined, fn: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(new AbortError()); return }
      const job: Job = {
        priority, seq: this.seq++,
        cancel: () => reject(new AbortError()),
        start: () => {
          this.running++
          this.started++
          this.peak = Math.max(this.peak, this.running)
          let p: Promise<T>
          try { p = fn(signal) } catch (e) { p = Promise.reject(e) }
          p.then(resolve, reject).finally(() => { this.running--; this.pump() })
        },
      }
      // a job still waiting in line is dropped the moment its request is cancelled
      signal?.addEventListener('abort', () => {
        const i = this.pending.indexOf(job)
        if (i >= 0) { this.pending.splice(i, 1); job.cancel() }
      }, { once: true })
      this.pending.push(job)
      this.pump()
    })
  }

  private pump(): void {
    while (this.running < this.max && this.pending.length > 0) {
      this.pending.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
      this.pending.shift()?.start()
    }
  }
}

interface Entry { promise: Promise<unknown>; controller: AbortController; refs: number; done: boolean; value?: unknown }
const store = new Map<string, Entry>()

/** The finished result for `key`, if any (lets a screen render at once when it comes back to a cached view). */
export function peek<T>(key: string): { value: T } | null {
  const e = store.get(key)
  return e?.done ? { value: e.value as T } : null
}
export const invalidate = (key: string): void => void store.delete(key)
export const invalidateAll = (): void => store.clear()

/**
 * One queued call per key. Identical requests share it; the result is kept in memory (a failure is never kept).
 * When every caller has cancelled, the call itself is aborted (and dropped from the queue if it never started).
 */
export function request<T>(queue: Queue, key: string, priority: number, fn: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let e = store.get(key)
  if (!e) {
    const controller = new AbortController()
    const entry: Entry = { controller, refs: 0, done: false, promise: Promise.resolve() }
    entry.promise = queue.run(priority, controller.signal, () => fn(controller.signal)).then(
      (v) => { entry.done = true; entry.value = v; return v },
      (err: unknown) => { if (store.get(key) === entry) store.delete(key); throw err },
    )
    entry.promise.catch(() => undefined) // nobody may be listening any more: not an unhandled rejection
    store.set(key, entry)
    e = entry
  }
  const entry = e
  entry.refs++
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const release = () => {
      entry.refs--
      if (entry.refs === 0 && !entry.done) {
        entry.controller.abort()
        if (store.get(key) === entry) store.delete(key)
      }
    }
    if (signal?.aborted) { settled = true; release(); reject(new AbortError()); return }
    signal?.addEventListener('abort', () => {
      if (settled) return
      settled = true
      release()
      reject(new AbortError())
    }, { once: true })
    entry.promise.then(
      (v) => { if (!settled) { settled = true; resolve(v as T) } },
      (err: unknown) => { if (!settled) { settled = true; reject(err) } },
    )
  })
}
