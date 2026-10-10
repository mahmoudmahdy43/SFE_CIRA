/// <reference lib="webworker" />
import * as XLSX from 'xlsx'
import { parseVisitsSheet, type ParsedVisits } from './visitsSheet'

export type WorkerIn = { type: 'load'; buffer: ArrayBuffer } | { type: 'parse'; sheet: string }
export type WorkerOut =
  | { type: 'sheets'; names: string[] }
  | { type: 'progress'; phase: 'reading' | 'rows'; done: number; total: number }
  | { type: 'done'; result: ParsedVisits }
  | { type: 'error'; message: string }

let buffer: ArrayBuffer | null = null
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m)

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  try {
    const m = e.data
    if (m.type === 'load') {
      buffer = m.buffer
      post({ type: 'sheets', names: XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames })
    } else if (m.type === 'parse') {
      if (!buffer) throw new Error('No file loaded.')
      post({ type: 'progress', phase: 'reading', done: 0, total: 0 })
      // Raw values only (cellDates stays false): dates arrive as serial numbers / text, never timezone-shifted.
      const wb = XLSX.read(buffer, { type: 'array', dense: true, cellNF: true, sheets: m.sheet })
      const ws = wb.Sheets[m.sheet]
      buffer = null
      if (!ws) throw new Error(`Sheet "${m.sheet}" was not found.`)
      const result = parseVisitsSheet(ws as never, (done, total) => post({ type: 'progress', phase: 'rows', done, total }))
      post({ type: 'done', result })
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'Could not read the workbook.' })
  }
}
