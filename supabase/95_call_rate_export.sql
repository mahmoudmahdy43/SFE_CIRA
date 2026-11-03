-- =====================================================================
-- SFE Hub | 95_call_rate_export.sql
-- Extra per-rep numbers for the Call Rate Excel/CSV export:
--   freq_*   = Monthly Visits Target = sum of the Target Frequency of every doctor in the rep's list (by shift of the account type)
--   direct_* = Direct visits (visit_root = Direct), distinct visits, by shift (AM / PM / PHARMACY)
-- Shift of an account type follows the visits rule: A, H, AM -> AM | PC, C -> PM | P -> PHARMACY.
-- Read-only view. Run once in the SQL Editor; no refresh needed.
-- =====================================================================
create or replace view v_rep_call_extra with (security_invoker = true) as
with f as (
  select ls.month, ls.rep_id,
         coalesce(sum(ls.freq) filter (where lower(t.name) like '%hosp%' or lower(t.name) like '%am%cent%' or lower(t.name) like '%distrib%'), 0)::int as freq_am,
         coalesce(sum(ls.freq) filter (where lower(t.name) like '%clinic%'), 0)::int as freq_pm,
         coalesce(sum(ls.freq) filter (where lower(t.name) like '%pharm%'), 0)::int as freq_pharmacy
  from list_snapshot ls
  join doctors d on d.id = ls.doctor_id
  join account_types t on t.id = d.account_type_id
  where ls.rep_id is not null
  group by ls.month, ls.rep_id
),
dv as (
  select date_trunc('month', visit_date)::date as month, rep_id,
         count(distinct visit_key) filter (where shift_group = 'AM'       and lower(visit_root) = 'direct')::int as direct_am,
         count(distinct visit_key) filter (where shift_group = 'PM'       and lower(visit_root) = 'direct')::int as direct_pm,
         count(distinct visit_key) filter (where shift_group = 'PHARMACY' and lower(visit_root) = 'direct')::int as direct_pharmacy
  from visits
  where rep_id is not null
  group by 1, 2
)
select coalesce(f.month, dv.month) as month, coalesce(f.rep_id, dv.rep_id) as rep_id,
       coalesce(f.freq_am, 0) as freq_am, coalesce(f.freq_pm, 0) as freq_pm, coalesce(f.freq_pharmacy, 0) as freq_pharmacy,
       coalesce(dv.direct_am, 0) as direct_am, coalesce(dv.direct_pm, 0) as direct_pm, coalesce(dv.direct_pharmacy, 0) as direct_pharmacy
from f full join dv on dv.month = f.month and dv.rep_id = f.rep_id;

grant select on v_rep_call_extra to authenticated;
notify pgrst, 'reload schema';
