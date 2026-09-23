begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(6);
select has_view('public', 'holder_observations', 'immutable holder observation index exists');
select ok(not has_table_privilege('anon', 'public.holder_observations', 'select'), 'anonymous callers cannot read holder history');
select ok(not has_table_privilege('authenticated', 'public.holder_observations', 'select'), 'direct authenticated reads cannot bypass API organization scoping');
select ok(has_table_privilege('service_role', 'public.holder_observations', 'select'), 'authorized server can query holder history');
insert into public.organizations (id,slug,name) values ('00000000-0000-4000-8000-000000009501','holder-history-test','Holder history');
insert into public.cases(id,organization_id,kind,canonical_ref,display_query)
values ('00000000-0000-4000-8000-000000009502','00000000-0000-4000-8000-000000009501','token','base:0x1111111111111111111111111111111111111111','Holder test');
insert into public.report_versions(case_id,organization_id,version,payload,contributor_label)
values ('00000000-0000-4000-8000-000000009502','00000000-0000-4000-8000-000000009501',1,
'{"token":{"holderIntelligence":{"version":1,"chain":"base","tokenAddress":"0x1111111111111111111111111111111111111111","rows":[{"address":"0x2222222222222222222222222222222222222222","percent":7}]}}}', 'test');
select is((select count(*) from public.holder_observations where organization_id='00000000-0000-4000-8000-000000009501'),1::bigint,'nested investigation snapshot is projected once');
select is((select observation->>'percent' from public.holder_observations where organization_id='00000000-0000-4000-8000-000000009501'),'7','original immutable observation is retained');
select * from finish();
rollback;
