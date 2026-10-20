import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import { MultiSelect } from '../../components/app/Controls'
import { Field, FormDialog } from '../../components/app/FormDialog'
import { EmptyState, ErrorState } from '../../components/app/states'
import { Button } from '../../components/ui/button'
import { Card, Input, Skeleton } from '../../components/ui/misc'
import { Dialog, DialogContent } from '../../components/ui/overlay'
import { deleteMapGroup, fetchMapGroups, fetchMapNames, fetchProductOpts, fetchSpecialityOpts, replaceLineGroups, saveMapGroup, type GroupDraft, type MapGroup, type ProdOpt, type SpecOpt } from '../../lib/api/roi'
import { fetchLineNames } from '../../lib/api/reports'
import { useAsync } from '../dashboard/useAsync'
import { resetDashCache } from '../dashboard/useDash'
import { cn } from '../../lib/utils'
import { STRATEGY_MAP, normName, suggestMap, type Suggestion } from './roiMath'

type Line = { id: number; name: string }

export function SpecialityMapTab() {
  const lines = useAsync('roi:map:lines', fetchLineNames)
  const groups = useAsync('roi:map:groups', fetchMapGroups)
  const specs = useAsync('roi:map:specs', fetchSpecialityOpts)
  const prods = useAsync('roi:map:prods', fetchProductOpts)
  const [edit, setEdit] = useState<{ line: Line; group: MapGroup | null } | null>(null)
  const [del, setDel] = useState<MapGroup | null>(null)
  const [fill, setFill] = useState(false)

  const err = lines.error ?? groups.error ?? specs.error ?? prods.error
  const ready = lines.data && groups.data && specs.data && prods.data
  const reload = () => { resetDashCache(); groups.reload() }
  const specName = useMemo(() => new Map((specs.data ?? []).map((s) => [s.id, s.name])), [specs.data])
  const prodName = useMemo(() => new Map((prods.data ?? []).map((p) => [p.id, p.name])), [prods.data])

  if (err) return <ErrorState message={err} onRetry={() => { lines.reload(); groups.reload(); specs.reload(); prods.reload() }} />
  if (!ready) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-48" /></div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">Per line, group the specialities that share the same products. The Speciality ROI report compares the visits to a group's doctors with the sales of its products. The order of the products is their priority.</p>
        <Button onClick={() => setFill(true)}><Wand2 className="h-4 w-4" aria-hidden />Fill from the 2026 strategy</Button>
      </div>

      {lines.data!.map((line) => {
        const mine = groups.data!.filter((g) => g.line_id === line.id)
        return (
          <Card key={line.id} className="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{line.name}</h2>
              <Button size="sm" onClick={() => setEdit({ line, group: null })}><Plus className="h-3.5 w-3.5" aria-hidden />Add group</Button>
            </div>
            {mine.length === 0 ? <EmptyState title="No groups in this line" className="py-6" /> : (
              <ul className="divide-y">
                {mine.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="font-medium">{g.name}</div>
                      <div className="text-13 text-muted-foreground">Specialities: {g.specialities.map((i) => specName.get(i) ?? i).join(' + ') || '—'}</div>
                      <div className="text-13 text-muted-foreground">Products: {g.products.map((i, n) => `${prodName.get(i) ?? i} (${n + 1})`).join(', ') || '—'}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" aria-label={`Edit ${g.name}`} onClick={() => setEdit({ line, group: g })}><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Button>
                      <Button size="sm" aria-label={`Delete ${g.name}`} onClick={() => setDel(g)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      })}

      {edit && <GroupDialog key={edit.group?.id ?? `new-${edit.line.id}`} line={edit.line} group={edit.group} specs={specs.data!} prods={prods.data!} onClose={() => setEdit(null)} onSaved={reload} nextSort={groups.data!.filter((g) => g.line_id === edit.line.id).length + 1} />}
      {del && (
        <FormDialog open onOpenChange={(o) => !o && setDel(null)} title={`Delete "${del.name}"?`} description="Its specialities and products are removed from the group. Visits and sales are not touched." submitLabel="Delete" variant="danger"
          onSubmit={async () => { await deleteMapGroup(del.id); return { message: 'Group deleted' } }} onDone={reload}>
          <p className="text-sm">This cannot be undone.</p>
        </FormDialog>
      )}
      {fill && <FillDialog lines={lines.data!} groups={groups.data!} specs={specs.data!} prods={prods.data!} onClose={() => setFill(false)} onDone={reload} />}
    </div>
  )
}

/* ------------------------------ add / edit one group ------------------------------ */
function GroupDialog({ line, group, specs, prods, nextSort, onClose, onSaved }: {
  line: Line; group: MapGroup | null; specs: SpecOpt[]; prods: ProdOpt[]; nextSort: number; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [members, setMembers] = useState<number[]>(group?.specialities ?? [])
  const [products, setProducts] = useState<number[]>(group?.products ?? [])
  const options = prods.filter((p) => p.line_id === line.id && !products.includes(p.id))
  const byId = new Map(prods.map((p) => [p.id, p.name]))
  const move = (i: number, d: number) => setProducts((l) => { const a = [...l]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a })

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={group ? `Edit group — ${line.name}` : `Add group — ${line.name}`} submitLabel="Save" disabled={name.trim() === ''}
      onSubmit={async () => { await saveMapGroup({ id: group?.id, line_id: line.id, name: name.trim(), sort: group?.sort ?? nextSort, specialities: members, products }); return { message: 'Group saved' } }}
      onDone={onSaved}>
      <Field label="Group name" htmlFor="grp-name"><Input id="grp-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Specialities" hint="Specialities that share the same products are one group."><MultiSelect label="Specialities" options={specs} value={members} onChange={setMembers} allLabel="None" /></Field>
      <Field label="Products" hint="The order is the priority: 1, 2, 3…">
        <ol className="space-y-1" aria-label="Products in priority order">
          {products.map((id, i) => (
            <li key={id} className="flex items-center gap-1 rounded-control border px-2 py-1 text-sm">
              <span className="tnum w-5 text-muted-foreground">{i + 1}</span><span className="flex-1 truncate">{byId.get(id) ?? id}</span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === products.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setProducts((l) => l.filter((x) => x !== id))}><X className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ol>
        <select aria-label="Add a product" value="" onChange={(e) => e.target.value && setProducts((l) => [...l, Number(e.target.value)])} className="mt-1 h-9 w-full rounded-control border bg-card px-2 text-sm">
          <option value="">Add a product of {line.name}…</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
    </FormDialog>
  )
}

/* ------------------------------ fill from the 2026 strategy ------------------------------ */
function FillDialog({ lines, groups, specs, prods, onClose, onDone }: {
  lines: Line[]; groups: MapGroup[]; specs: SpecOpt[]; prods: ProdOpt[]; onClose: () => void; onDone: () => void
}) {
  const names = useAsync('roi:map:names', fetchMapNames)
  const [edited, setEdited] = useState<Suggestion[] | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const lineOf = (n: string) => lines.find((l) => normName(l.name) === normName(n))
  const sug: Suggestion[] | null = edited ?? (names.data ? suggestMap(STRATEGY_MAP, names.data.specialities, names.data.products.map((p) => ({ name: p.name, line: p.line }))) : null)
  const lineName = (id: number | null) => lines.find((l) => l.id === id)?.name ?? null
  const prodOptions = (line: string) => prods.filter((p) => p.line_id === null || normName(lineName(p.line_id) ?? '') === normName(line)).map((p) => p.name)

  const set = (gi: number, kind: 'specialities' | 'products', si: number, value: string) =>
    setEdited((sug ?? []).map((g, i) => (i !== gi ? g : { ...g, [kind]: g[kind].map((s, j) => (j !== si ? s : { ...s, matched: value || null, how: value ? ('close' as const) : ('none' as const) })) })))

  const unmatched = (sug ?? []).reduce((a, g) => a + [...g.specialities, ...g.products].filter((s) => s.matched === null).length, 0)
  const drafts: GroupDraft[] = (sug ?? []).flatMap((g) => {
    const line = lineOf(g.line)
    if (!line) return []
    const sp = [...new Set(g.specialities.flatMap((s) => specs.filter((x) => x.name === s.matched).slice(0, 1).map((x) => x.id)))]
    const pr = [...new Set(g.products.flatMap((s) => prods.filter((x) => x.name === s.matched && (x.line_id === line.id || x.line_id === null)).slice(0, 1).map((x) => x.id)))]
    return [{ line_id: line.id, name: g.group, specialities: sp, products: pr }]
  })
  const lineIds = [...new Set(drafts.map((d) => d.line_id))]
  const existing = lineIds.filter((id) => groups.some((g) => g.line_id === id))

  const apply = async () => {
    setBusy(true)
    try { await replaceLineGroups(lineIds, drafts); toast.success(`${drafts.length} groups saved`); onDone(); onClose() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed') }
    finally { setBusy(false) }
  }
  const next = () => (existing.length > 0 ? setConfirm(true) : void apply())

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent title="Fill from the 2026 strategy" description="Check the matches, fix the red ones by hand, then confirm. Nothing is written before you confirm." className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {names.error ? <ErrorState message={names.error} onRetry={names.reload} />
          : !sug ? <Skeleton className="mt-4 h-40" />
          : confirm ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">Replace the groups of these lines?</p>
              <p className="text-sm text-muted-foreground">{existing.map(lineName).join(', ')} already {existing.length === 1 ? 'has' : 'have'} groups. They will be deleted and replaced by the groups below.</p>
              <div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setConfirm(false)}>Back</Button>
                <Button variant="danger" disabled={busy} onClick={() => void apply()}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Replace</Button></div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-13" aria-label="Suggested groups">
                  <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-2">Group</th><th className="px-2">Specialities (wanted → database)</th><th className="px-2">Products in priority order</th></tr></thead>
                  <tbody>
                    {sug.map((g, gi) => (
                      <tr key={`${g.line}|${g.group}`} className="border-t align-top">
                        <td className="py-2 pr-2"><div className="font-medium">{g.group}</div><div className="text-xs text-muted-foreground">{g.line}{lineOf(g.line) ? '' : ' (line not found)'}</div></td>
                        <td className="px-2 py-2"><div className="space-y-1">{g.specialities.map((s, si) => <SlotPick key={s.wanted} wanted={s.wanted} matched={s.matched} how={s.how} options={specs.map((x) => x.name)} onChange={(v) => set(gi, 'specialities', si, v)} />)}</div></td>
                        <td className="px-2 py-2"><div className="space-y-1">{g.products.map((s, si) => <SlotPick key={s.wanted} wanted={s.wanted} matched={s.matched} how={s.how} options={prodOptions(g.line)} onChange={(v) => set(gi, 'products', si, v)} />)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {unmatched > 0 && <p className="text-sm text-danger" role="status">{unmatched} name{unmatched === 1 ? '' : 's'} not matched — pick the right one, or it is left out of its group.</p>}
              <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={drafts.length === 0} onClick={next}>Continue</Button></div>
            </div>
          )}
      </DialogContent>
    </Dialog>
  )
}

function SlotPick({ wanted, matched, how, options, onChange }: { wanted: string; matched: string | null; how: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate" title={wanted}>{wanted}</span><span aria-hidden>→</span>
      <select aria-label={`Match for ${wanted}`} value={matched ?? ''} onChange={(e) => onChange(e.target.value)}
        className={cn('h-8 min-w-0 flex-1 rounded-control border bg-card px-2', matched === null && 'border-danger bg-danger-soft text-danger', how === 'close' && matched !== null && 'border-warning')}>
        <option value="">— not matched —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}
