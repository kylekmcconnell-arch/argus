-- Adversarial regression test for the tenant-integrity migration family.
-- Run after the canonical migrations with psql -v ON_ERROR_STOP=1.

begin;

create or replace function pg_temp.expect_fk(label text, statement text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
  exception when foreign_key_violation then
    return;
  end;
  raise exception '% unexpectedly succeeded', label;
end;
$$;

create or replace function pg_temp.expect_error(label text, statement text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
  exception when others then
    return;
  end;
  raise exception '% unexpectedly succeeded', label;
end;
$$;

insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-000000000002', 'tenant-two', 'Tenant Two');

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000102');

insert into public.argus_members (user_id, organization_id, role, display_name) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'owner', 'Tenant One Owner'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 'owner', 'Tenant Two Owner');

insert into public.cases (id, organization_id, kind, canonical_ref, display_query) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 'token', '0x1111111111111111111111111111111111111111', '$ONE'),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000002', 'token', '0x2222222222222222222222222222222222222222', '$TWO'),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', 'token', '0x3333333333333333333333333333333333333333', '$THREE');

insert into public.report_versions (
  id, case_id, organization_id, version, payload, contributor_label
) values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', 1, '{"address":"0x1111111111111111111111111111111111111111"}', 'anonymous'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000002', 1, '{"address":"0x2222222222222222222222222222222222222222"}', 'anonymous'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', 1, '{"address":"0x3333333333333333333333333333333333333333"}', 'anonymous');

-- Every child accepts a coherent same-tenant reference.
insert into public.evidence_items (organization_id, report_version_id, evidence_key)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', 'positive-evidence');
insert into public.check_runs (organization_id, report_version_id, check_id, state)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', 'positive-check', 'complete');
insert into public.case_events (organization_id, case_id, report_version_id, event_type)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 'test.positive');
insert into public.report_cost_lines (organization_id, report_version_id, provider, operation, calls, usd)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000301', 'test', 'positive', 1, 0);
insert into public.usage_events (organization_id, user_id, event_type)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'test.positive');

-- Cross-tenant and cross-case pairings must fail even for service-role writes.
select pg_temp.expect_fk('evidence tenant mismatch', $sql$
  insert into public.evidence_items (organization_id, report_version_id, evidence_key)
  values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000301', 'bad-evidence')
$sql$);
select pg_temp.expect_fk('check tenant mismatch', $sql$
  insert into public.check_runs (organization_id, report_version_id, check_id, state)
  values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000301', 'bad-check', 'complete')
$sql$);
select pg_temp.expect_fk('event tenant mismatch', $sql$
  insert into public.case_events (organization_id, case_id, report_version_id, event_type)
  values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000301', 'test.bad')
$sql$);
select pg_temp.expect_fk('event case mismatch', $sql$
  insert into public.case_events (organization_id, case_id, report_version_id, event_type)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000303', 'test.bad')
$sql$);
select pg_temp.expect_error('share tenant mismatch', $sql$
  insert into public.share_links (organization_id, report_version_id, token_hash, revoked_at)
  values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000301', 'bad-share', now())
$sql$);
select pg_temp.expect_fk('cost tenant mismatch', $sql$
  insert into public.report_cost_lines (organization_id, report_version_id, provider, operation, calls, usd)
  values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000301', 'test', 'bad-cost', 1, 0)
$sql$);
select pg_temp.expect_fk('projection tenant mismatch', $sql$
  insert into public.reports (organization_id, ref, kind, payload, report_version_id)
  values ('00000000-0000-4000-8000-000000000002', 'bad-projection', 'alert', '{}', '00000000-0000-4000-8000-000000000301')
$sql$);
select pg_temp.expect_fk('usage membership mismatch', $sql$
  insert into public.usage_events (organization_id, user_id, event_type)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102', 'test.bad')
$sql$);

-- The legacy global report index is gone: identical artifacts can exist in two
-- organizations while the composite tenant key still prevents local duplicates.
insert into public.reports (organization_id, ref, kind, payload) values
  ('00000000-0000-4000-8000-000000000001', 'same-subject', 'augmentation', '{}'),
  ('00000000-0000-4000-8000-000000000002', 'same-subject', 'augmentation', '{}');

-- Exercise the intended partial SET NULL and cascade actions on a disposable
-- version that is not an active case-report projection.
insert into public.evidence_items (organization_id, report_version_id, evidence_key)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000303', 'delete-evidence');
insert into public.check_runs (organization_id, report_version_id, check_id, state)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000303', 'delete-check', 'complete');
insert into public.case_events (organization_id, case_id, report_version_id, event_type)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000303', 'test.delete');
insert into public.share_links (organization_id, report_version_id, token_hash, revoked_at)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000303', 'delete-share', now());
insert into public.report_cost_lines (organization_id, report_version_id, provider, operation, calls, usd)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000303', 'test', 'delete-cost', 1, 0);
insert into public.reports (organization_id, ref, kind, payload, report_version_id)
values ('00000000-0000-4000-8000-000000000001', 'delete-projection', 'alert', '{}', '00000000-0000-4000-8000-000000000303');

delete from public.report_versions
where id = '00000000-0000-4000-8000-000000000303';

do $assert_delete_actions$
begin
  if exists (select 1 from public.evidence_items where evidence_key = 'delete-evidence')
     or exists (select 1 from public.check_runs where check_id = 'delete-check')
     or exists (select 1 from public.share_links where token_hash = 'delete-share')
     or exists (select 1 from public.report_cost_lines where operation = 'delete-cost') then
    raise exception 'version child cascade failed';
  end if;
  if not exists (
    select 1 from public.case_events
    where event_type = 'test.delete'
      and organization_id = '00000000-0000-4000-8000-000000000001'
      and case_id = '00000000-0000-4000-8000-000000000203'
      and report_version_id is null
  ) then
    raise exception 'case-event partial SET NULL failed';
  end if;
  if not exists (
    select 1 from public.reports
    where ref = 'delete-projection'
      and organization_id = '00000000-0000-4000-8000-000000000001'
      and report_version_id is null
  ) then
    raise exception 'report partial SET NULL failed';
  end if;
end;
$assert_delete_actions$;

insert into public.usage_events (organization_id, user_id, event_type)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000102', 'test.member-delete');
delete from public.argus_members
where user_id = '00000000-0000-4000-8000-000000000102';

do $assert_catalog$
declare
  validated_constraints integer;
begin
  if not exists (
    select 1 from public.usage_events
    where event_type = 'test.member-delete'
      and organization_id = '00000000-0000-4000-8000-000000000002'
      and user_id is null
  ) then
    raise exception 'usage membership partial SET NULL failed';
  end if;

  select count(*) into validated_constraints
  from pg_catalog.pg_constraint
  where conname in (
    'evidence_items_organization_report_version_fkey',
    'check_runs_organization_report_version_fkey',
    'case_events_organization_case_fkey',
    'case_events_organization_case_report_version_fkey',
    'share_links_organization_report_version_fkey',
    'report_cost_lines_organization_report_version_fkey',
    'reports_organization_report_version_fkey',
    'usage_events_organization_user_fkey'
  ) and convalidated;
  if validated_constraints <> 8 then
    raise exception 'expected 8 validated tenant constraints, found %', validated_constraints;
  end if;

  if pg_catalog.to_regclass('public.reports_ref_kind_uidx') is not null then
    raise exception 'legacy global report index still exists';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.provider_cache'::regclass and relrowsecurity
  ) then
    raise exception 'provider cache RLS is disabled';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.provider_cache', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.provider_cache', 'select')
     or not pg_catalog.has_table_privilege('service_role', 'public.provider_cache', 'select,insert,update,delete') then
    raise exception 'provider cache grants are unsafe';
  end if;
end;
$assert_catalog$;

-- The statement-level cleanup trigger removes stale rows and retains live rows.
insert into public.provider_cache (cache_key, payload, expires_at) values
  ('gt:expired', '{"text":"stale"}', now() - interval '1 minute'),
  ('gj:live', '{"value":{"ok":true}}', now() + interval '1 day');

do $assert_cache_prune$
begin
  if exists (select 1 from public.provider_cache where cache_key = 'gt:expired') then
    raise exception 'expired provider cache entry was not pruned';
  end if;
  if not exists (select 1 from public.provider_cache where cache_key = 'gj:live') then
    raise exception 'live provider cache entry was pruned';
  end if;
end;
$assert_cache_prune$;

rollback;
