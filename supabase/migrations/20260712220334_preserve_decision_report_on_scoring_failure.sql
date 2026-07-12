-- Broaden the immutable report quality guard to cover scorer failures after a
-- role has already been resolved. The historical helper name is retained so
-- existing persistence and activation wrappers pick up the safer semantics
-- without another layer of wrapped RPCs.

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
    and pg_catalog.jsonb_typeof(p_payload #> '{report,roles}') = 'array'
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

revoke all on function public.argus_is_routing_failed_report(jsonb, text, numeric)
  from public, anon, authenticated;
grant execute on function public.argus_is_routing_failed_report(jsonb, text, numeric)
  to service_role;

commit;
