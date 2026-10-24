import { patchSheetXml } from '../daily/dailyExport'
import type { PlanDoctor, PlanRow, PlanSummary } from './planner'

const GREEN = '1B5E42'
const STRIP = 'C5E0B3'
const thin = { style: 'thin', color: { rgb: 'BFBFBF' } }
const fill = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } })
const font = (sz: number, o: { bold?: boolean; rgb?: string } = {}) => ({ name: 'Arial', sz, bold: o.bold ?? false, color: { rgb: o.rgb ?? '000000' } })
const NS = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const HEADERS = ['Date', 'Day', '#', 'Time', 'Grade', 'Doctor', 'Account', 'Brick', 'Visit', 'Confirmed', 'No GPS', 'Note', 'Day visits / target / grades']
const WIDTHS = [13, 11, 5, 8, 8, 34, 34, 18, 8, 11, 8, 50, 40]
/** Grade colors: A green, B yellow, C gray. */
const GRADE_FILL: Record<string, string> = { A: 'C6EFCE', B: 'FFEB9C', C: 'D9D9D9' }
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

export interface PlanBook { rep: string; month: string; target: number; rows: PlanRow[]; doctors: Map<number, PlanDoctor>; summary: PlanSummary | null; status: string }

/** The plan as a CIRA workbook: banner with the logo, one table of all days, and a Summary sheet. */
export async function downloadPlanWorkbook(book: PlanBook, logoUrl: string): Promise<void> {
  const [mod, fflate] = await Promise.all([import('xlsx-js-style'), import('fflate')])
  const XLSX = mod.default ?? (mod as unknown as typeof mod.default)
  const { unzipSync, zipSync, strToU8, strFromU8 } = fflate
  const logo = await fetch(logoUrl).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)

  const ws: Record<string, unknown> = {}
  const put = (r: number, c: number, v: string | number, s?: object) => { ws[XLSX.utils.encode_cell({ r, c })] = { t: typeof v === 'number' ? 'n' : 's', v, ...(s ? { s } : {}) } }
  const last = HEADERS.length - 1
  for (let r = 0; r < 3; r++) for (let c = 0; c <= last; c++) put(r, c, '', { fill: fill(GREEN) })
  put(0, 2, `Monthly Visit Plan - ${book.rep}`, { fill: fill(GREEN), font: font(18, { bold: true, rgb: 'FFFFFF' }), alignment: { vertical: 'center' } })
  put(1, 2, `${book.month}  |  PM  |  daily target ${book.target}  |  ${book.status.toUpperCase()}`, { fill: fill(GREEN), font: font(11, { rgb: 'FFFFFF' }), alignment: { vertical: 'center' } })
  for (let c = 0; c <= last; c++) put(3, c, '', { fill: fill(STRIP) })
  const cov = book.summary
  const gt = { A: book.rows.filter((x) => x.grade === 'A').length, B: book.rows.filter((x) => x.grade === 'B').length, C: book.rows.filter((x) => x.grade === 'C').length }
  const gSum = gt.A + gt.B + gt.C
  const gp = (n: number) => `${gSum > 0 ? Math.round((n / gSum) * 100) : 0}%`
  put(3, 0, cov ? `Visits ${book.rows.length} of ${cov.targetVisits}   |   Coverage by day 15: ${cov.cov15.done}/${cov.cov15.total} (${Math.round(cov.cov15.pct * 100)}%)   |   PCF ${(cov.pcf.pct * 100).toFixed(1)}%   |   ${cov.targetsMet ? `Targets met at level ${cov.level}` : cov.notReachable ? 'TARGET NOT REACHABLE' : ''}   |   A ${gp(gt.A)}  B ${gp(gt.B)}  C ${gp(gt.C)}` : `Visits ${book.rows.length}`, { fill: fill(STRIP), font: font(11, { bold: true }) })
  HEADERS.forEach((h, c) => put(5, c, h, { fill: fill(GREEN), font: font(11, { bold: true, rgb: 'FFFFFF' }), alignment: { horizontal: 'center', vertical: 'center' } }))

  const days = [...new Set(book.rows.map((r) => r.day))].sort()
  let r = 6
  days.forEach((day, di) => {
    const list = book.rows.filter((x) => x.day === day).sort((a, b) => a.seq - b.seq)
    const tint = di % 2 === 1 ? fill('F2F7F4') : undefined
    const over = list.length > book.target
    list.forEach((row, i) => {
      const d = book.doctors.get(row.doctor_id)
      const base = (extra: object = {}) => ({ font: font(10), ...(tint ? { fill: tint } : {}), border: { top: i === 0 ? { style: 'medium', color: { rgb: '000000' } } : thin, bottom: thin, left: thin, right: thin }, alignment: { vertical: 'center' }, ...extra })
      put(r, 0, day, base())
      put(r, 1, dayName(day), base())
      put(r, 2, row.seq, base({ alignment: { horizontal: 'center' } }))
      put(r, 3, row.planned_time ?? '', base({ alignment: { horizontal: 'center' } }))
      put(r, 4, row.grade ?? '', base({ alignment: { horizontal: 'center' }, font: font(10, { bold: true }), ...(row.grade ? { fill: fill(GRADE_FILL[row.grade]) } : {}) }))
      put(r, 5, d?.name ?? `Doctor #${row.doctor_id}`, base())
      put(r, 6, d?.account ?? '', base())
      put(r, 7, d?.brick ?? '', base())
      put(r, 8, `${row.visit_no}/${d?.freq ?? '?'}`, base({ alignment: { horizontal: 'center' } }))
      put(r, 9, row.fixed ? 'Yes' : '', base({ alignment: { horizontal: 'center' } }))
      put(r, 10, d && d.lat === null ? 'No GPS' : '', base({ alignment: { horizontal: 'center' } }))
      put(r, 11, row.note ?? '', base())
      const ts = list.map((x) => x.planned_time).filter((x): x is string => !!x).sort()
      const spanMin = ts.length > 1 ? Number(ts[ts.length - 1].slice(0, 2)) * 60 + Number(ts[ts.length - 1].slice(3, 5)) - (Number(ts[0].slice(0, 2)) * 60 + Number(ts[0].slice(3, 5))) : 0
      const dg = `A ${list.filter((x) => x.grade === 'A').length} · B ${list.filter((x) => x.grade === 'B').length} · C ${list.filter((x) => x.grade === 'C').length}`
      put(r, 12, i === 0 ? `${list.length} / ${book.target}  ${ts[0] ?? ''}→${ts[ts.length - 1] ?? ''} (${Math.floor(spanMin / 60)}h${String(spanMin % 60).padStart(2, '0')})  ${dg}` : '', base({ alignment: { horizontal: 'center' }, ...(i === 0 && over ? { fill: fill(list.length >= 12 ? 'FECACA' : 'FDE68A') } : {}), font: font(10, { bold: i === 0 }) }))
      r++
    })
  })
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 5), c: last } })
  ws['!cols'] = WIDTHS.map((wch) => ({ wch }))
  // filter on the header row: filter by grade (or any other column)
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: Math.max(r - 1, 5), c: last } }) }
  ws['!rows'] = [{ hpt: 22 }, { hpt: 22 }, { hpt: 22 }]
  ws['!merges'] = [{ s: { r: 0, c: 2 }, e: { r: 0, c: last } }, { s: { r: 1, c: 2 }, e: { r: 1, c: last } }, { s: { r: 3, c: 0 }, e: { r: 3, c: last } }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws as never, 'Plan')
  if (book.summary) {
    const s = book.summary
    const rows: (string | number)[][] = [
      ['Targets', s.targetsMet ? `MET at level ${s.level} (L1 strictest ... L4 loosest)` : s.notReachable ? `NOT REACHABLE - best plan found, level ${s.level ?? '-'}` : '-'],
      ...(s.notReachable ? [['Available capacity (12 x open days)', s.notReachable.capacity], [`Required (${Math.round(0.9 * 100)}% x ${s.notReachable.targetVisits} target visits)`, s.notReachable.requiredVisits], ['Best PCF / Coverage by day 15 achievable', `${(s.notReachable.bestPcf * 100).toFixed(1)}% / ${(s.notReachable.bestCov15 * 100).toFixed(1)}% (${s.notReachable.requiredCov15} doctors needed by day 15)`], ...s.notReachable.reasons.map((x) => ['Reason', x])] : []),
      ['Grades A / B / C', `${gt.A} (${gp(gt.A)}) / ${gt.B} (${gp(gt.B)}) / ${gt.C} (${gp(gt.C)})`],
      ['Allowed waiting (20-45 min, doctor certain to be present)', s.waitAllowed ? `${s.waitAllowed.doctors} doctors, ${s.waitAllowed.minutes} min` : '-'],
      ['Planning mode', s.mode === 'history' ? 'History mode' : s.mode === 'geography' ? 'Geography mode - Low confidence - geography only' : 'No plan'],
      ['Doctors with visit times / GPS / any history', `${s.modeInfo.withTime} / ${s.modeInfo.withGps} / ${s.modeInfo.withAny} of ${s.modeInfo.listDoctors}`],
      ['Brick history source', s.brickSource === 'own' ? "the rep's own" : s.brickSource === 'any' ? 'any rep who worked these bricks' : '-'],
      ['Doctors only on their usual weekdays / free any day', `${s.restrictedDoctors} / ${s.freeDoctors}`],
      ['Open PM days', s.openDays], ['Closed days', s.closedDays], ['Daily target', s.target], ['Capacity at target (Target x open days)', s.capacityAtTarget], ['Capacity at max (12 x open days)', s.capacityAtMax], ['Target visits (list)', s.targetVisits], ['Visits in the plan', s.plannedVisits],
      ['Days above target', s.overDays], ['Highest day', s.peak], ['Lowest day', s.lowest], ['His usual busiest day (P90, last 3 months)', s.usualMaxDay ?? 'not enough history'], ['Days with 1 brick / 2 bricks', `${s.oneBrickDays} / ${s.twoBrickDays.length}`], ['Average stay (first to last visit)', `${Math.round(s.avgStayMin)} min`], ['Waiting time in total', `${s.waitTotalMin} min`], ['Same-brick repeats on consecutive days', `${s.repeats.length} (limit ${s.repeatLimit}) ${s.repeats.map((r) => r.why).join('; ')}`], ['PM window', `${s.window.start} - ${s.window.end}${s.window.own ? '' : ' (default)'}`], ['Coverage by day 15', `${s.cov15.done} of ${s.cov15.total} (needs ${s.cov15.required})`], ['Expected PCF', `${(s.pcf.pct * 100).toFixed(1)}%`],
      ['Average estimated km a day (straight line x 1.35)', Number(s.avgEstKmPerDay.toFixed(1))], ['', ''], ['Warnings', ''], ...s.warnings.map((w) => ['', w]),
      ['', ''], ['Doctors without GPS', s.noGps.map((d) => d.name).join(', ')], ['Doctors without a usual time', s.noTime.length], ['Doctors left out', s.dropped.map((d) => `${d.name} ${d.visits.join(', ')}`).join(', ')],
    ]
    const sh = XLSX.utils.aoa_to_sheet(rows)
    sh['!cols'] = [{ wch: 30 }, { wch: 90 }]
    XLSX.utils.book_append_sheet(wb, sh, 'Summary')
  }

  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  const files = unzipSync(new Uint8Array(raw))
  let types = strFromU8(files['[Content_Types].xml'])
  files['xl/worksheets/sheet1.xml'] = strToU8(patchSheetXml(strFromU8(files['xl/worksheets/sheet1.xml']), logo !== null))
  if (logo) {
    files['xl/media/cira-logo.png'] = new Uint8Array(logo)
    if (!/Extension="png"/.test(types)) types = types.replace('<Override', '<Default Extension="png" ContentType="image/png"/><Override')
    const px = 9525
    const pic = `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${6 * px}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${3 * px}</xdr:rowOff></xdr:from><xdr:ext cx="${60 * px}" cy="${60 * px}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="CIRA logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${60 * px}" cy="${60 * px}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
    files['xl/drawings/drawing1.xml'] = strToU8(`${HEAD}<xdr:wsDr ${NS}>${pic}</xdr:wsDr>`)
    files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(`${HEAD}<Relationships ${RELS}><Relationship Id="rId1" Type="${REL}/image" Target="../media/cira-logo.png"/></Relationships>`)
    files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(`${HEAD}<Relationships ${RELS}><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`)
    types = types.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>')
    files['[Content_Types].xml'] = strToU8(types)
  }
  const blob = new Blob([zipSync(files) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Monthly_Plan_${book.rep.replace(/\s+/g, '_')}_${book.month.slice(0, 7)}.xlsx`
  a.click()
  URL.revokeObjectURL(a.href)
}
