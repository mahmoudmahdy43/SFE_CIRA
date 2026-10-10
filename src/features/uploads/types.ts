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
}

export interface ReferenceData {
  repCodes: Set<string>
  lineNames: Set<string>
  /** month (YYYY-MM-01) -> rows currently stored. */
  existingMonths: Map<string, number>
}

export interface Preview {
  stats: { label: string; value: number | string }[]
  warnings: string[]
  months: { month: string; rows: number }[]
  unknownReps: { code: string; count: number }[]
  unknownLines: { name: string; count: number }[]
  sample: { columns: string[]; rows: (string | number | null)[][] }
}

export interface ProgressInfo { done: number; total: number; month: string }

export interface RejectedRow { excelRow: number | undefined; reason: string; context: string }

export interface LoadOutcome {
  batch: number
  total: number
  loaded: number
  rejectedCount: number
  rejected: RejectedRow[]
  months: string[]
}

export class LoadFailure extends Error {
  constructor(message: string, public batch: number | null, public where: string) {
    super(message)
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
  buildPreview: (parsed: P, ref: ReferenceData) => Preview
  load: (p: LoadParams<R>) => Promise<LoadOutcome>
}
