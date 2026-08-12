-- Allow an analyst to share the exact immutable version they are reviewing.
-- The case must still be open and belong to the same organization; only the
-- former "latest version" restriction is removed.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

create or replace function public.enforce_open_case_share()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_locked_kind text;
  v_locked_ref text;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.report_version_id is distinct from old.report_version_id
     ) then
    raise exception 'share link case identity is immutable';
  end if;

  if new.revoked_at is not null then
    return new;
  end if;

  loop
    select c.kind, c.canonical_ref
    into v_kind, v_ref
    from public.report_versions rv
    join public.cases c on c.id = rv.case_id
    where rv.id = new.report_version_id
      and rv.organization_id = new.organization_id
      and c.organization_id = new.organization_id
    limit 1;

    if v_kind is null or v_ref is null then
      raise exception 'share link must reference a case version in the same organization';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        new.organization_id::text || ':' || v_kind || ':' || v_ref,
        0
      )
    );

    select c.kind, c.canonical_ref
    into v_locked_kind, v_locked_ref
    from public.report_versions rv
    join public.cases c on c.id = rv.case_id
    where rv.id = new.report_version_id
      and rv.organization_id = new.organization_id
      and c.organization_id = new.organization_id
    limit 1;

    if v_locked_kind is null or v_locked_ref is null then
      raise exception 'share link case disappeared while acquiring its identity lock';
    end if;
    exit when v_locked_kind = v_kind and v_locked_ref = v_ref;
    v_kind := v_locked_kind;
    v_ref := v_locked_ref;
  end loop;

  if not exists (
    select 1
    from public.report_versions rv
    join public.cases c on c.id = rv.case_id
    where rv.id = new.report_version_id
      and rv.organization_id = new.organization_id
      and c.organization_id = new.organization_id
      and c.status = 'open'
  ) then
    raise exception 'public links can only target immutable versions of active cases';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_open_case_share()
  from public, anon, authenticated;
grant execute on function public.enforce_open_case_share()
  to service_role;

commit;
