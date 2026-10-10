/** Thin promise wrapper around a parse worker (protocol: load -> sheets, parse -> progress* -> done). */
export interface ParseSession<P> {
  sheets: string[]
  parse: (sheet: string, onProgress: (done: number, total: number, phase: string) => void) => Promise<P>
  terminate: () => void
}

interface Msg {
  type: 'sheets' | 'progress' | 'done' | 'error'
  names?: string[]
  phase?: string
  done?: number
  total?: number
  result?: unknown
  message?: string
}

export function openParseSession<P>(worker: Worker, buffer: ArrayBuffer): Promise<ParseSession<P>> {
  return new Promise((resolve, reject) => {
    let progress: ((d: number, t: number, p: string) => void) | null = null
    let finish: { ok: (r: P) => void; err: (e: Error) => void } | null = null
    worker.onerror = (e) => {
      const err = new Error(e.message || 'The file parser crashed.')
      if (finish) finish.err(err)
      else reject(err)
    }
    worker.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data
      if (m.type === 'sheets') {
        resolve({
          sheets: m.names ?? [],
          parse: (sheet, onProgress) =>
            new Promise<P>((ok, err) => {
              progress = onProgress
              finish = { ok, err }
              worker.postMessage({ type: 'parse', sheet })
            }),
          terminate: () => worker.terminate(),
        })
      } else if (m.type === 'progress') progress?.(m.done ?? 0, m.total ?? 0, m.phase ?? '')
      else if (m.type === 'done') finish?.ok(m.result as P)
      else if (m.type === 'error') {
        const err = new Error(m.message ?? 'Could not read the file.')
        if (finish) finish.err(err)
        else reject(err)
      }
    }
    worker.postMessage({ type: 'load', buffer }, [buffer])
  })
}
