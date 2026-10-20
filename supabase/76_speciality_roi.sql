-- 76_speciality_roi.sql
-- Speciality ROI: per line, a GROUP of specialities (they share the same products) -> visits to those doctors
-- vs sales of the group's products. Visits = all doctor visits (clinics + centres, AM + PM, pharmacy excluded;
-- a double visit counts once).
-- Cost per visit: default 600 EGP, editable; a new value applies from a chosen month onward (earlier months keep their value).
-- ROI = sales of the group's products / (visits x cost per visit). Everything is live, admin only.

-- ===== master data =====
create table if not exists speciality_groups (
  id serial primary key,
  line_id smallint not null references lines(id),
  name text not null,
  sort int not null default 0,
  unique (line_id, name));
create table if not exists speciality_group_members (
  group_id int not null references speciality_groups(id) on delete cascade,
  speciality_id smallint not null references specialities(id),
  primary key (group_id, speciality_id));
create table if not exists speciality_group_products (
  group_id int not null references speciality_groups(id) on delete cascade,
  product_id int not null references products(id),
  priority smallint not null default 1,
  primary key (group_id, product_id));
create table if not exists visit_cost (
  month_from date primary key check (month_from = date_trunc('month', month_from)::date),
  cost numeric not null check (cost >= 0));
insert into visit_cost(month_from, cost) values ('2026-01-01', 600) on conflict do nothing;

do $$ declare t text; begin
  foreach t in array array['speciality_groups','speciality_group_members','speciality_group_products','visit_cost'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence speciality_groups_id_seq to authenticated;

create or replace function visit_cost_for(p_month date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select c.cost from visit_cost c where c.month_from <= date_trunc('month', p_month)::date
                   order by c.month_from desc limit 1), 600);
$$;

-- set the cost from a month onward (replaces the same month if it exists)
create or replace function set_visit_cost(p_from_month date, p_cost numeric) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_cost is null or p_cost < 0 then raise exception 'bad cost'; end if;
  insert into visit_cost(month_from, cost) values (date_trunc('month', p_from_month)::date, p_cost)
  on conflict (month_from) do update set cost = excluded.cost;
  return (select count(*) from visit_cost)::int;
end $$;

-- names the map can be filled from (for the "suggest from the strategy document" step)
create or replace function speciality_map_names() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when is_admin() then jsonb_build_object(
    'specialities', (select coalesce(jsonb_agg(name order by name), '[]') from specialities),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'line', l.name) order by p.name), '[]')
                 from products p left join lines l on l.id = p.line_id)) end;
$$;

-- ===== 1) summary per group =====
create or replace function speciality_roi(p_from date, p_to date, p_line smallint default null, p_shift text default 'ALL')
returns table (line_id smallint, line_name text, group_id int, group_name text, specialities text, products text,
  list_doctors int, visits int, visits_per_doctor numeric, s_value numeric, s_units numeric, cost numeric,
  sales_per_visit numeric, roi numeric)
language sql stable security definer set search_path = public as $$
  with a as (select date_trunc('month', p_from)::date as m1, month_end(date_trunc('month', p_to)::date) as d2),
  g as (select * from speciality_groups x where p_line is null or x.line_id = p_line),
  vis as (
    select gm.group_id as gid, date_trunc('month', v.visit_date)::date as m, count(distinct v.visit_key) as n
    from visits v cross join a
    join doctors d on d.id = v.doctor_id
    join speciality_group_members gm on gm.speciality_id = d.speciality_id
    join g on g.id = gm.group_id
    join territories t on t.id = v.territory_id and t.line_id = g.line_id
    where v.visit_date between a.m1 and a.d2 and v.shift_group in ('AM','PM') and (p_shift = 'ALL' or v.shift_group = p_shift)
    group by 1, 2),
  vsum as (select gid, sum(n) as n, sum(n * visit_cost_for(m)) as cost from vis group by gid),
  sal as (
    select gp.group_id as gid, sum(s.s_value) as sv, sum(s.s_units) as su
    from sales s cross join a
    join territories t on t.id = s.territory_id
    join speciality_group_products gp on gp.product_id = s.product_id
    join g on g.id = gp.group_id and g.line_id = t.line_id
    where s.month between a.m1 and date_trunc('month', p_to)::date
    group by 1),
  lm as (select max(l.month) as m from list_snapshot l where l.month <= date_trunc('month', p_to)::date),
  lst as (
    select gm.group_id as gid, count(distinct l.doctor_id) as n
    from list_snapshot l cross join lm
    join doctors d on d.id = l.doctor_id
    join speciality_group_members gm on gm.speciality_id = d.speciality_id
    join g on g.id = gm.group_id and g.line_id = l.line_id
    where l.month = lm.m
    group by 1)
  select g.line_id, ln.name, g.id, g.name,
    (select string_agg(s.name, ' + ' order by s.name) from speciality_group_members m join specialities s on s.id = m.speciality_id where m.group_id = g.id),
    (select string_agg(p.name || ' (' || gp.priority || ')', ', ' order by gp.priority) from speciality_group_products gp join products p on p.id = gp.product_id where gp.group_id = g.id),
    coalesce(lst.n, 0)::int, coalesce(vsum.n, 0)::int,
    round(coalesce(vsum.n, 0)::numeric / nullif(lst.n, 0), 2),
    coalesce(sal.sv, 0), coalesce(sal.su, 0), coalesce(vsum.cost, 0),
    round(coalesce(sal.sv, 0) / nullif(vsum.n, 0), 0),
    round(coalesce(sal.sv, 0) / nullif(vsum.cost, 0), 2)
  from g join lines ln on ln.id = g.line_id
  left join vsum on vsum.gid = g.id
  left join sal on sal.gid = g.id
  left join lst on lst.gid = g.id
  where is_admin()
  order by ln.name, g.sort, g.name;
$$;

-- ===== 2) group by month =====
create or replace function speciality_roi_monthly(p_group int, p_from date, p_to date, p_shift text default 'ALL')
returns table (month date, visits int, s_value numeric, s_units numeric, cost numeric, sales_per_visit numeric, roi numeric)
language sql stable security definer set search_path = public as $$
  with a as (select date_trunc('month', p_from)::date as m1, month_end(date_trunc('month', p_to)::date) as d2),
  g as (select * from speciality_groups where id = p_group),
  m as (select generate_series(a.m1, date_trunc('month', p_to)::date, interval '1 month')::date as month from a),
  vis as (
    select date_trunc('month', v.visit_date)::date as mm, count(distinct v.visit_key) as n
    from visits v cross join a cross join g
    join doctors d on d.id = v.doctor_id
    join speciality_group_members gm on gm.speciality_id = d.speciality_id and gm.group_id = g.id
    join territories t on t.id = v.territory_id and t.line_id = g.line_id
    where v.visit_date between a.m1 and a.d2 and v.shift_group in ('AM','PM') and (p_shift = 'ALL' or v.shift_group = p_shift)
    group by 1),
  sal as (
    select s.month as mm, sum(s.s_value) as sv, sum(s.s_units) as su
    from sales s cross join g
    join territories t on t.id = s.territory_id and t.line_id = g.line_id
    join speciality_group_products gp on gp.product_id = s.product_id and gp.group_id = g.id
    where s.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    group by 1)
  select m.month, coalesce(vis.n, 0)::int, coalesce(sal.sv, 0), coalesce(sal.su, 0),
    coalesce(vis.n, 0) * visit_cost_for(m.month),
    round(sal.sv / nullif(vis.n, 0), 0),
    round(sal.sv / nullif(vis.n * visit_cost_for(m.month), 0), 2)
  from m left join vis on vis.mm = m.month left join sal on sal.mm = m.month
  where is_admin()
  order by m.month;
$$;

-- ===== 3) group by territory =====
create or replace function speciality_roi_territories(p_group int, p_from date, p_to date, p_shift text default 'ALL')
returns table (territory_id int, territory_name text, rep_name text, manager_name text, visits int, s_value numeric,
  cost numeric, sales_per_visit numeric, roi numeric)
language sql stable security definer set search_path = public as $$
  with a as (select date_trunc('month', p_from)::date as m1, month_end(date_trunc('month', p_to)::date) as d2),
  g as (select * from speciality_groups where id = p_group),
  vis as (
    select t.id as tid, date_trunc('month', v.visit_date)::date as mm, count(distinct v.visit_key) as n
    from visits v cross join a cross join g
    join doctors d on d.id = v.doctor_id
    join speciality_group_members gm on gm.speciality_id = d.speciality_id and gm.group_id = g.id
    join territories t on t.id = v.territory_id and t.line_id = g.line_id
    where v.visit_date between a.m1 and a.d2 and v.shift_group in ('AM','PM') and (p_shift = 'ALL' or v.shift_group = p_shift)
    group by 1, 2),
  vs as (select tid, sum(n) as n, sum(n * visit_cost_for(mm)) as cost from vis group by tid),
  sal as (
    select s.territory_id as tid, sum(s.s_value) as sv
    from sales s cross join g
    join territories t on t.id = s.territory_id and t.line_id = g.line_id
    join speciality_group_products gp on gp.product_id = s.product_id and gp.group_id = g.id
    where s.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
    group by 1),
  lastorg as (
    select distinct on (om.territory_id) om.territory_id as tid, om.rep_id, om.manager_id
    from org_month om where om.month <= date_trunc('month', p_to)::date
    order by om.territory_id, om.month desc)
  select t.id, t.name, r.name, coalesce(mg.name, 'Vacant manager'), coalesce(vs.n, 0)::int, coalesce(sal.sv, 0),
    coalesce(vs.cost, 0), round(sal.sv / nullif(vs.n, 0), 0), round(sal.sv / nullif(vs.cost, 0), 2)
  from g join territories t on t.line_id = g.line_id
  left join vs on vs.tid = t.id
  left join sal on sal.tid = t.id
  left join lastorg lo on lo.tid = t.id
  left join reps r on r.id = lo.rep_id
  left join managers mg on mg.id = lo.manager_id
  where is_admin() and (vs.n is not null or sal.sv is not null)
  order by 8 desc nulls last;
$$;

-- ===== 4) is more visiting linked with more sales? (the territory against itself, month effect removed) =====
create or replace function speciality_roi_link(p_group int, p_from date, p_to date, p_shift text default 'ALL')
returns table (lag int, n int, r numeric)
language sql stable security definer set search_path = public as $$
  with g as (select * from speciality_groups where id = p_group),
  mo as (select generate_series((date_trunc('month', p_from) - interval '1 month')::date, date_trunc('month', p_to)::date, interval '1 month')::date as month),
  vis as (
    select t.id as tid, date_trunc('month', v.visit_date)::date as mm, count(distinct v.visit_key)::numeric as n
    from visits v cross join g
    join doctors d on d.id = v.doctor_id
    join speciality_group_members gm on gm.speciality_id = d.speciality_id and gm.group_id = g.id
    join territories t on t.id = v.territory_id and t.line_id = g.line_id
    where v.visit_date between (date_trunc('month', p_from) - interval '1 month')::date and month_end(date_trunc('month', p_to)::date)
      and v.shift_group in ('AM','PM') and (p_shift = 'ALL' or v.shift_group = p_shift)
    group by 1, 2),
  sal as (
    select s.territory_id as tid, s.month as mm, sum(s.s_value) as sv
    from sales s cross join g
    join territories t on t.id = s.territory_id and t.line_id = g.line_id
    join speciality_group_products gp on gp.product_id = s.product_id and gp.group_id = g.id
    where s.month between (date_trunc('month', p_from) - interval '1 month')::date and date_trunc('month', p_to)::date
    group by 1, 2),
  b as (select sal.tid, sal.mm, sal.sv / nullif(avg(sal.sv) over (partition by sal.tid), 0) as y, coalesce(vis.n, 0) as x
        from sal left join vis on vis.tid = sal.tid and vis.mm = sal.mm where sal.sv > 0),
  lg as (select 0 as lag union all select 1),
  pr as (
    select lg.lag, y.tid, y.mm, y.y, xx.x
    from b y join lg on true
    join b xx on xx.tid = y.tid and xx.mm = (y.mm - (lg.lag || ' month')::interval)::date
    where y.mm >= date_trunc('month', p_from)::date),
  p1 as (select *, x - avg(x) over (partition by lag, tid) as xt, y - avg(y) over (partition by lag, tid) as yt from pr),
  p2 as (select *, xt - avg(xt) over (partition by lag, mm) as xw, yt - avg(yt) over (partition by lag, mm) as yw from p1)
  select lag, count(*)::int, round(corr(xw, yw)::numeric, 3)
  from p2 where is_admin() group by lag order by lag;
$$;

-- ===== 5) how much of the visits can be classified? =====
create or replace function speciality_roi_quality(p_from date, p_to date, p_line smallint default null)
returns table (line_id smallint, line_name text, doctor_visits int, no_doctor int, no_speciality int, in_groups int, classified_pct numeric)
language sql stable security definer set search_path = public as $$
  with grp as (select distinct gm.speciality_id, g.line_id from speciality_group_members gm join speciality_groups g on g.id = gm.group_id)
  select t.line_id, ln.name, count(distinct v.visit_key)::int,
    count(distinct v.visit_key) filter (where v.doctor_id is null)::int,
    count(distinct v.visit_key) filter (where v.doctor_id is not null and d.speciality_id is null)::int,
    count(distinct v.visit_key) filter (where grp.speciality_id is not null)::int,
    round(count(distinct v.visit_key) filter (where grp.speciality_id is not null)::numeric / nullif(count(distinct v.visit_key), 0), 4)
  from visits v
  join territories t on t.id = v.territory_id
  join lines ln on ln.id = t.line_id
  left join doctors d on d.id = v.doctor_id
  left join grp on grp.speciality_id = d.speciality_id and grp.line_id = t.line_id
  where is_admin() and v.shift_group in ('AM','PM')
    and v.visit_date between date_trunc('month', p_from)::date and month_end(date_trunc('month', p_to)::date)
    and (p_line is null or t.line_id = p_line)
  group by t.line_id, ln.name
  order by ln.name;
$$;

do $$ declare f text; begin
  foreach f in array array['visit_cost_for(date)','set_visit_cost(date,numeric)','speciality_map_names()','speciality_roi(date,date,smallint,text)',
    'speciality_roi_monthly(int,date,date,text)','speciality_roi_territories(int,date,date,text)','speciality_roi_link(int,date,date,text)',
    'speciality_roi_quality(date,date,smallint)'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
