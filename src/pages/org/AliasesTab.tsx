import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '../../components/app/DataTable'
import { EmptyState } from '../../components/app/states'
import { Combobox } from '../../components/ui/combobox'
import { Button } from '../../components/ui/button'
import { Card, Input } from '../../components/ui/misc'
import { Field, FormDialog } from '../../components/app/FormDialog'
import { fetchAll } from '../../lib/api/core'
import type { OrgView } from '../../lib/api/org'
import { normName } from '../../lib/norm'
import { supabase } from '../../lib/supabase'

interface Alias { id: number; line_id: number | null; alias_norm: string; territory_id: number }
interface Row { a: Alias; alias: string; line: string; territory: string; territoryLine: string }

export default function AliasesTab({ org }: { org: OrgView }) {
  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAliases(await fetchAll<Alias>('territory_aliases', 'id,line_id,alias_norm,territory_id', ['id']))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load aliases')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const remove = async (a: Alias) => {
    const { error: err } = await supabase.from('territory_aliases').delete().eq('id', a.id)
    if (err) toast.error(err.message)
    else {
      toast.success('Alias deleted')
      void load()
    }
  }

  const rows = useMemo<Row[]>(
    () =>
      aliases.map((a) => ({
        a,
        alias: a.alias_norm,
        line: a.line_id ? org.lineById.get(a.line_id)?.name ?? '?' : 'Any line',
        territory: org.territoryById.get(a.territory_id)?.name ?? '?',
        territoryLine: org.lineById.get(org.territoryById.get(a.territory_id)?.line_id ?? -1)?.name ?? '',
      })),
    [aliases, org],
  )
  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      { accessorKey: 'alias', header: 'Alias (normalised)' },
      { accessorKey: 'line', header: 'Applies to' },
      { accessorKey: 'territory', header: 'Territory' },
      { accessorKey: 'territoryLine', header: 'Territory line' },
      {
        id: 'actions', header: '', enableSorting: false, enableHiding: false,
        cell: (c) => (
          <Button size="icon-sm" variant="ghost" aria-label={`Delete alias ${c.row.original.alias}`} onClick={() => void remove(c.row.original.a)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div className="space-y-4">
      <DataTable
        data={rows}
        columns={columns}
        csvName="territory-aliases"
        loading={loading}
        error={error}
        onRetry={() => void load()}
        emptyTitle="No aliases yet"
        emptyDescription="Aliases map spelling variants seen in uploads to a territory."
        toolbar={
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add alias
          </Button>
        }
      />
      <Card>
        <EmptyState
          icon={Search}
          title="No unresolved territory names"
          description="When a Sales upload contains territory names that cannot be matched, they will be listed here so you can map them to a territory."
        />
      </Card>
      {adding && <AddAlias org={org} onClose={() => setAdding(false)} onDone={() => void load()} />}
    </div>
  )
}

function AddAlias({ org, onClose, onDone }: { org: OrgView; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [line, setLine] = useState<string | null>(null)
  const [terr, setTerr] = useState<string | null>(null)
  const options = org.territories
    .filter((t) => !line || String(t.line_id) === line)
    .map((t) => ({ value: String(t.id), label: `${org.lineById.get(t.line_id)?.name ?? ''} · ${t.name}` }))
  const norm = normName(text)
  return (
    <FormDialog
      open
      onOpenChange={onClose}
      onDone={onDone}
      title="Add territory alias"
      description="Stored in the same normalised form the database uses for matching."
      submitLabel="Add"
      disabled={!norm || !terr}
      onSubmit={async () => {
        const { error } = await supabase.from('territory_aliases').insert({
          alias_norm: norm,
          territory_id: Number(terr),
          line_id: line ? Number(line) : null,
        })
        if (error) throw new Error(error.message.includes('duplicate') ? 'This alias already exists for that line.' : error.message)
        return { message: 'Alias added' }
      }}
    >
      <Field label="Alias text" htmlFor="al-text" hint={norm ? `Will be stored as: "${norm}"` : undefined}>
        <Input id="al-text" required value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label="Applies to line (optional)">
        <Combobox label="Line" placeholder="Any line" className="w-full" options={org.lines.map((l) => ({ value: String(l.id), label: l.name }))} value={line} onChange={(v) => { setLine(v); setTerr(null) }} />
      </Field>
      <Field label="Territory">
        <Combobox allowAll={false} label="Territory" placeholder="Select territory" className="w-full" options={options} value={terr} onChange={setTerr} />
      </Field>
    </FormDialog>
  )
}
