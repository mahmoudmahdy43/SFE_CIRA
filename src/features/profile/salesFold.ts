/** Pure aggregation of v_sales_cube rows for the rep / box sales tabs (sums only; ratios from sums). */
export interface CubeLike { month: string; product: string; sales: number; target: number; units: number; vacant: boolean }
export interface SalesMonth { month: string; sales: number; target: number; ach: number | null; gap: number; vacant: boolean; hasData: boolean }
export interface SalesProduct { product: string; sales: number; target: number; ach: number | null; gap: number }

export const achOf = (sales: number, target: number): number | null => (target > 0 ? sales / target : null)

/** One entry per requested month (months without rows have hasData=false). A month is vacant when every row of it is vacant. */
export function salesByMonth(rows: CubeLike[], months: string[]): SalesMonth[] {
  return months.map((m) => {
    const rs = rows.filter((r) => r.month === m)
    const sales = rs.reduce((a, r) => a + r.sales, 0)
    const target = rs.reduce((a, r) => a + r.target, 0)
    return { month: m, sales, target, ach: achOf(sales, target), gap: target - sales, vacant: rs.length > 0 && rs.every((r) => r.vacant), hasData: rs.length > 0 }
  })
}

/** Products of the given months, largest sales first. */
export function salesByProduct(rows: CubeLike[], months: string[]): SalesProduct[] {
  const set = new Set(months)
  const by = new Map<string, { sales: number; target: number }>()
  for (const r of rows) {
    if (!set.has(r.month)) continue
    const x = by.get(r.product) ?? { sales: 0, target: 0 }
    x.sales += r.sales
    x.target += r.target
    by.set(r.product, x)
  }
  return [...by].map(([product, x]) => ({ product, ...x, ach: achOf(x.sales, x.target), gap: x.target - x.sales })).sort((a, b) => b.sales - a.sales || a.product.localeCompare(b.product))
}
