-- 74_dashboard_phase1.sql -- Dashboard (phase 1): date ranges (month / quarter / semester / from-to), YTD sales, visits chart, sales chart.
-- Everything is computed live. Admin only. Ranges aggregate numerators and denominators (never an average of monthly percentages).

-- ===== 1) KPI building blocks per month (the front end sums months and divides) ====================================
create or replace function dash_kpi_months(p_from date, p_to date, p_line smallint default null) returns table (
  month date, reps int, list_doctors int, covered_doctors int, total_visits int, valid_visits int, planned_visits int, direct_visits int,
  visits_am int, visits_pm int, pharmacy_visits int, days_am int, days_pm int, missing_am int, missing_pm int,
  leave_days int, ow_days int, activity_days int, expected_visits numeric)
language sql stable security definer set search_path = public as $$
  select k.month, count(*)::int, sum(k.list_doctors)::int, sum(k.covered_doctors)::int, sum(k.total_visits)::int, sum(k.valid_visits)::int,
         sum(k.planned_visits)::int, sum(k.direct_visits)::int, sum(k.visits_am)::int, sum(k.visits_pm)::int, sum(k.pharmacy_visits)::int,
         sum(k.days_am)::int, sum(k.days_pm)::int, sum(k.missing_am)::int, sum(k.missing_pm)::int,
         sum(k.leave_days)::int, sum(k.ow_days)::int, sum(k.activity_days)::int, sum(k.expected_visits)
    from v_kpi_rep k
   where is_admin() and k.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
     and (p_line is null or k.line_id = p_line)
   group by k.month order by k.month;
$$;

-- ===== 2) YTD sales: January of the year -> last month with sales (not after p_to) ==================================
create or replace function dash_sales_ytd(p_to date, p_line smallint default null) returns table (
  ytd_month date, year_start date, s_value numeric, s_units numeric, t_value numeric, t_units numeric, ach numeric)
language sql stable security definer set search_path = public as $$
  with last as (select max(s.month) as m from sales s where s.month <= date_trunc('month', p_to)::date)
  select last.m, date_trunc('year', last.m)::date, coalesce(sum(s.s_value),0), coalesce(sum(s.s_units),0),
         coalesce(sum(s.t_value),0), coalesce(sum(s.t_units),0), round(sum(s.s_value) / nullif(sum(s.t_value),0), 4)
    from last
    left join sales s on s.month between date_trunc('year', last.m)::date and last.m
    left join territories t on t.id = s.territory_id
   where is_admin() and last.m is not null and (p_line is null or t.line_id = p_line)
   group by last.m;
$$;

-- ===== 3) Visits per month: company total = AM + PM + Pharmacy (a double visit counts once) ==========================
-- p_specialities: doctor speciality ids (empty / null = all). A speciality filter keeps only visits to doctors with that speciality
-- (pharmacy visits have no speciality, so they drop out when a speciality is chosen).
create or replace function dash_visits_monthly(p_from date, p_to date, p_line smallint default null, p_specialities int[] default null)
returns table (month date, am int, pm int, pharmacy int, total int)
language sql stable security definer set search_path = public as $$
  with v as (
    select date_trunc('month', v.visit_date)::date as month, v.shift_group, v.visit_key
      from visits v
      left join territories t on t.id = v.territory_id
      left join doctors d on d.id = v.doctor_id
     where v.visit_date between date_trunc('month', p_from)::date and month_end(date_trunc('month', p_to)::date)
       and (p_line is null or t.line_id = p_line)
       and (p_specialities is null or cardinality(p_specialities) = 0 or d.speciality_id = any(p_specialities)))
  select month, count(distinct visit_key) filter (where shift_group = 'AM')::int, count(distinct visit_key) filter (where shift_group = 'PM')::int,
         count(distinct visit_key) filter (where shift_group = 'PHARMACY')::int, count(distinct visit_key)::int
    from v where is_admin() group by month order by month;
$$;

-- ===== 4) Sales per month, grouped by line / manager / total, filtered by product =====================================
-- Returns value AND units (the front end switches without calling again). p_products: product ids (empty / null = all).
create or replace function dash_sales_series(p_from date, p_to date, p_group text default 'total', p_line smallint default null, p_products int[] default null)
returns table (month date, grp_id int, grp_name text, s_value numeric, s_units numeric, t_value numeric, t_units numeric)
language sql stable security definer set search_path = public as $$
  select s.month,
         case p_group when 'line' then t.line_id::int when 'manager' then coalesce(om.manager_id, 0) else 0 end,
         case p_group when 'line' then coalesce(ln.name, '-') when 'manager' then coalesce(mg.name, 'Vacant manager') else 'Company' end,
         sum(s.s_value), sum(s.s_units), sum(s.t_value), sum(s.t_units)
    from sales s
    join territories t on t.id = s.territory_id
    left join lines ln on ln.id = t.line_id
    left join org_month om on om.month = s.month and om.territory_id = s.territory_id
    left join managers mg on mg.id = om.manager_id
   where is_admin() and s.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
     and (p_line is null or t.line_id = p_line)
     and (p_products is null or cardinality(p_products) = 0 or s.product_id = any(p_products))
   group by 1, 2, 3 order by 3, 1;
$$;

do $$ declare f text; begin
  foreach f in array array['dash_kpi_months(date,date,smallint)','dash_sales_ytd(date,smallint)',
    'dash_visits_monthly(date,date,smallint,int[])','dash_sales_series(date,date,text,smallint,int[])'] loop
    execute 'revoke execute on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop; end $$;
