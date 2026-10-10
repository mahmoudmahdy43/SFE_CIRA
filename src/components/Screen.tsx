import type { ReactNode } from 'react'

export function CenterScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500">Loading…</div>
  )
}
