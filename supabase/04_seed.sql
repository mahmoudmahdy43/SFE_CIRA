-- =====================================================================
-- SFE Hub  |  04_seed.sql   (run FOURTH)
-- Base data + makes YOU an admin. Safe to run more than once.
-- Prerequisite: you already created your user in Authentication > Users.
-- =====================================================================

insert into lines (name) values ('CIRA 1'), ('CIRA 2'), ('CIRA 3')
on conflict (name) do nothing;

insert into nsms (name) values ('Botros Alfons')
on conflict (name) do nothing;

-- NSM per line (CIRA 1 = Botros Alfons; CIRA 2/3 vacant until you assign from the Personnel page)
insert into line_nsm (line_id, nsm_id, valid_from)
select l.id, case when l.name = 'CIRA 1' then (select id from nsms where name = 'Botros Alfons') end,
       date '2026-01-01'
from lines l
where not exists (select 1 from line_nsm x where x.line_id = l.id);

-- Make your account admin
insert into user_roles (user_id, role)
select id, 'admin' from auth.users where lower(email) = 'mahmoudmahdy43@gmail.com'
on conflict (user_id) do update set role = 'admin';

-- Check: should return 1 row with role = admin
select u.email, r.role from user_roles r join auth.users u on u.id = r.user_id;
