-- 84: last known location of every doctor (for the Monthly plan: put nearby doctors in the same day)
-- Rule: the doctor's LATEST visit that has a usable position decides (if a doctor moved, the newest location wins).
--   position = the rep's device position when the deviation is small (<= 300 m, i.e. the rep was really at the clinic),
--              otherwise the account's registered position. Only points inside Egypt are used.
-- Also gives the doctor's usual visit time / weekday from history (most frequent), for the plan.
create or replace view v_doctor_last_geo with (security_invoker = true) as
with g as (
  select v.doctor_id, v.visit_date, v.visit_time,
         case when v.dev_lat between 21.5 and 31.8 and v.dev_lng between 24.5 and 37
                   and coalesce(v.deviation_m, 0) <= 300 then v.dev_lat
              when v.acc_lat between 21.5 and 31.8 and v.acc_lng between 24.5 and 37 then v.acc_lat end as lat,
         case when v.dev_lat between 21.5 and 31.8 and v.dev_lng between 24.5 and 37
                   and coalesce(v.deviation_m, 0) <= 300 then v.dev_lng
              when v.acc_lat between 21.5 and 31.8 and v.acc_lng between 24.5 and 37 then v.acc_lng end as lng,
         case when v.dev_lat between 21.5 and 31.8 and v.dev_lng between 24.5 and 37
                   and coalesce(v.deviation_m, 0) <= 300 then 'device' else 'account' end as pos_source
    from visits v
   where v.doctor_id is not null and v.acc_type_code in ('C','PC')
     and (v.dev_lat is not null or v.acc_lat is not null))
select distinct on (doctor_id) doctor_id, lat, lng, pos_source, visit_date as geo_date
  from g where lat is not null and lng is not null
 order by doctor_id, visit_date desc, visit_time desc nulls last;

create or replace view v_doctor_usual_time with (security_invoker = true) as
select doctor_id,
       mode() within group (order by extract(isodow from visit_date)::int) as usual_isodow,
       mode() within group (order by to_char(date_trunc('hour', visit_time::time), 'HH24:MI')) as usual_hour,
       count(*) as n_visits, max(visit_date) as last_visit
  from visits
 where doctor_id is not null and acc_type_code in ('C','PC') and visit_time is not null
 group by doctor_id;
