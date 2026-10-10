-- =====================================================================
-- SFE Hub | 09_dq_list.sql  (run NINTH)
-- Data-quality checks for the monthly list based on "Active From".
-- The month's snapshot is the source of truth; Active From is only a sanity check.
-- =====================================================================
create or replace view v_dq_list_active_from with (security_invoker = true) as
with m as (select distinct month from list_snapshot)
select l.month, l.doctor_id, l.rep_id, l.active_from, 'active_from_after_month_end'::text as issue
from list_snapshot l
where l.active_from is not null
  and l.active_from > (l.month + interval '1 month' - interval '1 day')::date
union all
-- doctor is NEW in this month's list (absent last month) but Active From is before this month
select l.month, l.doctor_id, l.rep_id, l.active_from, 'new_in_list_but_active_earlier'
from list_snapshot l
where l.active_from is not null
  and l.active_from < l.month
  and exists (select 1 from m where m.month = (l.month - interval '1 month')::date)
  and not exists (select 1 from list_snapshot p
                  where p.month = (l.month - interval '1 month')::date and p.doctor_id = l.doctor_id)
union all
select l.month, l.doctor_id, l.rep_id, l.active_from, 'active_from_missing'
from list_snapshot l where l.active_from is null;

grant select on v_dq_list_active_from to authenticated;
