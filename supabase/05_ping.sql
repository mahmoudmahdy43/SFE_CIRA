-- =====================================================================
-- SFE Hub | 05_ping.sql  (run FIFTH)
-- Tiny public function used by the GitHub Actions keep-alive so the free
-- Supabase project never pauses. Returns only the server time. No data.
-- =====================================================================
create or replace function public.ping() returns text
language sql stable security invoker set search_path = public as $$
  select 'ok ' || now()::text
$$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;
