/// <reference lib="webworker" />
import * as XLSX from 'xlsx'
import { parseListSheet, type ParsedList } from './listSheet'

export type WorkerIn =
  | { type: 'load'; buffer: ArrayBuffer }
  | { type: 'parse'; sheet: string }

export type WorkerOut =
  | { type: 'sheets'; names: string[] }
  | { type: 'progress'; phase: 'reading' | 'rows'; done: number; total: number }
  | { type: 'done'; result: ParsedList }
  | { type: 'error'; message: string }

let buffer: ArrayBuffer | null = null
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  try {
    const m = e.data
    if (m.type === 'load') {
      buffer = m.buffer
      const wb = XLSX.read(buffer, { type: 'array', bookSheets: true })
      post({ type: 'sheets', names: wb.SheetNames })
    } else if (m.type === 'parse') {
      if (!buffer) throw new Error('No file loaded.')
      post({ type: 'progress', phase: 'reading', done: 0, total: 0 })
      // dense: array-of-rows worksheet (much lighter for 150k+ rows). cellNF keeps number formats so
      // date-typed Division cells can be detected. Only the chosen sheet is parsed.
      const wb = XLSX.read(buffer, { type: 'array', dense: true, cellNF: true, sheets: m.sheet })
      const ws = wb.Sheets[m.sheet]
      buffer = null
      if (!ws) throw new Error(`Sheet "${m.sheet}" was not found.`)
      const result = parseListSheet(ws as never, (done, total) => post({ type: 'progress', phase: 'rows', done, total }))
      post({ type: 'done', result })
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'Could not read the workbook.' })
  }
}
