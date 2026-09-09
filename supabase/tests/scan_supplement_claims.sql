begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(13);
select ok((select relrowsecurity from pg_class where oid='public.scan_supplement_claims'::regclass), 'claims use RLS');
select ok(not has_table_privilege('authenticated','public.scan_supplement_claims','INSERT'), 'users cannot mint claims');
select ok(not has_function_privilege('anon','public.claim_scan_supplement(uuid,uuid,text,text,text)','EXECUTE'), 'anonymous RPC denied');
select ok(not has_function_privilege('authenticated','public.claim_scan_supplement(uuid,uuid,text,text,text)','EXECUTE'), 'user RPC denied');
select ok(has_function_privilege('service_role','public.claim_scan_supplement(uuid,uuid,text,text,text)','EXECUTE'), 'service can claim');
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000099','missing-run','/api/social-activity','0x1111111111111111111111111111111111111111'),false,'unknown reservation cannot bypass quota');
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000099','missing-run','/api/find-wallet','anything'),false,'unscoped route cannot bypass quota');

insert into public.organizations (id, slug, name) values ('00000000-0000-4000-8000-000000009301','supplement-test','Supplement test');
insert into auth.users (id,email) values ('00000000-0000-4000-8000-000000009302','supplement-test@argus.test');
insert into public.argus_members(user_id,organization_id,role,display_name) values ('00000000-0000-4000-8000-000000009302','00000000-0000-4000-8000-000000009301','owner','Test');
insert into public.scan_run_receipts(organization_id,run_key,initiated_by,route,kind,canonical_ref,display_query,status,started_at,credits_charged_millis)
values ('00000000-0000-4000-8000-000000009301','supplement-test-run','00000000-0000-4000-8000-000000009302','/app/scan','token','0x1111111111111111111111111111111111111111','TEST','running',now(),1000);
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009302','supplement-test-run','/api/social-activity','0x2222222222222222222222222222222222222222'),false,'different subject denied');
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000009399','00000000-0000-4000-8000-000000009302','supplement-test-run','/api/social-activity','0x1111111111111111111111111111111111111111'),false,'different workspace denied');
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009399','supplement-test-run','/api/social-activity','0x1111111111111111111111111111111111111111'),false,'different user denied');
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009302','supplement-test-run','/api/social-activity','0x1111111111111111111111111111111111111111'),true,'paid matching run admitted once');
select is(public.claim_scan_supplement('00000000-0000-4000-8000-000000009301','00000000-0000-4000-8000-000000009302','supplement-test-run','/api/social-activity','0x1111111111111111111111111111111111111111'),false,'replay denied');
select is((select status from public.scan_run_receipts where run_key='supplement-test-run'),'running','admission preserves immutable run state');
select * from finish();
rollback;
