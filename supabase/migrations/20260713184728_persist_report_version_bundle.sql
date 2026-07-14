-- Persist the immutable report parent and every frozen provenance child in one
-- transaction. The previous API sequence committed report_versions first and
-- wrote evidence/check lineage through later HTTP calls; a validation or
-- transport failure could therefore strand a version with no child records.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.persist_report_version_bundle(
  p_organization_id uuid,
  p_kind text,
  p_canonical_ref text,
  p_query text,
  p_created_by uuid,
  p_payload jsonb,
  p_run_id text,
  p_attestation_state text,
  p_verdict text,
  p_score numeric,
  p_completeness_state text,
  p_methodology_version text,
  p_provider_snapshot jsonb,
  p_cost jsonb,
  p_evidence_items jsonb,
  p_check_runs jsonb,
  p_axis_evidence jsonb
)
returns table (
  case_id uuid,
  report_version_id uuid,
  version integer,
  evidence_count integer,
  check_count integer,
  axis_evidence_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_report_version_id uuid;
  v_version integer;
  v_evidence jsonb;
  v_check jsonb;
  v_axis jsonb;
  v_expected_evidence_count integer;
  v_expected_check_count integer;
  v_expected_axis_count integer;
begin
  if p_evidence_items is null
     or p_check_runs is null
     or p_axis_evidence is null
     or pg_catalog.jsonb_typeof(p_evidence_items) is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_check_runs) is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_axis_evidence) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'invalid report provenance bundle';
  end if;

  v_expected_evidence_count := pg_catalog.jsonb_array_length(p_evidence_items);
  v_expected_check_count := pg_catalog.jsonb_array_length(p_check_runs);
  v_expected_axis_count := pg_catalog.jsonb_array_length(p_axis_evidence);

  if v_expected_evidence_count > 400
     or v_expected_check_count > 250
     or v_expected_axis_count > 1024 then
    raise exception using
      errcode = '22023',
      message = 'report provenance bundle exceeds bounds';
  end if;

  if pg_catalog.jsonb_typeof(p_payload -> 'checkRuns') = 'array'
     and pg_catalog.jsonb_array_length(p_payload -> 'checkRuns')
         <> v_expected_check_count then
    raise exception using
      errcode = '22023',
      message = 'payload checkRuns were not fully materialized';
  end if;

  if p_payload ->> 'axisCitationVersion' = '1'
     and (
       pg_catalog.jsonb_typeof(p_payload -> 'axisEvidenceCatalog') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'axisEvidenceCatalog')
          <> v_expected_evidence_count
     ) then
    raise exception using
      errcode = '22023',
      message = 'strict evidence catalog was not fully materialized';
  end if;

  -- Validate the service-only JSON contract before creating the parent row.
  -- Table constraints and tenant-qualified foreign keys remain the final guard.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_evidence_items) item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
       or nullif(pg_catalog.btrim(item.value ->> 'evidence_key'), '') is null
       or pg_catalog.char_length(item.value ->> 'evidence_key') > 200
       or pg_catalog.jsonb_typeof(item.value -> 'metadata') is distinct from 'object'
       or item.value - array[
         'evidence_key', 'provider', 'source_type', 'source_url', 'title',
         'excerpt', 'published_at', 'captured_at', 'content_hash',
         'confidence', 'metadata'
       ]::text[] <> '{}'::jsonb
  ) then
    raise exception using errcode = '22023', message = 'invalid evidence item bundle row';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_check_runs) item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
       or nullif(pg_catalog.btrim(item.value ->> 'check_id'), '') is null
       or pg_catalog.char_length(item.value ->> 'check_id') > 160
       or item.value ->> 'state' not in ('complete', 'partial', 'unavailable', 'failed', 'not_run')
       or pg_catalog.jsonb_typeof(item.value -> 'source_count') is distinct from 'number'
       or (item.value ->> 'source_count')::numeric < 0
       or (item.value ->> 'source_count')::numeric > 2147483647
       or (item.value ->> 'source_count')::numeric
          <> pg_catalog.trunc((item.value ->> 'source_count')::numeric)
       or pg_catalog.jsonb_typeof(item.value -> 'metadata') is distinct from 'object'
       or item.value - array[
         'check_id', 'provider', 'state', 'source_count', 'started_at',
         'finished_at', 'stale_at', 'error_code', 'error_detail', 'metadata'
       ]::text[] <> '{}'::jsonb
  ) then
    raise exception using errcode = '22023', message = 'invalid check run bundle row';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_axis_evidence) item(value)
    where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
       or item.value ->> 'role' !~ '^[A-Z][A-Z0-9_]{0,79}$'
       or item.value ->> 'axis_id' !~ '^[A-Za-z0-9_.:-]{1,160}$'
       or item.value ->> 'artifact_id' !~ '^art_v1_[a-f0-9]{64}$'
       or item.value ->> 'relation' not in ('support', 'counter')
       or pg_catalog.jsonb_typeof(item.value -> 'ordinal') is distinct from 'number'
       or (item.value ->> 'ordinal')::numeric not between 0 and 11
       or (item.value ->> 'ordinal')::numeric
          <> pg_catalog.trunc((item.value ->> 'ordinal')::numeric)
       or item.value - array[
         'role', 'axis_id', 'artifact_id', 'relation', 'ordinal'
       ]::text[] <> '{}'::jsonb
  ) then
    raise exception using errcode = '22023', message = 'invalid axis evidence bundle row';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_evidence_items) item(value)
    group by item.value ->> 'evidence_key'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_check_runs) item(value)
    group by item.value ->> 'check_id'
    having pg_catalog.count(*) > 1
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_axis_evidence) item(value)
    group by
      item.value ->> 'role',
      item.value ->> 'axis_id',
      item.value ->> 'relation',
      item.value ->> 'ordinal'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'duplicate report provenance bundle row';
  end if;

  select persisted.case_id, persisted.report_version_id, persisted.version
  into v_case_id, v_report_version_id, v_version
  from public.persist_report_version(
    p_organization_id,
    p_kind,
    p_canonical_ref,
    p_query,
    p_created_by,
    p_payload,
    p_run_id,
    p_attestation_state,
    p_verdict,
    p_score,
    p_completeness_state,
    p_methodology_version,
    p_provider_snapshot,
    p_cost
  ) persisted;

  for v_evidence in
    select item.value
    from pg_catalog.jsonb_array_elements(p_evidence_items) item(value)
    order by item.value ->> 'evidence_key'
  loop
    insert into public.evidence_items (
      organization_id,
      report_version_id,
      evidence_key,
      provider,
      source_type,
      source_url,
      title,
      excerpt,
      published_at,
      captured_at,
      content_hash,
      confidence,
      attestation_state,
      metadata
    ) values (
      p_organization_id,
      v_report_version_id,
      pg_catalog.btrim(v_evidence ->> 'evidence_key'),
      nullif(pg_catalog.btrim(v_evidence ->> 'provider'), ''),
      nullif(pg_catalog.btrim(v_evidence ->> 'source_type'), ''),
      nullif(pg_catalog.btrim(v_evidence ->> 'source_url'), ''),
      nullif(pg_catalog.btrim(v_evidence ->> 'title'), ''),
      nullif(pg_catalog.btrim(v_evidence ->> 'excerpt'), ''),
      nullif(pg_catalog.btrim(v_evidence ->> 'published_at'), '')::timestamptz,
      coalesce(
        nullif(pg_catalog.btrim(v_evidence ->> 'captured_at'), '')::timestamptz,
        now()
      ),
      nullif(pg_catalog.btrim(v_evidence ->> 'content_hash'), ''),
      nullif(pg_catalog.btrim(v_evidence ->> 'confidence'), '')::numeric,
      p_attestation_state,
      v_evidence -> 'metadata'
    )
    on conflict (report_version_id, evidence_key) do nothing;
  end loop;

  for v_check in
    select item.value
    from pg_catalog.jsonb_array_elements(p_check_runs) item(value)
    order by item.value ->> 'check_id'
  loop
    insert into public.check_runs (
      organization_id,
      report_version_id,
      check_id,
      provider,
      state,
      source_count,
      started_at,
      finished_at,
      stale_at,
      error_code,
      error_detail,
      attestation_state,
      metadata
    ) values (
      p_organization_id,
      v_report_version_id,
      pg_catalog.btrim(v_check ->> 'check_id'),
      nullif(pg_catalog.btrim(v_check ->> 'provider'), ''),
      v_check ->> 'state',
      (v_check ->> 'source_count')::integer,
      nullif(pg_catalog.btrim(v_check ->> 'started_at'), '')::timestamptz,
      nullif(pg_catalog.btrim(v_check ->> 'finished_at'), '')::timestamptz,
      nullif(pg_catalog.btrim(v_check ->> 'stale_at'), '')::timestamptz,
      nullif(pg_catalog.btrim(v_check ->> 'error_code'), ''),
      nullif(pg_catalog.btrim(v_check ->> 'error_detail'), ''),
      p_attestation_state,
      v_check -> 'metadata'
    )
    on conflict (report_version_id, check_id) do nothing;
  end loop;

  for v_axis in
    select item.value
    from pg_catalog.jsonb_array_elements(p_axis_evidence) item(value)
    order by
      item.value ->> 'role',
      item.value ->> 'axis_id',
      item.value ->> 'relation',
      (item.value ->> 'ordinal')::integer
  loop
    insert into public.report_axis_evidence (
      organization_id,
      report_version_id,
      role,
      axis_id,
      artifact_id,
      relation,
      ordinal
    ) values (
      p_organization_id,
      v_report_version_id,
      v_axis ->> 'role',
      v_axis ->> 'axis_id',
      v_axis ->> 'artifact_id',
      v_axis ->> 'relation',
      (v_axis ->> 'ordinal')::integer
    )
    on conflict (report_version_id, role, axis_id, relation, ordinal) do nothing;
  end loop;

  select pg_catalog.count(*)::integer into evidence_count
  from public.evidence_items item
  where item.organization_id = p_organization_id
    and item.report_version_id = v_report_version_id;
  select pg_catalog.count(*)::integer into check_count
  from public.check_runs run
  where run.organization_id = p_organization_id
    and run.report_version_id = v_report_version_id;
  select pg_catalog.count(*)::integer into axis_evidence_count
  from public.report_axis_evidence link
  where link.organization_id = p_organization_id
    and link.report_version_id = v_report_version_id;

  if evidence_count <> v_expected_evidence_count
     or check_count <> v_expected_check_count
     or axis_evidence_count <> v_expected_axis_count then
    raise exception using
      errcode = '23514',
      message = 'immutable report provenance materialization mismatch';
  end if;

  -- ON CONFLICT makes a run-id replay safe only when the existing child is
  -- identical. Counts cannot detect a same-key/different-content collision,
  -- especially for check_runs which are not covered by lineage certification.
  -- captured_at/created_at are persistence timestamps and are intentionally
  -- excluded; every decision-bearing and attribution field must match exactly.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_evidence_items) incoming(value)
    full join (
      select persisted.*
      from public.evidence_items persisted
      where persisted.organization_id = p_organization_id
        and persisted.report_version_id = v_report_version_id
    ) actual
      on actual.evidence_key = pg_catalog.btrim(incoming.value ->> 'evidence_key')
    where incoming.value is null
       or actual.id is null
       or actual.provider is distinct from nullif(pg_catalog.btrim(incoming.value ->> 'provider'), '')
       or actual.source_type is distinct from nullif(pg_catalog.btrim(incoming.value ->> 'source_type'), '')
       or actual.source_url is distinct from nullif(pg_catalog.btrim(incoming.value ->> 'source_url'), '')
       or actual.title is distinct from nullif(pg_catalog.btrim(incoming.value ->> 'title'), '')
       or actual.excerpt is distinct from nullif(pg_catalog.btrim(incoming.value ->> 'excerpt'), '')
       or actual.published_at is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'published_at'), '')::timestamptz
       or actual.content_hash is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'content_hash'), '')
       or actual.confidence is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'confidence'), '')::numeric
       or actual.attestation_state is distinct from p_attestation_state
       or actual.metadata is distinct from incoming.value -> 'metadata'
  ) then
    raise exception using
      errcode = '40001',
      message = 'immutable evidence item replay content mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_check_runs) incoming(value)
    full join (
      select persisted.*
      from public.check_runs persisted
      where persisted.organization_id = p_organization_id
        and persisted.report_version_id = v_report_version_id
    ) actual
      on actual.check_id = pg_catalog.btrim(incoming.value ->> 'check_id')
    where incoming.value is null
       or actual.id is null
       or actual.provider is distinct from nullif(pg_catalog.btrim(incoming.value ->> 'provider'), '')
       or actual.state is distinct from incoming.value ->> 'state'
       or actual.source_count is distinct from (incoming.value ->> 'source_count')::integer
       or actual.started_at is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'started_at'), '')::timestamptz
       or actual.finished_at is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'finished_at'), '')::timestamptz
       or actual.stale_at is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'stale_at'), '')::timestamptz
       or actual.error_code is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'error_code'), '')
       or actual.error_detail is distinct from
          nullif(pg_catalog.btrim(incoming.value ->> 'error_detail'), '')
       or actual.attestation_state is distinct from p_attestation_state
       or actual.metadata is distinct from incoming.value -> 'metadata'
  ) then
    raise exception using
      errcode = '40001',
      message = 'immutable check run replay content mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_axis_evidence) incoming(value)
    full join (
      select persisted.*
      from public.report_axis_evidence persisted
      where persisted.organization_id = p_organization_id
        and persisted.report_version_id = v_report_version_id
    ) actual
      on actual.role = incoming.value ->> 'role'
     and actual.axis_id = incoming.value ->> 'axis_id'
     and actual.relation = incoming.value ->> 'relation'
     and actual.ordinal = (incoming.value ->> 'ordinal')::integer
    where incoming.value is null
       or actual.report_version_id is null
       or actual.artifact_id is distinct from incoming.value ->> 'artifact_id'
  ) then
    raise exception using
      errcode = '40001',
      message = 'immutable axis evidence replay content mismatch';
  end if;

  case_id := v_case_id;
  report_version_id := v_report_version_id;
  version := v_version;
  return next;
end;
$$;

comment on function public.persist_report_version_bundle(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text,
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) is
  'Atomically persists one immutable report version and its evidence, check, and axis-link rows.';

revoke all on function public.persist_report_version_bundle(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text,
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.persist_report_version_bundle(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text,
  text, jsonb, jsonb, jsonb, jsonb, jsonb
) to service_role;

commit;
