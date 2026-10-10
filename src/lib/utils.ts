import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function initials(text: string): string {
  const base = text.split('@')[0] ?? text
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2)
  return letters.toUpperCase()
}
