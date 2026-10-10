import { useEffect } from 'react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'

/** Short git SHA + build time of the code this browser tab is running. */
export function BuildStamp({ className }: { className?: string }) {
  const time = __BUILD_TIME__.slice(0, 16).replace('T', ' ')
  return (
    <p className={cn('tnum px-2 text-[10px] leading-tight text-muted-foreground', className)} title={`Build ${__BUILD_SHA__} at ${__BUILD_TIME__}`}>
      Build <span className="font-mono">{__BUILD_SHA__}</span>
      <br />
      {time} UTC
    </p>
  )
}

/**
 * GitHub Pages serves index.html with a 10-minute cache and an open tab never re-reads it, so a tab
 * can keep running an old build. Compare the embedded SHA with version.json whenever the tab regains focus.
 */
export function UpdateNotifier() {
  useEffect(() => {
    if (__BUILD_SHA__ === 'dev') return
    let shown = false
    const check = async () => {
      if (shown) return
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const latest = (await res.json()) as { sha?: string }
        if (latest.sha && latest.sha !== __BUILD_SHA__) {
          shown = true
          toast.info('A new version is available', {
            description: `You are on ${__BUILD_SHA__}; latest is ${latest.sha}.`,
            duration: Infinity,
            action: { label: 'Reload', onClick: () => window.location.reload() },
          })
        }
      } catch {
        /* offline or blocked: ignore */
      }
    }
    void check()
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void check(), 5 * 60 * 1000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [])
  return null
}
