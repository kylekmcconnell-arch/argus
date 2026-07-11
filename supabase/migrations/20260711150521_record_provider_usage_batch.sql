-- Transactional batch ingestion for exact-version core provider usage.
--
-- Callers own deterministic idempotency keys. Every line is validated before
-- any write, then delegated to record_provider_usage_event so the append-only
-- ledger, replay conflict checks, and report_cost_lines projection retain one
-- canonical implementation. An exception on any line rolls the whole function
-- statement back, including events and projection updates from earlier lines.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.record_provider_usage_batch(
  p_organization_id uuid,
  p_report_version_id uuid,
  p_initiated_by uuid,
  p_lines jsonb
)
returns table (
  event_count bigint,
  calls bigint,
  usd numeric,
  succeeded_count bigint,
  failed_count bigint,
  partial_count bigint,
  cached_count bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line jsonb;
  v_line_count integer;
  v_event public.provider_usage_events;
begin
  if p_organization_id is null
     or p_report_version_id is null
     or p_initiated_by is null
     or p_lines is null
     or pg_catalog.jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'invalid provider usage batch';
  end if;

  v_line_count := pg_catalog.jsonb_array_length(p_lines);
  if v_line_count < 1 or v_line_count > 200 then
    raise exception using
      errcode = '22023',
      message = 'provider usage batch must contain between 1 and 200 lines';
  end if;

  -- Reject tenant mistakes once before walking the batch. The delegated event
  -- function repeats these checks as defense in depth for every exact version.
  if not exists (
    select 1
    from public.report_versions version
    where version.organization_id = p_organization_id
      and version.id = p_report_version_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'report version does not belong to organization';
  end if;

  if not exists (
    select 1
    from public.argus_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_initiated_by
      and member.active
      and member.role in ('owner', 'analyst')
  ) then
    raise exception using
      errcode = '42501',
      message = 'active organization analyst required for initiated_by';
  end if;

  -- Strict JSON contract: every object has exactly these seven fields. Types
  -- are checked before casts so malformed input always fails with SQLSTATE
  -- 22023 rather than leaking implementation-specific cast errors.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_lines) line(value)
    where pg_catalog.jsonb_typeof(line.value) is distinct from 'object'
       or not (
         line.value ?& array[
           'idempotency_key', 'provider', 'operation', 'calls',
           'usd', 'status', 'meta'
         ]::text[]
       )
       or line.value - array[
         'idempotency_key', 'provider', 'operation', 'calls',
         'usd', 'status', 'meta'
       ]::text[] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(line.value -> 'idempotency_key') is distinct from 'string'
       or pg_catalog.jsonb_typeof(line.value -> 'provider') is distinct from 'string'
       or pg_catalog.jsonb_typeof(line.value -> 'operation') is distinct from 'string'
       or pg_catalog.jsonb_typeof(line.value -> 'calls') is distinct from 'number'
       or pg_catalog.jsonb_typeof(line.value -> 'usd') is distinct from 'number'
       or pg_catalog.jsonb_typeof(line.value -> 'status') is distinct from 'string'
       or pg_catalog.jsonb_typeof(line.value -> 'meta') not in ('string', 'null')
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid provider usage batch line shape';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_lines) line(value)
    where pg_catalog.char_length(pg_catalog.btrim(line.value ->> 'idempotency_key')) not between 1 and 200
       or pg_catalog.btrim(line.value ->> 'idempotency_key') <> (
         'core:' || p_report_version_id::text || ':' || pg_catalog.left(
           pg_catalog.encode(
             extensions.digest(
               pg_catalog.convert_to(pg_catalog.btrim(line.value ->> 'provider'), 'UTF8')
               || pg_catalog.decode('00', 'hex')
               || pg_catalog.convert_to(pg_catalog.btrim(line.value ->> 'operation'), 'UTF8'),
               'sha256'
             ),
             'hex'
           ),
           40
         )
       )
       or pg_catalog.char_length(pg_catalog.btrim(line.value ->> 'provider')) not between 1 and 100
       or pg_catalog.char_length(pg_catalog.btrim(line.value ->> 'operation')) not between 1 and 160
       or (line.value ->> 'calls')::numeric < 0
       or (line.value ->> 'calls')::numeric > 2147483647
       or (line.value ->> 'calls')::numeric
          <> pg_catalog.trunc((line.value ->> 'calls')::numeric)
       or (line.value ->> 'usd')::numeric < 0
       or line.value ->> 'status' not in ('succeeded', 'failed', 'partial', 'cached')
       or (
         nullif(pg_catalog.btrim(line.value ->> 'meta'), '') is not null
         and pg_catalog.char_length(pg_catalog.btrim(line.value ->> 'meta')) > 500
       )
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid provider usage batch line';
  end if;

  -- A core run has one aggregate line per normalized provider/operation. The
  -- deterministic key check above cryptographically binds that identity to the
  -- exact report version; these duplicate checks make caller bugs explicit.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_lines) line(value)
    group by
      pg_catalog.btrim(line.value ->> 'provider'),
      pg_catalog.btrim(line.value ->> 'operation')
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'duplicate provider usage provider and operation in batch';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_lines) line(value)
    group by pg_catalog.btrim(line.value ->> 'idempotency_key')
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '22023',
      message = 'duplicate provider usage idempotency key in batch';
  end if;

  event_count := 0;
  calls := 0;
  usd := 0;
  succeeded_count := 0;
  failed_count := 0;
  partial_count := 0;
  cached_count := 0;

  -- Stable provider/operation/key order keeps overlapping batch writers on the
  -- same projection lock order and reduces avoidable deadlocks.
  for v_line in
    select line.value
    from pg_catalog.jsonb_array_elements(p_lines) line(value)
    order by
      pg_catalog.btrim(line.value ->> 'provider'),
      pg_catalog.btrim(line.value ->> 'operation'),
      pg_catalog.btrim(line.value ->> 'idempotency_key')
  loop
    v_event := public.record_provider_usage_event(
      p_organization_id,
      p_report_version_id,
      pg_catalog.btrim(v_line ->> 'idempotency_key'),
      pg_catalog.btrim(v_line ->> 'provider'),
      pg_catalog.btrim(v_line ->> 'operation'),
      (v_line ->> 'calls')::integer,
      (v_line ->> 'usd')::numeric,
      p_initiated_by,
      v_line ->> 'status',
      nullif(pg_catalog.btrim(v_line ->> 'meta'), '')
    );

    event_count := event_count + 1;
    calls := calls + v_event.calls;
    usd := usd + v_event.usd;
    case v_event.status
      when 'succeeded' then succeeded_count := succeeded_count + 1;
      when 'failed' then failed_count := failed_count + 1;
      when 'partial' then partial_count := partial_count + 1;
      when 'cached' then cached_count := cached_count + 1;
    end case;
  end loop;

  return next;
end;
$$;

-- Functions receive EXECUTE from PUBLIC by default. Keep this write surface
-- server-only, matching record_provider_usage_event itself.
revoke all on function public.record_provider_usage_batch(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_provider_usage_batch(uuid, uuid, uuid, jsonb)
  to service_role;

commit;
