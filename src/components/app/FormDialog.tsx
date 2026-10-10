import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogClose, DialogContent } from '../ui/overlay'
import { Button } from '../ui/button'
import { Input } from '../ui/misc'

export interface ActionResult {
  message: string
  /** Date from which org + KPIs were rebuilt (shown in the notice). */
  rebuiltFrom?: string
}

/** Modal form: runs `onSubmit`, shows database errors verbatim, toasts on success. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  onDone,
  disabled,
  variant = 'primary',
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: string
  submitLabel: string
  onSubmit: () => Promise<ActionResult>
  onDone: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger'
  children: ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await onSubmit()
      toast.success(r.message, r.rebuiltFrom ? { description: `Org and KPIs were rebuilt from ${r.rebuiltFrom}.` } : undefined)
      onOpenChange(false)
      onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error'
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          onOpenChange(o)
          if (!o) setError(null)
        }
      }}
    >
      <DialogContent title={title} description={description}>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {children}
          {error && (
            <div role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button disabled={busy}>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant={variant} disabled={busy || disabled}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function DateField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="date" required value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}
