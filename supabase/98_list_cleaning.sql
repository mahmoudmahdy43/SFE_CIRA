-- =====================================================================
-- 98: List Cleaning report (side tab "List Cleaning").
-- One row per Target List doctor per month with the columns the managers need.
-- The checks (High / Medium / Low) run in the app (src/features/listCleaning), not here.
-- Read only: a view, nothing is changed. Safe to re-run.
-- =====================================================================

-- territories of a rep in a month (a rep can cover more than one)
create or replace view v_rep_territory_month with (security_invoker = true) as
select o.month, o.rep_id, string_agg(distinct t.name, ' + ' order by t.name) as territory
from org_month o
join territories t on t.id = o.territory_id
where o.rep_id is not null
group by o.month, o.rep_id;

create or replace view v_list_cleaning with (security_invoker = true) as
select l.month, l.line_id, ln.name as line,
       coalesce(o.manager, '') as manager, coalesce(o.box, '') as box,
       r.code as rep_code, r.name as rep_name,
       coalesce(at.name, '') as account_type,
       coalesce(d.account_name, '') as account_name, d.account_id,
       coalesce(d.doctor_name, '') as doctor_name, d.doctor_ext_id as doctor_id,
       coalesce(t.territory, '') as territory, coalesce(b.name, '') as brick,
       coalesce(sp.name, '') as speciality,
       l.doctor_id as row_id
from list_snapshot l
join doctors d on d.id = l.doctor_id
join reps r on r.id = l.rep_id
left join lines ln on ln.id = l.line_id
left join account_types at on at.id = d.account_type_id
left join specialities sp on sp.id = d.speciality_id
left join bricks b on b.id = l.brick_id
left join v_rep_org_month o on o.month = l.month and o.rep_id = l.rep_id
left join v_rep_territory_month t on t.month = l.month and t.rep_id = l.rep_id;

grant select on v_rep_territory_month, v_list_cleaning to authenticated;
notify pgrst, 'reload schema';
