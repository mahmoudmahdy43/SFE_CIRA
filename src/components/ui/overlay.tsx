import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { X } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '../../lib/utils'

/* ---------- Tooltip ---------- */
export const TooltipProvider = TooltipPrimitive.Provider
export function Tooltip({
  content,
  children,
  side = 'right',
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipPrimitive.Root delayDuration={200}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 animate-pop-in rounded-control border bg-popover px-2.5 py-1.5 text-xs shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* ---------- Popover ---------- */
export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export function PopoverContent({ className, ...props }: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={6}
        align="start"
        className={cn('z-50 animate-pop-in rounded-card border bg-popover p-2 shadow-pop', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

/* ---------- Dialog / Sheet ---------- */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  title,
  description,
  children,
  side,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  /** When set, renders as a Sheet sliding from that side. */
  side?: 'left' | 'right'
  className?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 border bg-popover shadow-pop',
          side === 'left' && 'inset-y-0 left-0 w-72 animate-slide-left border-y-0 border-l-0',
          side === 'right' && 'inset-y-0 right-0 w-96 max-w-full border-y-0 border-r-0',
          !side &&
            'left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 animate-pop-in rounded-card p-6',
          className,
        )}
      >
        <DialogPrimitive.Title className={cn('text-base font-semibold', side && 'sr-only')}>
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className={cn('mt-1 text-sm text-muted-foreground', !description && 'sr-only')}>
          {description ?? title}
        </DialogPrimitive.Description>
        {children}
        {!side && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 rounded-control p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/* ---------- Tabs ---------- */
export const Tabs = TabsPrimitive.Root
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex gap-1 rounded-control bg-muted p-1', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-card data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}
export const TabsContent = TabsPrimitive.Content

/* ---------- Dropdown menu ---------- */
export const DropdownMenu = DropdownPrimitive.Root
export const DropdownMenuTrigger = DropdownPrimitive.Trigger
export function DropdownMenuContent({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        className={cn('z-50 min-w-56 animate-pop-in rounded-card border bg-popover p-1.5 shadow-pop', className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  )
}
export function DropdownMenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-muted',
        className,
      )}
      {...props}
    />
  )
}
export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="-mx-1.5 my-1.5 h-px bg-border" />
}
