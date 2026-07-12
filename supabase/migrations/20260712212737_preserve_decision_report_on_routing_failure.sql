-- Keep a prior decision-bearing projection live when a fresh person scan could
-- not resolve any role or scoring axis. The failed attempt remains an immutable
-- report version, but it is not allowed to erase or supersede the last useful
-- decision report.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.argus_is_routing_failed_report(
  p_payload jsonb,
  p_verdict text,
  p_score numeric
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    coalesce(nullif(pg_catalog.btrim(p_verdict), ''), p_payload #>> '{report,composite_verdict}') = 'INCOMPLETE'
    and p_score is null
    and coalesce(pg_catalog.jsonb_typeof(p_payload #> '{report,governing_score}'), 'null') = 'null'
    and case
      when pg_catalog.jsonb_typeof(p_payload #> '{report,roles}') = 'array'
        then pg_catalog.jsonb_array_length(p_payload #> '{report,roles}') = 0
      else false
    end
    and pg_catalog.jsonb_typeof(p_payload #> '{report,role_reports}') = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(p_payload #> '{report,role_reports}') = 'array'
            then p_payload #> '{report,role_reports}'
          else '[]'::jsonb
        end
      ) role_report(item)
      cross join lateral pg_catalog.jsonb_each(
        case
          when pg_catalog.jsonb_typeof(role_report.item -> 'axes') = 'object'
            then role_report.item -> 'axes'
          else '{}'::jsonb
        end
      ) axis(axis_id, item)
    );
$$;

create or replace function public.argus_is_decision_bearing_report(
  p_payload jsonb,
  p_verdict text,
  p_score numeric
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    coalesce(nullif(pg_catalog.btrim(p_verdict), ''), '') not in ('', 'INCOMPLETE')
    or p_score is not null
    or coalesce(nullif(pg_catalog.btrim(p_payload #>> '{report,composite_verdict}'), ''), '') not in ('', 'INCOMPLETE')
    or pg_catalog.jsonb_typeof(p_payload #> '{report,governing_score}') = 'number'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(p_payload #> '{report,role_reports}') = 'array'
            then p_payload #> '{report,role_reports}'
          else '[]'::jsonb
        end
      ) role_report(item)
      cross join lateral pg_catalog.jsonb_each(
        case
          when pg_catalog.jsonb_typeof(role_report.item -> 'axes') = 'object'
            then role_report.item -> 'axes'
          else '{}'::jsonb
        end
      ) axis(axis_id, item)
    );
$$;

-- The existing persistence RPC deliberately deletes the active projection
-- after inserting a newer immutable version. Wrap it with a transaction-local
-- marker so only the exact routing-failure case can retain a useful projection.
alter function public.persist_report_version(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric,
  text, text, jsonb, jsonb
)
  rename to persist_report_version_without_routing_failure_guard;

create or replace function public.preserve_decision_projection_on_routing_failure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('argus.routing_failed_report_write', true) = 'on'
     and public.argus_is_decision_bearing_report(old.payload, old.verdict, old.score) then
    return null;
  end if;
  return old;
end;
$$;

drop trigger if exists reports_preserve_decision_on_routing_failure on public.reports;
create trigger reports_preserve_decision_on_routing_failure
  before delete on public.reports
  for each row execute function public.preserve_decision_projection_on_routing_failure();

create or replace function public.persist_report_version(
  p_organization_id uuid,
  p_kind text,
  p_canonical_ref text,
  p_query text,
  p_created_by uuid,
  p_payload jsonb,
  p_run_id text default null,
  p_attestation_state text default 'analyst_submitted',
  p_verdict text default null,
  p_score numeric default null,
  p_completeness_state text default 'partial',
  p_methodology_version text default null,
  p_provider_snapshot jsonb default '{}'::jsonb,
  p_cost jsonb default '{}'::jsonb
)
returns table (case_id uuid, report_version_id uuid, version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_report_version_id uuid;
  v_version integer;
  v_previous_marker text;
  v_routing_failed boolean;
begin
  v_routing_failed := p_kind = 'person'
    and public.argus_is_routing_failed_report(p_payload, p_verdict, p_score);
  v_previous_marker := pg_catalog.current_setting('argus.routing_failed_report_write', true);
  perform pg_catalog.set_config(
    'argus.routing_failed_report_write',
    case when v_routing_failed then 'on' else 'off' end,
    true
  );

  select persisted.case_id, persisted.report_version_id, persisted.version
  into v_case_id, v_report_version_id, v_version
  from public.persist_report_version_without_routing_failure_guard(
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
  ) persisted
  limit 1;

  perform pg_catalog.set_config(
    'argus.routing_failed_report_write',
    coalesce(v_previous_marker, ''),
    true
  );

  if v_report_version_id is null then
    raise exception 'immutable report write returned no version';
  end if;

  return query select v_case_id, v_report_version_id, v_version;
end;
$$;

-- Defense in depth for alternate server writers: even if they call the base
-- activation RPC directly, a no-role/no-axis attempt cannot replace an existing
-- decision-bearing projection.
alter function public.activate_report_version(uuid, uuid)
  rename to activate_report_version_without_routing_failure_guard;

create or replace function public.activate_report_version(
  p_organization_id uuid,
  p_report_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.report_versions candidate
    join public.cases case_row
      on case_row.id = candidate.case_id
     and case_row.organization_id = candidate.organization_id
    join public.reports current_report
      on current_report.organization_id = candidate.organization_id
     and current_report.kind = case_row.kind
     and current_report.ref = case_row.canonical_ref
    where candidate.id = p_report_version_id
      and candidate.organization_id = p_organization_id
      and case_row.organization_id = p_organization_id
      and case_row.status = 'open'
      and not exists (
        select 1
        from public.report_versions newer
        where newer.case_id = candidate.case_id
          and newer.version > candidate.version
      )
      and public.argus_is_routing_failed_report(
        candidate.payload,
        candidate.verdict,
        candidate.score
      )
      and public.argus_is_decision_bearing_report(
        current_report.payload,
        current_report.verdict,
        current_report.score
      )
  ) then
    return;
  end if;

  perform public.activate_report_version_without_routing_failure_guard(
    p_organization_id,
    p_report_version_id
  );
end;
$$;

revoke all on function public.argus_is_routing_failed_report(jsonb, text, numeric)
  from public, anon, authenticated;
revoke all on function public.argus_is_decision_bearing_report(jsonb, text, numeric)
  from public, anon, authenticated;
revoke all on function public.preserve_decision_projection_on_routing_failure()
  from public, anon, authenticated;
revoke all on function public.persist_report_version_without_routing_failure_guard(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric,
  text, text, jsonb, jsonb
)
  from public, anon, authenticated;
revoke all on function public.activate_report_version_without_routing_failure_guard(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.persist_report_version(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric,
  text, text, jsonb, jsonb
)
  from public, anon, authenticated;
revoke all on function public.activate_report_version(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.argus_is_routing_failed_report(jsonb, text, numeric)
  to service_role;
grant execute on function public.argus_is_decision_bearing_report(jsonb, text, numeric)
  to service_role;
grant execute on function public.persist_report_version_without_routing_failure_guard(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric,
  text, text, jsonb, jsonb
)
  to service_role;
grant execute on function public.activate_report_version_without_routing_failure_guard(uuid, uuid)
  to service_role;
grant execute on function public.persist_report_version(
  uuid, text, text, text, uuid, jsonb, text, text, text, numeric,
  text, text, jsonb, jsonb
)
  to service_role;
grant execute on function public.activate_report_version(uuid, uuid)
  to service_role;

commit;
