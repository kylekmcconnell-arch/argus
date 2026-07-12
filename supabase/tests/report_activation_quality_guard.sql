-- Regression coverage for routing-failed immutable attempts. Run after the
-- canonical migrations with psql -v ON_ERROR_STOP=1.

begin;

insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-000000000090', 'quality-guard-test', 'Quality Guard Test');

insert into auth.users (id)
values ('00000000-0000-4000-8000-000000000091');

insert into public.argus_members (user_id, organization_id, role, display_name)
values (
  '00000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000090',
  'owner',
  'Quality Guard Test Owner'
);

create temporary table quality_guard_versions (
  label text primary key,
  report_version_id uuid not null
);

insert into quality_guard_versions (label, report_version_id)
select 'decision', persisted.report_version_id
from public.persist_report_version(
  '00000000-0000-4000-8000-000000000090',
  'person',
  'world_xyz',
  '@world_xyz',
  '00000000-0000-4000-8000-000000000091',
  '{
    "handle":"@world_xyz",
    "report":{
      "roles":["PROJECT"],
      "role_reports":[{"role":"PROJECT","axes":{"P1_team_and_identity":{"score":34}}}],
      "composite_verdict":"FAIL",
      "governing_score":34
    }
  }'::jsonb,
  'quality-guard-decision',
  'analyst_submitted',
  'FAIL',
  34,
  'partial',
  null,
  '{}'::jsonb,
  '{}'::jsonb
) persisted;

select public.activate_report_version(
  '00000000-0000-4000-8000-000000000090',
  (select report_version_id from quality_guard_versions where label = 'decision')
);

insert into quality_guard_versions (label, report_version_id)
select 'routing-failed', persisted.report_version_id
from public.persist_report_version(
  '00000000-0000-4000-8000-000000000090',
  'person',
  'world_xyz',
  '@world_xyz',
  '00000000-0000-4000-8000-000000000091',
  '{
    "handle":"@world_xyz",
    "report":{
      "roles":[],
      "role_reports":[],
      "composite_verdict":"INCOMPLETE",
      "governing_score":null
    }
  }'::jsonb,
  'quality-guard-routing-failed',
  'server_collected',
  'INCOMPLETE',
  null,
  'partial',
  null,
  '{}'::jsonb,
  '{}'::jsonb
) persisted;

-- The database activation boundary independently refuses the supersession.
select public.activate_report_version(
  '00000000-0000-4000-8000-000000000090',
  (select report_version_id from quality_guard_versions where label = 'routing-failed')
);

do $assert_routing_failure_preserved_decision$
declare
  v_decision uuid;
  v_routing_failed uuid;
  v_current uuid;
  v_version_count integer;
begin
  select report_version_id into v_decision
  from quality_guard_versions where label = 'decision';
  select report_version_id into v_routing_failed
  from quality_guard_versions where label = 'routing-failed';
  select report_version_id into v_current
  from public.reports
  where organization_id = '00000000-0000-4000-8000-000000000090'
    and kind = 'person'
    and ref = 'world_xyz';
  select pg_catalog.count(*) into v_version_count
  from public.report_versions
  where organization_id = '00000000-0000-4000-8000-000000000090';

  if v_routing_failed is null or v_routing_failed = v_decision or v_version_count <> 2 then
    raise exception 'routing-failed attempt was not saved as a distinct immutable version';
  end if;
  if v_current is distinct from v_decision then
    raise exception 'routing-failed attempt replaced the decision-bearing projection';
  end if;
end;
$assert_routing_failure_preserved_decision$;

-- A later decision-bearing report still supersedes normally.
insert into quality_guard_versions (label, report_version_id)
select 'new-decision', persisted.report_version_id
from public.persist_report_version(
  '00000000-0000-4000-8000-000000000090',
  'person',
  'world_xyz',
  '@world_xyz',
  '00000000-0000-4000-8000-000000000091',
  '{
    "handle":"@world_xyz",
    "report":{
      "roles":["PROJECT"],
      "role_reports":[{"role":"PROJECT","axes":{"P1_team_and_identity":{"score":72}}}],
      "composite_verdict":"CAUTION",
      "governing_score":72
    }
  }'::jsonb,
  'quality-guard-new-decision',
  'analyst_submitted',
  'CAUTION',
  72,
  'partial',
  null,
  '{}'::jsonb,
  '{}'::jsonb
) persisted;

select public.activate_report_version(
  '00000000-0000-4000-8000-000000000090',
  (select report_version_id from quality_guard_versions where label = 'new-decision')
);

do $assert_new_decision_activated$
begin
  if (
    select report_version_id
    from public.reports
    where organization_id = '00000000-0000-4000-8000-000000000090'
      and kind = 'person'
      and ref = 'world_xyz'
  ) is distinct from (
    select report_version_id
    from quality_guard_versions
    where label = 'new-decision'
  ) then
    raise exception 'new decision-bearing report did not activate';
  end if;
end;
$assert_new_decision_activated$;

-- Malformed JSON inputs are false, never exceptions.
do $assert_malformed_payload_is_safe$
begin
  if public.argus_is_routing_failed_report(
    '{"report":{"roles":{},"role_reports":{}}}'::jsonb,
    'INCOMPLETE',
    null
  ) then
    raise exception 'malformed role collections were classified as routing failure';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.persist_report_version_without_routing_failure_guard(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.activate_report_version_without_routing_failure_guard(uuid,uuid)',
       'execute'
     ) then
    raise exception 'unguarded report functions are exposed to public API roles';
  end if;
end;
$assert_malformed_payload_is_safe$;

rollback;
