-- =====================================================================
-- SFE Hub | 12_holiday_shift.sql  (run TWELFTH)
-- Holidays can be a full day or only the AM / PM shift.
-- =====================================================================
alter table holidays add column if not exists shift text not null default 'FULL'
  check (shift in ('FULL','AM','PM'));
alter table holidays drop constraint if exists holidays_pkey;
alter table holidays add primary key (day, shift);

create or replace function working_days(p_shift text, p_from date, p_to date)
returns table(day date)
language sql stable set search_path = public as $$
  select d::date
  from generate_series(p_from, p_to, interval '1 day') d
  where extract(isodow from d) <> 5
    and (p_shift = 'AM' or extract(isodow from d) <> 4)
    and not exists (select 1 from holidays h
                    where h.day = d::date and (h.shift = 'FULL' or h.shift = p_shift))
$$;
