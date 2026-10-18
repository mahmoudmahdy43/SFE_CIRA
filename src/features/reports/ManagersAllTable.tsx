import type { CSSProperties } from 'react'
import { ProfileLink } from '../../components/app/ProfileLink'
import { EmptyState } from '../../components/app/states'
import { ALL_COLS, bannerText, fmtAll, isFlagged, lineSpans, reportingPeriod, workingDaysOf, type AllCol } from './managerAllLayout'
import type { ManagerRow } from './managerMath'

const GREEN = '#1E6B3A'
const GREY = '#BFBFBF'
const YELLOW = '#FFFFCC'
const RED = '#F8CBD0'
const AM_FIRST = ALL_COLS.findIndex((c) => c.am)
const AM_LAST = ALL_COLS.length - 1 - [...ALL_COLS].reverse().findIndex((c) => c.am)
const DASHED = '1px dashed #000'

/** Dashed box around the AM block (columns 13-16) and around the two date headers; everything else keeps the thin table border. */
function dashed(ci: number, header: boolean, last: boolean): CSSProperties {
  const s: CSSProperties = {}
  if (ci >= AM_FIRST && ci <= AM_LAST) {
    if (header) s.borderTop = DASHED
    if (last) s.borderBottom = DASHED
    if (ci === AM_FIRST) s.borderLeft = DASHED
    if (ci === AM_LAST) s.borderRight = DASHED
  } else if (header && ALL_COLS[ci].kind === 'dates') {
    s.border = DASHED
  }
  return s
}

const headStyle = (c: AllCol, ci: number): CSSProperties => {
  const dates = c.kind === 'dates'
  return { background: c.tone === 'pharmacy' ? GREY : dates ? '#fff' : GREEN, color: dates ? '#000' : '#fff', ...dashed(ci, true, false) }
}

/** Reports → Managers with shift = All: the 18-column performance layout (same columns, order and colors as the Excel file). */
export function ManagersAllTable({ rows, role, from, to, isFullMonth }: { rows: ManagerRow[]; role: string; from: string; to: string; isFullMonth: boolean }) {
  const spans = lineSpans(rows)
  const sums = ALL_COLS.map((c) => (c.sum ? rows.reduce((t, r) => t + (Number(c.value(r)) || 0), 0) : null))
  return (
    <div className="overflow-hidden rounded-card border bg-card">
      <div className="px-4 py-2 text-base font-bold text-white" style={{ background: '#14532D' }}>{bannerText(role)}</div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-sm font-semibold">
        <span>
          Working Days: <span className="tnum ml-1 inline-block min-w-10 rounded-sm border px-2 py-0.5 text-center" style={{ background: YELLOW }}>{workingDaysOf(rows)}</span>
        </span>
        <span>Reporting Period: {reportingPeriod(from, to, isFullMonth)}</span>
      </div>
      <div className="max-h-[68vh] min-h-[320px] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-center text-sm">
          <thead>
            <tr>
              {ALL_COLS.map((c, ci) => (
                <th
                  key={c.id}
                  className={`sticky top-0 z-20 whitespace-normal border-b border-r px-2 py-2 text-xs font-bold ${ci === 0 ? 'left-0 z-30 min-w-24' : ci === 1 ? 'left-24 z-30 min-w-44' : 'min-w-20'} ${c.kind === 'dates' ? 'min-w-40' : ''}`}
                  style={headStyle(c, ci)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const last = ri === rows.length - 1
              return (
                <tr key={r.manager_id}>
                  {ALL_COLS.map((c, ci) => {
                    if (ci === 0 && spans[ri] === 0) return null
                    const v = c.value(r)
                    const fill = isFlagged(c, v) ? RED : c.tone === 'pharmacy' ? GREY : c.tone === 'dates' ? YELLOW : undefined
                    const style: CSSProperties = { background: fill, color: isFlagged(c, v) ? '#9C0006' : undefined, ...dashed(ci, false, last) }
                    return (
                      <td
                        key={c.id}
                        rowSpan={ci === 0 ? spans[ri] : undefined}
                        className={`border-b border-r px-2 py-1.5 ${ci === 0 ? 'sticky left-0 z-10 bg-card align-middle font-bold' : ci === 1 ? 'sticky left-24 z-10 whitespace-nowrap bg-card text-left' : c.kind === 'dates' ? 'whitespace-normal text-xs' : 'tnum whitespace-nowrap'}`}
                        style={style}
                      >
                        {ci === 1 ? <ProfileLink type="manager" id={r.manager_id}>{r.name ?? ''}</ProfileLink> : fmtAll(c, v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {ALL_COLS.map((c, ci) => (
                  <td key={c.id} className={`sticky bottom-0 z-10 border-t-2 bg-muted px-2 py-2 font-semibold ${ci === 1 ? 'text-left' : 'tnum'}`}>
                    {ci === 0 ? 'Total' : sums[ci] === null ? '' : fmtAll(c, sums[ci])}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && <EmptyState title="No managers match" description="Change the role, line or period filters." />}
      </div>
    </div>
  )
}
