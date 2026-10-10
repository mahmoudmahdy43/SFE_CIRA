import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Inbox, Moon, Sun } from 'lucide-react'
import { PageHeader, EmptyState, ErrorState } from '../components/app/states'
import { KpiCard, StatGrid } from '../components/app/KpiCard'
import { ChartCard } from '../components/app/ChartCard'
import { BarsChart, CHART, Donut, TrendLine } from '../components/app/charts'
import { DataTable } from '../components/app/DataTable'
import { FilterBar, type FilterState } from '../components/app/FilterBar'
import { Avatar, Badge, Card, Meter, Progress, Skeleton, StatusPill, type PillKey } from '../components/ui/misc'
import { Button } from '../components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogTrigger, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '../components/ui/overlay'
import { kpiTone } from '../lib/kpi'
import { useTheme } from '../context/ThemeContext'

/* ---------- MOCK DATA (design preview only) ---------- */
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
const TREND = MONTHS.map((m, i) => ({
  month: m,
  Coverage: [78, 81, 84, 83, 88, 90][i],
  PCF: [70, 72, 75, 79, 78, 82][i],
  'Ach CR': [64, 70, 73, 71, 77, 80][i],
}))
const BY_MANAGER = ['A. Samir', 'M. Fouad', 'H. Nabil', 'S. Adel', 'R. Magdy', 'K. Wael'].map((m, i) => ({
  manager: m,
  KPI: [92, 85, 78, 96, 70, 88][i],
}))
const PLANNED = [
  { name: 'Planned', value: 7240 },
  { name: 'Direct', value: 2760 },
]
const NAMES = ['Omar Hassan', 'Mona Adel', 'Karim Fathy', 'Sara Nabil', 'Youssef Ali', 'Nour Samy', 'Hady Mostafa', 'Laila Ramy', 'Tarek Emad', 'Dina Sherif']
const STATUSES: PillKey[] = ['Active', 'Active', 'Active', 'Vacant', 'Resigned', 'Missing']
interface RepRow {
  rep: string
  box: string
  manager: string
  status: PillKey
  coverage: number
  pcf: number
  cr: number
  visits: number
}
const REPS: RepRow[] = Array.from({ length: 20 }, (_, i) => ({
  rep: NAMES[i % 10] + (i >= 10 ? ' Jr.' : ''),
  box: `Box ${String(100 + i * 3)}`,
  manager: BY_MANAGER[i % 6].manager,
  status: STATUSES[i % STATUSES.length],
  coverage: 0.55 + ((i * 37) % 46) / 100,
  pcf: 0.5 + ((i * 53) % 55) / 100,
  cr: 0.6 + ((i * 29) % 50) / 100,
  visits: 120 + ((i * 41) % 180),
}))

const HEAT_STATUS = [
  { key: 'worked', label: 'Worked', color: 'var(--st-worked)' },
  { key: 'leave', label: 'Leave', color: 'var(--st-leave)' },
  { key: 'ow', label: 'Office work', color: 'var(--st-ow)' },
  { key: 'activity', label: 'Activity', color: 'var(--st-activity)' },
  { key: 'missing', label: 'Missing', color: 'var(--st-missing)' },
] as const
function heatCell(r: number, d: number): (typeof HEAT_STATUS)[number] {
  const v = (r * 7 + d * 13 + r * d) % 23
  if (v === 0 || v === 1) return HEAT_STATUS[1]
  if (v === 2) return HEAT_STATUS[2]
  if (v === 3) return HEAT_STATUS[3]
  if (v === 4 && r % 2 === 0) return HEAT_STATUS[4]
  return HEAT_STATUS[0]
}

function SampleBadge() {
  return <Badge tone="warning">Sample data</Badge>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <SampleBadge />
      </div>
      {children}
    </section>
  )
}

function Heatmap() {
  const days = Array.from({ length: 30 }, (_, i) => i + 1)
  return (
    <ChartCard
      title="Working-day status per rep"
      description="September · one cell per working day"
      legend={HEAT_STATUS.map((s) => ({ label: s.label, color: s.color }))}
    >
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[3px]" aria-label="Working-day status heatmap">
          <thead>
            <tr>
              <th className="sr-only">Rep</th>
              {days.map((d) => (
                <th key={d} className="tnum w-5 text-[10px] font-normal text-muted-foreground">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NAMES.slice(0, 8).map((n, r) => (
              <tr key={n}>
                <th scope="row" className="whitespace-nowrap pr-3 text-left text-xs font-medium">{n}</th>
                {days.map((d) => {
                  const s = heatCell(r, d)
                  return (
                    <td key={d} className="p-0">
                      <Tooltip side="top" content={`${n} · Sep ${d} · ${s.label}`}>
                        <span tabIndex={-1} className="block h-5 w-5 rounded-[4px]" style={{ background: s.color, opacity: s.key === 'worked' ? 0.85 : 1 }} />
                      </Tooltip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  )
}

function Content() {
  const [filters, setFilters] = useState<FilterState>({ line: null, manager: null, box: null })

  const columns = useMemo<ColumnDef<RepRow, unknown>[]>(
    () => [
      {
        accessorKey: 'rep',
        header: 'Rep',
        enableHiding: false,
        cell: (c) => (
          <span className="flex items-center gap-2.5">
            <Avatar text={c.row.original.rep} className="h-6 w-6 text-[10px]" />
            {c.row.original.rep}
          </span>
        ),
      },
      { accessorKey: 'box', header: 'Box' },
      { accessorKey: 'manager', header: 'Manager' },
      { accessorKey: 'status', header: 'Status', cell: (c) => <StatusPill status={c.row.original.status} /> },
      {
        accessorKey: 'coverage',
        header: 'Coverage',
        cell: (c) => <Meter label="Coverage" value={c.row.original.coverage} tone={kpiTone(c.row.original.coverage, 0.9)} />,
      },
      { accessorKey: 'pcf', header: 'PCF', cell: (c) => <span className="tnum">{Math.round(c.row.original.pcf * 100)}%</span> },
      { accessorKey: 'cr', header: 'Ach CR', cell: (c) => <span className="tnum">{Math.round(c.row.original.cr * 100)}%</span> },
      { accessorKey: 'visits', header: 'Visits' },
    ],
    [],
  )

  const tone = (v: number) => kpiTone(v, 0.9)
  return (
    <>
      <Section title="Filters">
        <FilterBar
          value={filters}
          onChange={setFilters}
          lines={['CIRA 1', 'CIRA 2', 'CIRA 3'].map((l) => ({ value: l, label: l }))}
          managers={[{ value: 'vacant', label: 'Vacant – Region' }, ...BY_MANAGER.map((m) => ({ value: m.manager, label: m.manager }))]}
          boxes={[{ value: 'vacant', label: 'Vacant box' }, ...REPS.slice(0, 8).map((r) => ({ value: r.box, label: r.box }))]}
        />
      </Section>

      <Section title="KPI cards">
        <StatGrid>
          <KpiCard label="Coverage" value="90%" delta={2.1} tone={tone(0.9)} spark={[78, 81, 84, 83, 88, 90]} />
          <KpiCard label="PCF" value="82%" delta={4.0} tone={tone(0.82)} spark={[70, 72, 75, 79, 78, 82]} />
          <KpiCard label="Call Rate AM" value="9.4" delta={-0.3} deltaSuffix="" tone="warning" spark={[9.1, 9.8, 9.9, 9.6, 9.7, 9.4]} />
          <KpiCard label="Call Rate PM" value="6.1" delta={0} deltaSuffix="" tone="danger" spark={[6.5, 6.2, 6.0, 6.3, 6.1, 6.1]} />
          <KpiCard label="Ach CR" value="80%" delta={3.2} tone={tone(0.8)} spark={[64, 70, 73, 71, 77, 80]} />
          <KpiCard label="Total KPI" value="84%" delta={1.8} tone={tone(0.84)} spark={[72, 75, 77, 78, 81, 84]} />
        </StatGrid>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <KpiCard label="Loading state" loading />
          <KpiCard label="Empty state" empty />
        </div>
      </Section>

      <Section title="Charts">
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard
            className="lg:col-span-2"
            title="Monthly trend"
            description="Coverage, PCF and Ach CR"
            legend={[{ label: 'Coverage', color: CHART[0] }, { label: 'PCF', color: CHART[1] }, { label: 'Ach CR', color: CHART[2] }]}
          >
            <TrendLine data={TREND} xKey="month" series={[{ key: 'Coverage', name: 'Coverage' }, { key: 'PCF', name: 'PCF' }, { key: 'Ach CR', name: 'Ach CR' }]} />
          </ChartCard>
          <ChartCard title="Planned vs Direct" description="Visits this month" legend={[{ label: 'Planned', color: CHART[0] }, { label: 'Direct', color: CHART[1] }]}>
            <Donut data={PLANNED} centerLabel="visits" />
          </ChartCard>
          <ChartCard className="lg:col-span-3" title="Total KPI by manager" legend={[{ label: 'Total KPI', color: CHART[0] }]}>
            <BarsChart data={BY_MANAGER} xKey="manager" series={[{ key: 'KPI', name: 'Total KPI' }]} />
          </ChartCard>
        </div>
      </Section>

      <Section title="Working-day heatmap">
        <Heatmap />
      </Section>

      <Section title="Rep table">
        <DataTable data={REPS} columns={columns} numericColumns={['visits', 'pcf', 'cr']} csvName="sample-reps" />
      </Section>

      <Section title="States">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <EmptyState icon={Inbox} title="No uploads yet" description="Upload an Excel export to get started." action={<Button variant="primary" size="sm">Upload file</Button>} />
          </Card>
          <Card>
            <ErrorState message="Could not load visits for this month." onRetry={() => toast.info('Retrying…')} />
          </Card>
          <Card className="space-y-3 p-5" aria-busy="true">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        </div>
      </Section>

      <Section title="Primitives">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button>Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button disabled>Disabled</Button>
            <Button onClick={() => toast.success('Saved successfully')}>Show toast</Button>
            <Tooltip side="top" content="Helpful tooltip">
              <Button variant="ghost">Hover me</Button>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['Active', 'Vacant', 'Resigned', 'Missing', 'Matched', 'Unmatched', 'Approved', 'Pending'] as PillKey[]).map((s) => (
              <StatusPill key={s} status={s} />
            ))}
            <Badge tone="info">Info</Badge>
          </div>
          <div className="grid max-w-md gap-3">
            <Progress label="Coverage 92%" value={0.92} tone="success" />
            <Progress label="Coverage 84%" value={0.84} tone="warning" />
            <Progress label="Coverage 61%" value={0.61} tone="danger" />
          </div>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Overview</TabsTrigger>
              <TabsTrigger value="b">Details</TabsTrigger>
              <TabsTrigger value="c">History</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="pt-3 text-muted-foreground">Overview tab content.</TabsContent>
            <TabsContent value="b" className="pt-3 text-muted-foreground">Details tab content.</TabsContent>
            <TabsContent value="c" className="pt-3 text-muted-foreground">History tab content.</TabsContent>
          </Tabs>
          <div className="flex gap-2">
            <Dialog>
              <DialogTrigger asChild><Button>Open dialog</Button></DialogTrigger>
              <DialogContent title="Replace month?" description="Existing rows for this month will be replaced.">
                <div className="mt-6 flex justify-end gap-2">
                  <DialogClose asChild><Button>Cancel</Button></DialogClose>
                  <DialogClose asChild><Button variant="primary">Replace</Button></DialogClose>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild><Button>Open sheet</Button></DialogTrigger>
              <DialogContent title="Rep details" side="right">
                <div className="p-6">
                  <h3 className="text-base font-semibold">Rep details</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Side sheet for detail panels.</p>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </Section>
    </>
  )
}

export default function Design() {
  const { choice, setChoice } = useTheme()
  const [forceDark, setForceDark] = useState<boolean | null>(null)

  return (
    <div>
      <PageHeader
        title="Design preview"
        description="Every component in one place. All numbers on this page are sample data."
        actions={
          <>
            <SampleBadge />
            <Button onClick={() => setForceDark(forceDark === null ? true : forceDark ? false : null)} aria-pressed={forceDark !== null}>
              {forceDark === null ? 'Side by side' : 'Single view'}
            </Button>
            <Button
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setChoice(choice === 'dark' ? 'light' : 'dark')}
            >
              {choice === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </>
        }
      />
      {forceDark === null ? (
        <Content />
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <div data-theme="light" className="rounded-card border bg-background p-4 text-foreground">
            <Content />
          </div>
          <div data-theme="dark" className="rounded-card border bg-background p-4 text-foreground">
            <Content />
          </div>
        </div>
      )}
    </div>
  )
}
