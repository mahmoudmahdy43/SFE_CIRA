import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const missingEnv: string[] = [
  ...(url ? [] : ['VITE_SUPABASE_URL']),
  ...(anonKey ? [] : ['VITE_SUPABASE_ANON_KEY']),
]

// When env vars are missing, App renders an error screen instead of using this client.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://invalid.local',
  anonKey ?? 'missing',
)
