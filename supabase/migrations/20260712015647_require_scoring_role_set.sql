-- A complete set of axes inside one role is not sufficient if an alternate
-- writer can omit another held role entirely. Bind the declared role set to the
-- exact role-report set before publication.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.enforce_axis_scoring_role_set()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_declared_roles jsonb;
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

  v_declared_roles := v_payload #> '{report,roles}';
  v_role_reports := v_payload #> '{report,role_reports}';
  if pg_catalog.jsonb_typeof(v_declared_roles) <> 'array'
     or pg_catalog.jsonb_array_length(v_declared_roles) not between 1 and 16
     or pg_catalog.jsonb_typeof(v_role_reports) <> 'array'
     or pg_catalog.jsonb_array_length(v_role_reports) not between 1 and 16 then
    raise exception 'strict report role sets are malformed';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_declared_roles) declared(item)
    where pg_catalog.jsonb_typeof(declared.item) <> 'string'
       or declared.item #>> '{}' !~ '^[A-Z][A-Z0-9_]{0,79}$'
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements_text(v_declared_roles) declared(role)
  ) <> (
    select pg_catalog.count(distinct declared.role)
    from pg_catalog.jsonb_array_elements_text(v_declared_roles) declared(role)
  ) then
    raise exception 'strict report declared roles are malformed or duplicated';
  end if;

  if array(
    select declared.role
    from pg_catalog.jsonb_array_elements_text(v_declared_roles) declared(role)
    order by declared.role
  ) <> array(
    select role_report.item ->> 'role'
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    order by role_report.item ->> 'role'
  ) then
    raise exception 'strict report declared roles do not match role reports';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_enforce_axis_evidence_scoring_role_set on public.reports;
create trigger reports_enforce_axis_evidence_scoring_role_set
  before insert or update on public.reports
  for each row execute function public.enforce_axis_scoring_role_set();

revoke all on function public.enforce_axis_scoring_role_set()
  from public, anon, authenticated;

commit;
