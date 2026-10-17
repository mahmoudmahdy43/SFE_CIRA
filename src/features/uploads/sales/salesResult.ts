/** Tolerant reading of what load_sales_chunk / finalize_sales return (no imports; unit-tested). */
export type Obj = Record<string, unknown>

export interface SalesFinal {
  rows: number | null
  skippedZero: number | null
  rejected: string[]
  mismatch: Obj[]
  rowsWithoutOrg: { count: number; list: Obj[] }
  territoriesWithoutSales: { count: number; list: Obj[] }
  repDiffers: Obj[]
}

const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function listOf(v: unknown): Obj[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (isObj(x) ? x : { name: String(x) }))
}

function countAndList(v: unknown): { count: number; list: Obj[] } {
  const n = num(v)
  if (n !== null && !Array.isArray(v)) return { count: n, list: [] }
  const list = listOf(v)
  return { count: list.length, list }
}

export function rejectedText(x: unknown): string {
  if (typeof x === 'string') return x
  if (isObj(x)) {
    const r = x.reason ?? x.message
    const t = x.territory ?? x.name
    if (typeof r === 'string') return typeof t === 'string' && !r.includes(t) ? `${r}: ${t}` : r
    return Object.values(x).map(String).join(' / ')
  }
  return String(x)
}

/** finalize_sales may answer once or once per month (an array of objects): merge both shapes. */
export function readSalesFinal(raw: unknown): SalesFinal {
  const parts: Obj[] = Array.isArray(raw) ? raw.filter(isObj) : isObj(raw) ? [raw] : []
  const out: SalesFinal = { rows: null, skippedZero: null, rejected: [], mismatch: [], rowsWithoutOrg: { count: 0, list: [] }, territoriesWithoutSales: { count: 0, list: [] }, repDiffers: [] }
  const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b)
  for (const p of parts) {
    out.rows = add(out.rows, num(p.rows ?? p.loaded))
    out.skippedZero = add(out.skippedZero, num(p.skipped_zero))
    if (Array.isArray(p.rejected)) out.rejected.push(...p.rejected.map(rejectedText))
    out.mismatch.push(...listOf(p.total_mismatch))
    const o = countAndList(p.rows_without_org)
    out.rowsWithoutOrg.count += o.count; out.rowsWithoutOrg.list.push(...o.list)
    const t = countAndList(p.territories_without_sales)
    out.territoriesWithoutSales.count += t.count; out.territoriesWithoutSales.list.push(...t.list)
    out.repDiffers.push(...listOf(p.rep_name_differs))
  }
  return out
}

/** Column order for a list of objects: preferred keys first, then the rest in first-seen order. */
export function columnsOf(rows: Obj[], preferred: string[] = []): string[] {
  const seen = new Set<string>()
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) seen.add(k)
  const first = preferred.filter((k) => seen.has(k))
  return [...first, ...[...seen].filter((k) => !first.includes(k))]
}

export const headerOf = (k: string): string => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const NOT_FOUND = /territory not found:\s*(.+)$/i
/** Splits rejection texts into unknown territory names (with counts) and everything else. */
export function splitRejected(texts: string[]): { notFound: { name: string; count: number }[]; other: string[] } {
  const nf = new Map<string, number>()
  const other: string[] = []
  for (const t of texts) {
    const m = NOT_FOUND.exec(t)
    if (m) nf.set(m[1].trim(), (nf.get(m[1].trim()) ?? 0) + 1)
    else other.push(t)
  }
  return { notFound: [...nf].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })), other }
}
