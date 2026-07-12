-- Follow-up defense for missing JSON keys. SQL three-valued logic can turn a
-- missing key into NULL rather than TRUE in a type inequality, so require every
-- decision-bearing axis field explicitly at a separate trigger boundary.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.enforce_axis_scoring_required_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_role_reports jsonb;
begin
  if new.report_version_id is null then
    return new;
  end if;

  select version_row.payload
  into v_payload
  from public.report_versions version_row
  where version_row.id = new.report_version_id
    and version_row.organization_id = new.organization_id
  limit 1;

  if v_payload is null or not (v_payload ? 'axisCitationVersion') then
    return new;
  end if;
  if pg_catalog.jsonb_typeof(v_payload -> 'axisCitationVersion') <> 'number'
     or v_payload ->> 'axisCitationVersion' <> '1' then
    raise exception 'unsupported axis citation version';
  end if;

  v_role_reports := v_payload #> '{report,role_reports}';
  if pg_catalog.jsonb_typeof(v_role_reports) <> 'array' then
    raise exception 'strict report role reports are malformed';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    where not (axis.item ?& array[
      'score', 'weight', 'rationale', 'role',
      'evidenceRefs', 'counterEvidenceRefs', 'gaps'
    ]::text[])
       or coalesce(pg_catalog.jsonb_typeof(axis.item -> 'score'), '') <> 'number'
       or coalesce(pg_catalog.jsonb_typeof(axis.item -> 'weight'), '') <> 'number'
       or coalesce(pg_catalog.jsonb_typeof(axis.item -> 'rationale'), '') <> 'string'
       or coalesce(pg_catalog.jsonb_typeof(axis.item -> 'role'), '') <> 'string'
  ) then
    raise exception 'strict report axis is missing a required scoring field';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_enforce_axis_evidence_scoring_required_fields on public.reports;
create trigger reports_enforce_axis_evidence_scoring_required_fields
  before insert or update on public.reports
  for each row execute function public.enforce_axis_scoring_required_fields();

revoke all on function public.enforce_axis_scoring_required_fields()
  from public, anon, authenticated;

commit;
