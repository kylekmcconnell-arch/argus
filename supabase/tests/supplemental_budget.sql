begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(11);
select ok(not has_function_privilege('authenticated', 'public.reserve_supplemental_budget(uuid,uuid,text,integer,integer)', 'execute'), 'browser cannot reserve server budget');
select ok(not has_function_privilege('anon', 'public.reserve_supplemental_budget(uuid,uuid,text,integer,integer)', 'execute'), 'anonymous cannot reserve server budget');
insert into public.organizations (id,slug,name) values ('00000000-0000-4000-8000-000000009101','budget-test','Budget Test');
insert into auth.users (id,email) values ('00000000-0000-4000-8000-000000009102','budget1@argus.test'),('00000000-0000-4000-8000-000000009103','budget2@argus.test');
insert into public.argus_members (user_id,organization_id,role,display_name) values
('00000000-0000-4000-8000-000000009102','00000000-0000-4000-8000-000000009101','analyst','First'),
('00000000-0000-4000-8000-000000009103','00000000-0000-4000-8000-000000009101','owner','Second');
select is((select allowed from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009102','/api/ask',1)),true,'first workspace request allowed');
select is((select allowed from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009103','/api/arkham',1)),false,'another user and route cannot evade workspace limit');
select is((select count(*)::integer from usage_events where organization_id='00000000-0000-4000-8000-000000009101' and event_type='supplemental.request'),1,'denied calls do not consume units');
select throws_ok($$select * from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009104','/api/ask',100)$$,'P0001','active investigator membership required','membership required');
-- One analyst must not be able to spend the whole workspace day (#356).
-- A denied reservation inserts nothing, so these probes do not disturb state.
select is((select allowed from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009102','/api/ask',100,1)),false,'an analyst at their own cap is stopped while the workspace has budget left');
select is((select reason from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009102','/api/ask',100,1)),'user_daily_limit','the analyst cap names itself');
select is((select allowed from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009103','/api/ask',100,1)),true,'a colleague still has their own share of the workspace day');
select is((select reason from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009103','/api/ask',100,1)),'user_daily_limit','the colleague is capped in turn');
select is((select allowed from public.reserve_supplemental_budget('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009103','/api/ask',100,null)),true,'no configured per-user cap keeps the previous behaviour');

select * from finish();
rollback;
