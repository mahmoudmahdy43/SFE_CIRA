# PHASE 0.5 — Design System & App Shell (world-class admin UI)

Read `PROJECT_SPEC.md` first. Phase 0 is done and deployed. Do NOT touch the database, auth logic, or workflows.
Goal: turn the plain shell into a **premium, modern analytics admin UI** — the quality bar is products like **Linear, Stripe Dashboard, Vercel and Notion Calendar**: calm neutral surfaces, generous spacing, crisp typography, subtle borders instead of heavy shadows, tiny details done right. It must NOT look like a default Tailwind/Bootstrap template.

## 0. Spec change (do this first)
Edit `PROJECT_SPEC.md` §1 (Frontend) to also allow: **shadcn/ui (Radix primitives), lucide-react, class-variance-authority, clsx/tailwind-merge, @tanstack/react-table, cmdk, sonner, @fontsource-variable/inter + @fontsource-variable/jetbrains-mono (self-hosted, no external CDN), date-fns, Recharts**. Add a §7b "Design system" pointing to the rules below. Keep everything else.

## 1. Design tokens (CSS variables, light + dark, switchable, persisted in localStorage with try/catch, default = system)
- **Font:** Inter Variable for UI, JetBrains Mono for numbers in tables when useful. Use `font-feature-settings: "tnum"` (tabular numbers) on every numeric cell and KPI value.
- **Neutral scale:** cool-neutral grays (≈ zinc/slate), page background slightly off-white (not pure white), cards white with 1px border; dark mode uses true layered surfaces (background < card < popover), no pure black.
- **One accent colour** (a confident indigo/blue). Semantic colours: success (green), warning (amber), danger (red), info — each with soft background + strong foreground variants, WCAG AA contrast.
- **Radius** 10px cards / 8px controls; **spacing** on a 4px grid; borders `1px` low-contrast; shadows only on popovers/menus.
- **Chart palette:** 6-colour categorical palette that is colour-blind safe and works in light and dark; sequential and diverging scales for heatmaps; always pair colour with labels/legends.
- **KPI status colours** (used later for Coverage/PCF/Call Rate): ≥100% green, 80–99% amber, <80% red — implement as a single reusable helper `kpiTone(value, target)`.

## 2. App shell
- **Sidebar:** collapsible (icon-only mode, state remembered), grouped sections (Analytics: Dashboard, 360° View · Data: Uploads, Data Quality · Organisation: Personnel, Org & Territories, Targets, Calendar · System: Settings), lucide icons, active-item indicator, tooltips when collapsed, app logo/name "SFE Hub" at the top, user menu (avatar initials, email, role badge, theme toggle, logout) at the bottom.
- **Top bar:** breadcrumb/page title, **global search / command palette (⌘K / Ctrl+K, cmdk)** that already lists the pages and has a placeholder group "Reps / Managers / Boxes (coming soon)", the **month picker** redesigned as a compact control with previous/next month arrows and a popover month grid (never a raw `<input type="month">`), and a sync-status dot.
- **Responsive:** desktop-first, fully usable on tablet; on mobile the sidebar becomes a drawer.
- **Page transitions & loading:** skeletons (never spinners alone), 150ms fade/slide, `prefers-reduced-motion` respected.
- Keep HashRouter and all existing routes/guards.

## 3. Reusable components (build in `src/components/ui` + `src/components/app`)
`PageHeader` (title, description, actions) · `KpiCard` (label, big tabular value, delta vs previous month with arrow, optional sparkline, status tone, skeleton + empty state) · `StatGrid` · `DataTable` (tanstack table: sticky header, sortable columns, column visibility, pinned first column, row density toggle, client search, pagination, CSV export button, loading skeleton, empty state, number alignment right, zebra off, hover highlight) · `Badge`/`StatusPill` (Active, Vacant, Resigned, Missing, Matched, Unmatched…) · `EmptyState` (icon + text + action) · `ErrorState` with retry · `FilterBar` (month, line, manager, box selects with search; "Vacant" option) · `Select/Combobox` with search · `Tabs` · `Dialog/Sheet` · `Tooltip` · `Toast` (sonner) · `Progress` & `Meter` (for coverage-like %) · `ChartCard` wrapper with title, legend, tooltip style, consistent axes (Recharts: line, bar, stacked bar, donut, heatmap-style grid) · `Avatar` (initials).
All components accessible (keyboard, focus rings, aria labels), typed with TypeScript.

## 4. Showcase page (so the owner can review the design)
Add a route `/design` (admin only, link in Settings → "Design preview") that shows every component with **clearly labelled MOCK data** (a visible "Sample data" badge — never show fake numbers as real anywhere else): a KPI row (Coverage, PCF, Call Rate AM, Call Rate PM, Ach CR, Total KPI), a line chart of monthly trend, a bar chart by manager, a donut for Planned vs Direct visits, a rep table with 20 sample rows (sorted, filtered, paginated, with status pills and inline progress bars), a calendar-like heatmap of working-day status per rep (worked / leave / office work / activity / missing using the status colours), empty/loading/error states, and light/dark side by side toggle.

## 5. Update existing pages
Restyle Login (split layout: brand panel + form, no clutter), the "no role" screen, the portal-coming-soon screen, and Dashboard "System status" (use the new components; keep the same data calls). Every placeholder page uses `PageHeader` + `EmptyState`.

## 6. Quality bar
`npm run build` and lint pass; Lighthouse accessibility ≥ 95 on Login and Dashboard; no layout shift; no console errors; bundle sensible (lazy-load the `/design` route and the charts). Commit with a clear message, then tell me: (1) the exact git commands to push, (2) a list of screens to screenshot for review (Login, Dashboard light, Dashboard dark, /design top, /design tables, collapsed sidebar, command palette, mobile width).

Stop after Phase 0.5.
