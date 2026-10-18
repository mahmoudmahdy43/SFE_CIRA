import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface RowError { excelRow: number; reason: string }

/** What every upload type's worker must return. */
export interface ParsedBase<R> {
  rows: R[]
  /** excelRows[k] = 1-based sheet row of rows[k]. */
  excelRows: number[]
  errors: RowError[]
  totalRows: number
  duplicates: number
  headers: string[]
  missing: string[]
  /** Some rows have no Month of their own: the wizard shows a required Month picker (see UploadTypeConfig.applyMonth). */
  needsMonth?: boolean
  /** The dropped files cannot be used (merge step): shown as the error instead of a preview. */
  fatal?: string
}

/** Reference data the preview needs; each type fills what it uses. */
export interface ReferenceData {
  /** Rep codes (and, for visits, manager codes). */
  repCodes: Set<string>
  lineNames: Set<string>
  /** month (YYYY-MM-01) -> rows currently stored that the file would collide with. */
  existingMonths: Map<string, number>
  /** months that have a Target List loaded. */
  listMonths?: Set<string>
  /** months that have visits loaded. */
  visitMonths?: Set<string>
}

export interface Preview {
  stats: { label: string; value: number | string }[]
  /** Prominent problems shown above everything else (still allow continuing). */
  alerts?: string[]
  warnings: string[]
  /** `range` (e.g. "2026-10-07 → 2026-10-07") is what Replace will clear, when the unit is a date range. */
  months: { month: string; rows: number; range?: string }[]
  unknownReps: { code: string; count: number }[]
  unknownLines: { name: string; count: number }[]
  sample: { columns: string[]; rows: (string | number | null)[][] }
  /** Raw values of the first rows of the Month column, to verify how dates were read. */
  monthSamples?: { excelRow: number; raw: string; type: string; shown: string; parsed: string | null }[]
  /** Type-specific extra content (charts etc.). */
  extra?: ReactNode
  unknownLabel?: string
}

export interface ProgressInfo { done: number; total: number; month: string; phase?: string }

export interface RejectedRow { excelRow: number | undefined; reason: string; context: string }

export interface LoadOutcome {
  batch: number
  total: number
  loaded: number
  rejectedCount: number
  rejected: RejectedRow[]
  months: string[]
  /** Type-specific results (e.g. per-month processing summaries). */
  extra?: unknown
}

export class LoadFailure extends Error {
  /** Set when rows are loaded and only a finishing step failed: re-runs the failed step, then the rest. */
  retry?: () => Promise<LoadOutcome>
  constructor(message: string, public batch: number | null, public where: string, retry?: () => Promise<LoadOutcome>) {
    super(message)
    this.retry = retry
  }
}

export interface LoadParams<R> {
  fileName: string
  rows: R[]
  excelRows: number[]
  replaceMonths: string[]
  skipMonths: string[]
  onProgress: (p: ProgressInfo) => void
  onBatch: (id: number) => void
}

/** Everything a later phase needs to plug a new upload type into the wizard. */
export interface UploadTypeConfig<R extends { month: string }, P extends ParsedBase<R> = ParsedBase<R>> {
  kind: string
  label: string
  description: string
  icon: LucideIcon
  enabled: boolean
  /** Exact headers of the downloadable empty template. */
  templateHeaders: string[]
  templateFile: string
  /** Header names shown in "expected vs found" errors. */
  requiredHeaders: string[]
  createWorker: () => Worker
  /** Text under the drop-zone title when it differs from the default (e.g. which files to drop together). */
  dropHint?: string
  /**
   * Multi-file types: the drop zone accepts several files at once. Each file is parsed by the worker on its own,
   * then this merges them into the one result the rest of the wizard works with. Absent = one file, as before.
   */
  combineFiles?: (files: { name: string; parsed: P }[]) => P
  /**
   * Applied to the parsed result before every preview / load with the Month picked in the wizard (only offered when
   * `needsMonth`). Must not modify its input; it is called again whenever the Month changes.
   */
  applyMonth?: (parsed: P, month: string) => P
  loadReference: (parsed: P) => Promise<ReferenceData>
  buildPreview: (parsed: P, ref: ReferenceData) => Preview
  load: (p: LoadParams<R>) => Promise<LoadOutcome>
  /** Renders the type-specific part of the result screen (list changes, per-month cards...). */
  ResultPanel: ComponentType<{ outcome: LoadOutcome; onViewChanges: (month: string) => void }>
}
