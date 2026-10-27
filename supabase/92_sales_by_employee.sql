-- Run in the Supabase SQL Editor, read-only function (drop if exists + create; no data changes).
-- =====================================================================
-- SFE Hub | 92_sales_by_employee.sql
-- "Sales Analysis per Employee" report (Reports > Sales by Employee, admin only).
--
--   sales_by_employee(p_from, p_to, p_line, p_manager, p_products)
--
-- One row per month x line x direct manager x (rep | vacant box):
--   * a box that has a rep in that month (org_month.rep_id) -> one row per rep, rep_id / rep_name / rep_code filled;
--   * a box with no rep in that month -> one row per box, rep_id null, box_id / box_name / territory_names filled ("Vacant").
--   The split follows org_month month by month: the months before a rep is assigned stay on the Vacant row, the later months are on
--   the rep. History is never moved.
-- p_from / p_to are months (any day of the month), both included. p_line = line id or null, p_manager = direct manager id or null
-- (a vacant manager has manager_id null in the rows). p_products = product ids (null or empty = all products); targets follow the same
-- product filter because s_* and t_* come from the same sales rows.
-- Sales rows are the rows behind v_sales_cube (sales joined to org_month on month + territory); the function reads the base tables
-- so that the product filter does not depend on the view's columns. Admin only (is_admin()), read only, p_to is NOT exclusive here.
-- =====================================================================

drop function if exists sales_by_employee(date, date, smallint, int, int[]);

create function sales_by_employee(
  p_from date, p_to date, p_line smallint default null, p_manager int default null, p_products int[] default null)
returns table(
  month date, line_id smallint, line_name text, manager_id int, manager_name text,
  rep_id int, rep_name text, rep_code text, box_id int, box_name text, territory_names text,
  s_value numeric, s_units numeric, t_value numeric, t_units numeric)
language sql stable security definer set search_path = public as $$
  with x as (
    select s.month, t.line_id as lid, t.name as terr, om.manager_id as mid, om.rep_id as rid,
           case when om.rep_id is null then coalesce(om.box_id, 0) end as vbox,
           s.s_value, s.s_units, s.t_value, s.t_units
      from sales s
      join territories t on t.id = s.territory_id
      left join org_month om on om.month = s.month and om.territory_id = s.territory_id
     where is_admin()
       and s.month between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
       and (p_line is null or t.line_id = p_line)
       and (p_manager is null or om.manager_id = p_manager)
       and (p_products is null or cardinality(p_products) = 0 or s.product_id = any(p_products)))
  select x.month, x.lid, ln.name, x.mid, mg.name,
         x.rid, r.name, r.code, nullif(x.vbox, 0), b.name, string_agg(distinct x.terr, ', ' order by x.terr),
         coalesce(sum(x.s_value), 0), coalesce(sum(x.s_units), 0), coalesce(sum(x.t_value), 0), coalesce(sum(x.t_units), 0)
    from x
    left join lines ln on ln.id = x.lid
    left join managers mg on mg.id = x.mid
    left join reps r on r.id = x.rid
    left join boxes b on b.id = nullif(x.vbox, 0)
   group by x.month, x.lid, ln.name, x.mid, mg.name, x.rid, r.name, r.code, x.vbox, b.name
   order by x.month, x.lid, x.mid nulls last, x.rid nulls last, x.vbox nulls first
$$;
revoke execute on function sales_by_employee(date, date, smallint, int, int[]) from public, anon;
grant execute on function sales_by_employee(date, date, smallint, int, int[]) to authenticated;
