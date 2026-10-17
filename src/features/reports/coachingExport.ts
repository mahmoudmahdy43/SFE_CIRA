import { CPAL, gridBands, gridHead, gridStyle, type Grid, type GridCell } from './coverageMath'
import {
  COACH_SUBTITLE, COACH_TITLE, NO_EVAL, monthShort, type RepMonth, type RepSummary, type SkillRow,
} from './coachingMath'

/** Sheet 1: one row per rep (screen order) + one column per month ("No evaluation" where there is none) + visit-weighted total. */
export function buildRepsGrid(a: { reps: RepSummary[]; total: RepSummary; months: string[]; byRep: Map<string, RepMonth[]>; periodLine: string }): Grid {
  const heads = ['Rep', 'Rep code', 'Line', 'Manager', 'Coaching visits', 'Months evaluated', 'First', 'Last', 'Change', 'Training avg', 'Manager avg', 'Gap', 'Conflict', ...a.months.map(monthShort)]
  const n = heads.length
  const b = gridBands(n, a.periodLine, null, COACH_TITLE, COACH_SUBTITLE)
  b.cells.push(heads.map((h) => gridHead(h))); b.heights.push(34)
  const score = (v: number | null, st: Record<string, unknown>): GridCell => (v === null ? { v: '-', s: st } : { v, s: st, z: '0.00' })
  const signed = (v: number | null, st: Record<string, unknown>): GridCell => (v === null ? { v: '-', s: st } : { v, s: st, z: '+0.00;-0.00;0.00' })
  const row = (r: RepSummary, st: { tx: Record<string, unknown>; nm: Record<string, unknown>; muted: Record<string, unknown> }, isTotal: boolean): GridCell[] => {
    const none = r.visits === 0 && !isTotal
    const byM = new Map((a.byRep.get(r.rep_key) ?? []).map((m) => [m.month, m]))
    return [
      { v: r.rep_name, s: st.tx }, { v: r.rep_code ?? '', s: st.tx }, { v: r.line ?? '', s: st.tx }, { v: r.manager ?? '', s: st.tx },
      { v: r.visits, s: st.nm },
      none ? { v: NO_EVAL, s: st.muted } : { v: isTotal ? null : r.months_with_eval, s: st.nm },
      score(none ? null : r.first_score, st.nm), score(none ? null : r.last_score, st.nm), signed(none ? null : r.change, st.nm),
      score(none ? null : r.training_avg, st.nm), score(none ? null : r.manager_avg, st.nm), signed(none ? null : r.gap, st.nm),
      { v: isTotal ? null : none ? '' : r.conflict ? 'Conflict' : '', s: st.nm },
      ...a.months.map((m): GridCell => {
        if (isTotal) return { v: null, s: st.nm }
        const x = byM.get(m)
        return x && x.avg_score !== null ? { v: x.avg_score, s: st.nm, z: '0.00' } : { v: NO_EVAL, s: st.muted }
      }),
    ]
  }
  a.reps.forEach((r, i) => {
    const bg = i % 2 === 1 ? CPAL.zebra : null
    b.cells.push(row(r, {
      tx: gridStyle(bg, CPAL.navy, { h: 'left', border: true }), nm: gridStyle(bg, CPAL.navy, { bold: true, border: true }), muted: gridStyle(bg, CPAL.grey, { italic: true, border: true }),
    }, false))
    b.heights.push(20)
  })
  const tot = gridStyle(CPAL.navy, CPAL.white, { bold: true })
  b.cells.push(row(a.total, { tx: { ...tot, alignment: { horizontal: 'left', vertical: 'center' } }, nm: tot, muted: tot }, true))
  b.heights.push(24)
  return { name: 'Reps', cells: b.cells, merges: b.merges, heights: b.heights, widths: [26, 12, 14, 24, 11, 11, 9, 9, 9, 12, 12, 9, 11, ...a.months.map(() => 13)] }
}

/** Sheet 2: the skills matrix (scope x skill) with the company average of the same skill next to it. */
export function buildSkillsGrid(a: { rows: SkillRow[]; periodLine: string }): Grid {
  const heads = ['Scope', 'Name', 'Skill code', 'Skill', 'Avg score', 'Evaluations (n)', 'Company avg']
  const n = heads.length
  const b = gridBands(n, a.periodLine, null, COACH_TITLE, COACH_SUBTITLE)
  b.cells.push(heads.map((h) => gridHead(h))); b.heights.push(34)
  const company = new Map(a.rows.filter((r) => r.scope_type === 'COMPANY').map((r) => [r.skill_code, r.avg_score]))
  const order = { COMPANY: 0, LINE: 1, MANAGER: 2, REP: 3 } as const
  const rows = [...a.rows].sort((x, y) => order[x.scope_type] - order[y.scope_type] || x.scope_name.localeCompare(y.scope_name, 'en', { numeric: true }) || x.sort - y.sort)
  rows.forEach((r, i) => {
    const bg = i % 2 === 1 ? CPAL.zebra : null
    const tx = gridStyle(bg, CPAL.navy, { h: 'left', border: true })
    const nm = gridStyle(bg, CPAL.navy, { bold: true, border: true })
    const c = company.get(r.skill_code) ?? null
    b.cells.push([
      { v: r.scope_type, s: tx }, { v: r.scope_name, s: tx }, { v: r.skill_code, s: tx }, { v: r.skill_name, s: tx },
      r.avg_score === null ? { v: '-', s: nm } : { v: r.avg_score, s: nm, z: '0.00' }, { v: r.n, s: nm },
      c === null ? { v: '-', s: nm } : { v: c, s: nm, z: '0.00' },
    ])
    b.heights.push(20)
  })
  return { name: 'Skills matrix', cells: b.cells, merges: b.merges, heights: b.heights, widths: [11, 28, 11, 34, 11, 14, 13] }
}
