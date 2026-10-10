-- =====================================================================
-- SFE Hub  |  03_rls.sql   (run THIRD)
-- Roles: admin = everything | dm = own team (reps/boxes he manages) | rep = own data only
-- anon (not logged in) gets NOTHING.
-- =====================================================================

-- ---------- helper functions (SECURITY DEFINER so they bypass RLS safely) ----
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'admin')
$$;

create or replace function my_rep_id() returns int
language sql stable security definer set search_path = public as $$
  select rep_id from user_roles where user_id = auth.uid() and role = 'rep'
$$;

create or replace function my_manager_id() returns int
language sql stable security definer set search_path = public as $$
  select manager_id from user_roles where user_id = auth.uid() and role = 'dm'
$$;

-- boxes the logged-in DM manages today
create or replace function my_box_ids() returns setof int
language sql stable security definer set search_path = public as $$
  select box_id from manager_box
  where manager_id = my_manager_id() and coalesce(valid_to, 'infinity') >= current_date
$$;

-- reps the logged-in user may see (admin: all, dm: current team, rep: self)
create or replace function visible_rep_ids() returns setof int
language sql stable security definer set search_path = public as $$
  select id from reps where is_admin()
  union
  select rb.rep_id from rep_box rb
   where rb.box_id in (select my_box_ids()) and coalesce(rb.valid_to, 'infinity') >= current_date
  union
  select my_rep_id() where my_rep_id() is not null
$$;

-- ---------- grants (new tables are NOT auto-exposed in this project) ----------
revoke all on schema public from anon;
grant usage on schema public to authenticated;
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------- 1) admin: full access on every table -------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop policy if exists admin_all on public.%I', r.tablename);
    execute format('create policy admin_all on public.%I for all to authenticated
                    using (is_admin()) with check (is_admin())', r.tablename);
  end loop;
end $$;

-- ---------- 2) reference / org tables: any logged-in user can READ -------------
do $$
declare t text;
begin
  foreach t in array array['lines','nsms','line_nsm','managers','reps','boxes','territories',
        'territory_aliases','products','bricks','specialities','account_types','doctors',
        'box_territory','rep_box','manager_box','holidays','call_rate_targets']
  loop
    execute format('drop policy if exists read_all on public.%I', t);
    execute format('create policy read_all on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------- 3) rep-scoped facts: rep sees self, DM sees team, admin all --------
do $$
declare t text;
begin
  foreach t in array array['rep_month_kpi','rep_day_shift','list_snapshot','leaves','office_work','activities']
  loop
    execute format('drop policy if exists scoped_read on public.%I', t);
    execute format('create policy scoped_read on public.%I for select to authenticated
                    using (rep_id in (select visible_rep_ids()))', t);
  end loop;
end $$;

-- visits: rep rows follow the rep; manager rows are visible to that manager
drop policy if exists scoped_read on visits;
create policy scoped_read on visits for select to authenticated
  using (rep_id in (select visible_rep_ids()) or manager_id = my_manager_id());

-- ---------- 4) territory-scoped: org_month + sales ---------------------------
drop policy if exists scoped_read on org_month;
create policy scoped_read on org_month for select to authenticated
  using (rep_id = my_rep_id() or manager_id = my_manager_id());

drop policy if exists scoped_read on sales;
create policy scoped_read on sales for select to authenticated
  using (exists (select 1 from org_month o
                 where o.month = sales.month and o.territory_id = sales.territory_id
                   and (o.rep_id = my_rep_id() or o.manager_id = my_manager_id())));

-- ---------- 5) users ---------------------------------------------------------
drop policy if exists self_read on user_roles;
create policy self_read on user_roles for select to authenticated using (user_id = auth.uid());

-- upload_batches, personnel_events: admin only (admin_all policy covers it)

-- ---------- 6) lock down admin-only functions -------------------------------
-- (they also call assert_admin() internally; this is defence in depth)
revoke execute on function build_org_month(date), refresh_rep_day_shift(date),
      refresh_rep_month_kpi(date), refresh_month(date) from public, anon;
grant  execute on function build_org_month(date), refresh_rep_day_shift(date),
      refresh_rep_month_kpi(date), refresh_month(date) to authenticated;
