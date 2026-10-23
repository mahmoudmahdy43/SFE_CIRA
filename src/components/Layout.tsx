import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Dialog, DialogContent } from './ui/overlay'
import { Brand, Sidebar, SidebarNav } from './app/Sidebar'
import { Topbar } from './app/Topbar'
import { ErrorBoundary } from './app/ErrorBoundary'
import { UserMenu } from './app/UserMenu'
import { CommandPalette } from './app/CommandPalette'
import { BuildStamp, UpdateNotifier } from './app/BuildStamp'

const KEY = 'sfe-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { pathname } = useLocation()

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(KEY, c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })

  return (
    <div className="flex min-h-screen">
      <div className="contents print:hidden"><Sidebar collapsed={collapsed} onToggle={toggle} /></div>
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent title="Navigation" side="left">
          <div className="flex h-full flex-col">
            <Brand />
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
            <div className="border-t p-2">
              <UserMenu />
              <BuildStamp className="pt-1" />
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="contents print:hidden"><Topbar onOpenPalette={() => setPaletteOpen(true)} onOpenMenu={() => setDrawerOpen(true)} /></div>
        <main className="flex-1 p-4 md:p-6">
          <div key={pathname} className="mx-auto max-w-[1600px] animate-fade-in">
            <ErrorBoundary resetKey={pathname}><Outlet /></ErrorBoundary>
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <UpdateNotifier />
    </div>
  )
}
