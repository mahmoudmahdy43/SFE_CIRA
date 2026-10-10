/// <reference lib="webworker" />
import * as XLSX from 'xlsx'
import type { AbsenceKind } from './absenceParse'
import { parseAbsenceSheet, type ParsedAbsence } from './absenceSheet'

export type WorkerIn = { type: 'load'; buffer: ArrayBuffer } | { type: 'parse'; sheet: string }
export type WorkerOut =
  | { type: 'sheets'; names: string[] }
  | { type: 'progress'; phase: 'reading' | 'rows'; done: number; total: number }
  | { type: 'done'; result: ParsedAbsence }
  | { type: 'error'; message: string }

/** Wires a Web Worker that parses one kind of absence workbook. */
export function installAbsenceWorker(kind: AbsenceKind): void {
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
        // Cached values only (cell.v). Formulas are never evaluated; cellDates stays false so dates are raw serials/text.
        const wb = XLSX.read(buffer, { type: 'array', dense: true, cellNF: true, sheets: m.sheet })
        const ws = wb.Sheets[m.sheet]
        buffer = null
        if (!ws) throw new Error(`Sheet "${m.sheet}" was not found.`)
        const result = parseAbsenceSheet(kind, ws as never, (done, total) => post({ type: 'progress', phase: 'rows', done, total }))
        post({ type: 'done', result })
      }
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : 'Could not read the workbook.' })
    }
  }
}
