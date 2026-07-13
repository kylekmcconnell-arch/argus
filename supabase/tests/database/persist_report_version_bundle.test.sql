-- Executable database contract for the atomic immutable-report bundle RPC.
-- Supabase's pgTAP runner executes this file against a migrated local Postgres
-- instance and rolls the transaction back, so the gate never leaves fixtures.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(17);

insert into public.organizations (id, slug, name)
values (
  '9f3a4c50-8a6b-4d3f-9e7a-000000000001',
  'report-bundle-postgres-gate',
  'Report Bundle Postgres Gate'
);

create or replace function pg_temp.invoke_report_bundle(
  p_ref text,
  p_run_id text,
  p_evidence_artifact text,
  p_axis_artifact text,
  p_evidence_title text,
  p_check_id text
)
returns table (
  case_id uuid,
  report_version_id uuid,
  version integer,
  evidence_count integer,
  check_count integer,
  axis_evidence_count integer
)
language sql
volatile
as $gate$
  select *
  from public.persist_report_version_bundle(
    '9f3a4c50-8a6b-4d3f-9e7a-000000000001',
    'site',
    p_ref,
    'https://' || p_ref || '.example',
    null,
    '{"gate":"persist_report_version_bundle"}'::jsonb,
    p_run_id,
    'analyst_submitted',
    'CAUTION',
    62,
    'partial',
    'postgres-gate-v1',
    '{"postgresGate":true}'::jsonb,
    '{"usd":0}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'evidence_key', p_evidence_artifact,
      'provider', 'postgres-gate',
      'source_type', 'official',
      'source_url', 'https://example.com/postgres-gate-evidence',
      'title', p_evidence_title,
      'excerpt', 'Exact provenance child written by the executable Postgres gate.',
      'published_at', '2026-07-13T00:00:00Z',
      'captured_at', '2026-07-13T00:01:00Z',
      'content_hash', 'sha256:postgres-gate',
      'confidence', 0.98,
      'metadata', '{}'::jsonb
    )),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'check_id', p_check_id,
      'provider', 'postgres-gate',
      'state', 'complete',
      'source_count', 1,
      'started_at', '2026-07-13T00:00:00Z',
      'finished_at', '2026-07-13T00:01:00Z',
      'stale_at', null,
      'error_code', null,
      'error_detail', null,
      'metadata', '{}'::jsonb
    )),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role', 'FOUNDER',
      'axis_id', 'F1_identity_verifiability',
      'artifact_id', p_axis_artifact,
      'relation', 'support',
      'ordinal', 0
    ))
  );
$gate$;

-- Execute a statement inside an exception subtransaction and expose the exact
-- SQLSTATE. Any writes performed by a failing RPC call are rolled back before
-- this helper returns, which lets the assertions below prove no residue.
create or replace function pg_temp.capture_sqlstate(p_statement text)
returns text
language plpgsql
as $gate$
begin
  execute p_statement;
  return null;
exception when others then
  return sqlstate;
end;
$gate$;

select ok(
  pg_catalog.to_regprocedure(
    'public.persist_report_version_bundle(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)'
  ) is not null,
  'atomic report bundle RPC exists in the migrated database'
);

select ok(
  not (
    select procedure.prosecdef
    from pg_catalog.pg_proc procedure
    where procedure.oid = pg_catalog.to_regprocedure(
      'public.persist_report_version_bundle(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)'
    )
  ),
  'bundle RPC executes as SECURITY INVOKER'
);

select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.persist_report_version_bundle(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  ),
  'service role can execute the bundle RPC'
);

select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.persist_report_version_bundle(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.persist_report_version_bundle(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'execute'
  ),
  'browser-facing roles cannot execute the bundle RPC'
);

create temporary table successful_bundle as
select *
from pg_temp.invoke_report_bundle(
  'report-bundle-success',
  'report-bundle-success-v1',
  'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Executable persistence gate',
  'bundle.success.check'
);

select ok(
  (
    select version = 1
       and evidence_count = 1
       and check_count = 1
       and axis_evidence_count = 1
    from successful_bundle
  ),
  'first call returns the exact version and materialized child counts'
);

select is(
  (
    select pg_catalog.count(*)
    from public.report_versions version_row
    join public.cases case_row on case_row.id = version_row.case_id
    where case_row.organization_id = '9f3a4c50-8a6b-4d3f-9e7a-000000000001'
      and case_row.canonical_ref = 'report-bundle-success'
      and version_row.run_id = 'report-bundle-success-v1'
  ),
  1::bigint,
  'parent case and immutable report version are inserted once'
);

select ok(
  exists (
    select 1
    from public.evidence_items evidence
    join successful_bundle result on result.report_version_id = evidence.report_version_id
    where evidence.evidence_key = 'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and evidence.provider = 'postgres-gate'
      and evidence.title = 'Executable persistence gate'
      and evidence.confidence = 0.98
      and evidence.metadata = '{}'::jsonb
  ),
  'evidence child is inserted with its decision-bearing fields intact'
);

select ok(
  exists (
    select 1
    from public.check_runs check_run
    join successful_bundle result on result.report_version_id = check_run.report_version_id
    where check_run.check_id = 'bundle.success.check'
      and check_run.provider = 'postgres-gate'
      and check_run.state = 'complete'
      and check_run.source_count = 1
      and check_run.metadata = '{}'::jsonb
  ),
  'provider check child is inserted with its state and source count intact'
);

select ok(
  exists (
    select 1
    from public.report_axis_evidence link
    join successful_bundle result on result.report_version_id = link.report_version_id
    where link.role = 'FOUNDER'
      and link.axis_id = 'F1_identity_verifiability'
      and link.artifact_id = 'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and link.relation = 'support'
      and link.ordinal = 0
  ),
  'axis-to-evidence link is inserted and points at the persisted artifact'
);

create temporary table replayed_bundle as
select *
from pg_temp.invoke_report_bundle(
  'report-bundle-success',
  'report-bundle-success-v1',
  'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'Executable persistence gate',
  'bundle.success.check'
);

select ok(
  (
    select replay.report_version_id = original.report_version_id
       and replay.case_id = original.case_id
       and replay.version = original.version
    from replayed_bundle replay
    cross join successful_bundle original
  ),
  'same run ID replays to the exact immutable parent'
);

select ok(
  (
    select evidence_count = 1 and check_count = 1 and axis_evidence_count = 1
    from replayed_bundle
  ),
  'idempotent replay returns the original child counts'
);

select ok(
  (
    select pg_catalog.count(*) = 1
    from public.report_versions version_row
    join successful_bundle result on result.report_version_id = version_row.id
  )
  and (
    select pg_catalog.count(*) = 1
    from public.evidence_items evidence
    join successful_bundle result on result.report_version_id = evidence.report_version_id
  )
  and (
    select pg_catalog.count(*) = 1
    from public.check_runs check_run
    join successful_bundle result on result.report_version_id = check_run.report_version_id
  )
  and (
    select pg_catalog.count(*) = 1
    from public.report_axis_evidence link
    join successful_bundle result on result.report_version_id = link.report_version_id
  ),
  'idempotent replay creates no duplicate parent or provenance rows'
);

select is(
  pg_temp.capture_sqlstate($statement$
    select *
    from pg_temp.invoke_report_bundle(
      'report-bundle-success',
      'report-bundle-success-v1',
      'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'art_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'Changed immutable title',
      'bundle.success.check'
    )
  $statement$),
  '40001',
  'same run ID with changed child content fails closed'
);

select ok(
  exists (
    select 1
    from public.evidence_items evidence
    join successful_bundle result on result.report_version_id = evidence.report_version_id
    where evidence.title = 'Executable persistence gate'
  )
  and not exists (
    select 1
    from public.evidence_items evidence
    join successful_bundle result on result.report_version_id = evidence.report_version_id
    where evidence.title = 'Changed immutable title'
  ),
  'failed changed-content replay cannot mutate the frozen evidence row'
);

select is(
  pg_temp.capture_sqlstate($statement$
    select *
    from pg_temp.invoke_report_bundle(
      'report-bundle-atomic-failure',
      'report-bundle-atomic-failure-v1',
      'art_v1_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'art_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'This evidence must roll back',
      'bundle.atomic.check'
    )
  $statement$),
  '23503',
  'broken axis reference fails after parent and earlier children were attempted'
);

select ok(
  not exists (
    select 1
    from public.cases case_row
    where case_row.organization_id = '9f3a4c50-8a6b-4d3f-9e7a-000000000001'
      and case_row.canonical_ref = 'report-bundle-atomic-failure'
  )
  and not exists (
    select 1
    from public.report_versions version_row
    where version_row.organization_id = '9f3a4c50-8a6b-4d3f-9e7a-000000000001'
      and version_row.run_id = 'report-bundle-atomic-failure-v1'
  ),
  'failed bundle statement rolls back its case and immutable report parent'
);

select ok(
  not exists (
    select 1
    from public.evidence_items evidence
    where evidence.organization_id = '9f3a4c50-8a6b-4d3f-9e7a-000000000001'
      and evidence.evidence_key = 'art_v1_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  )
  and not exists (
    select 1
    from public.check_runs check_run
    where check_run.organization_id = '9f3a4c50-8a6b-4d3f-9e7a-000000000001'
      and check_run.check_id = 'bundle.atomic.check'
  )
  and not exists (
    select 1
    from public.report_axis_evidence link
    where link.organization_id = '9f3a4c50-8a6b-4d3f-9e7a-000000000001'
      and link.artifact_id = 'art_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  'failed bundle statement leaves no evidence, check, or axis-link residue'
);

select * from finish();
rollback;
