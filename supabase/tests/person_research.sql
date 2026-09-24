begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(6);
select has_table('public','person_research_runs','person research is stored separately from frozen reports');
select ok(not has_table_privilege('anon','public.person_research_runs','select'),'anonymous cannot read person research');
select ok(not has_table_privilege('authenticated','public.person_research_runs','select'),'direct authenticated callers cannot bypass organization scoping');
select ok(has_table_privilege('service_role','public.person_research_runs','select'),'server can serve authorized saved research');
select throws_ok($$insert into public.person_research_runs(id,organization_id,report_version_id,member_key,status)
values ('00000000-0000-4000-8000-000000009801','00000000-0000-4000-8000-000000009802','00000000-0000-4000-8000-000000009803','test','running')$$,
'P0001','person research requires an exact report in the same organization','cross-organization or missing report cannot accept research');
select has_trigger('public','person_research_runs','guard_person_research','research completion guard installed');
select * from finish();
rollback;
