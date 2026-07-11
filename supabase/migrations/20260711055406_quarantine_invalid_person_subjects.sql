-- Quarantine impossible person identities produced by legacy token fallthrough.
-- X usernames are 1-15 ASCII letters, digits, or underscores; values outside
-- that shape must never be persisted or resolved as a person case.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

create or replace function public.enforce_case_subject_shape()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'person'
     and new.canonical_ref !~ '^[A-Za-z0-9_]{1,15}$' then
    raise exception using
      errcode = '23514',
      message = 'person case requires a valid X username';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_case_subject_shape()
  from public, anon, authenticated;
grant execute on function public.enforce_case_subject_shape()
  to service_role;

drop trigger if exists cases_enforce_subject_shape on public.cases;
create trigger cases_enforce_subject_shape
before insert or update of kind, canonical_ref on public.cases
for each row execute function public.enforce_case_subject_shape();

do $quarantine_invalid_person_subjects$
declare
  v_lock_key text;
  v_target record;
  v_latest_version_id uuid;
  v_revoked integer;
begin
  for v_lock_key in
    select c.organization_id::text || ':' || c.kind || ':' || c.canonical_ref
    from public.cases c
    where c.kind = 'person'
      and c.canonical_ref !~ '^[A-Za-z0-9_]{1,15}$'
    order by 1
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_lock_key, 0)
    );
  end loop;

  for v_target in
    select c.id, c.organization_id, c.kind, c.canonical_ref, c.status
    from public.cases c
    where c.kind = 'person'
      and c.canonical_ref !~ '^[A-Za-z0-9_]{1,15}$'
    order by c.organization_id, c.canonical_ref
  loop
    perform 1
    from public.cases c
    where c.id = v_target.id
    for update;
    if not found then
      continue;
    end if;

    select rv.id
    into v_latest_version_id
    from public.report_versions rv
    where rv.case_id = v_target.id
    order by rv.version desc
    limit 1;

    update public.share_links sl
    set revoked_at = now()
    where sl.revoked_at is null
      and sl.report_version_id in (
        select rv.id
        from public.report_versions rv
        where rv.case_id = v_target.id
      );
    get diagnostics v_revoked = row_count;

    delete from public.reports r
    where r.organization_id = v_target.organization_id
      and r.kind = 'person'
      and r.ref = v_target.canonical_ref;

    update public.cases
    set status = 'archived', updated_at = now()
    where id = v_target.id
      and status <> 'archived';

    if not exists (
      select 1
      from public.case_events existing
      where existing.case_id = v_target.id
        and existing.event_type = 'case.invalid_subject.quarantined'
    ) then
      insert into public.case_events (
        organization_id,
        case_id,
        report_version_id,
        actor_user_id,
        event_type,
        metadata
      ) values (
        v_target.organization_id,
        v_target.id,
        v_latest_version_id,
        null,
        'case.invalid_subject.quarantined',
        pg_catalog.jsonb_build_object(
          'reason', 'invalid_person_identifier',
          'canonicalRef', v_target.canonical_ref,
          'previousStatus', v_target.status,
          'revokedShareLinks', v_revoked,
          'source', 'legacy_token_routing_fallthrough'
        )
      );
    end if;
  end loop;
end;
$quarantine_invalid_person_subjects$;

create or replace function public.resolve_case_subject(
  p_organization_id uuid,
  p_input text
)
returns table (
  case_id uuid,
  subject_kind text,
  subject_ref text,
  display_query text,
  case_status text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with normalized as (
    select
      pg_catalog.btrim(p_input) as raw_input,
      pg_catalog.regexp_replace(pg_catalog.btrim(p_input), '^[@$]', '') as bare_input
  )
  select
    c.id,
    c.kind,
    c.canonical_ref,
    c.display_query,
    c.status,
    c.updated_at
  from public.cases c
  cross join normalized n
  where c.organization_id = p_organization_id
    and c.kind in ('person', 'token', 'investigation', 'site')
    and (c.kind <> 'person' or c.canonical_ref ~ '^[A-Za-z0-9_]{1,15}$')
    and n.raw_input <> ''
    and (
      c.canonical_ref = n.bare_input
      or (
        not (
          c.kind in ('token', 'investigation')
          and c.canonical_ref !~* '^0x[0-9a-f]{40}$'
          and c.canonical_ref ~ '^[A-Za-z0-9]{32,44}$'
        )
        and pg_catalog.lower(c.canonical_ref) = pg_catalog.lower(n.bare_input)
      )
      or c.display_query = n.raw_input
      or pg_catalog.regexp_replace(c.display_query, '^[@$]', '') = n.bare_input
      or (
        not (
          c.kind in ('token', 'investigation')
          and pg_catalog.regexp_replace(c.display_query, '^[@$]', '')
            !~* '^0x[0-9a-f]{40}$'
          and pg_catalog.regexp_replace(c.display_query, '^[@$]', '')
            ~ '^[A-Za-z0-9]{32,44}$'
        )
        and (
          pg_catalog.lower(c.display_query) = pg_catalog.lower(n.raw_input)
          or pg_catalog.lower(
            pg_catalog.regexp_replace(c.display_query, '^[@$]', '')
          ) = pg_catalog.lower(n.bare_input)
        )
      )
      or exists (
        select 1
        from public.case_events alias_event
        where alias_event.organization_id = c.organization_id
          and alias_event.case_id = c.id
          and alias_event.event_type = 'case.identity.repaired'
          and alias_event.metadata ->> 'oldRef' = n.bare_input
      )
    )
  order by
    (c.canonical_ref = n.bare_input) desc,
    (exists (
      select 1
      from public.case_events alias_event
      where alias_event.organization_id = c.organization_id
        and alias_event.case_id = c.id
        and alias_event.event_type = 'case.identity.repaired'
        and alias_event.metadata ->> 'oldRef' = n.bare_input
    )) desc,
    (pg_catalog.lower(c.display_query) = pg_catalog.lower(n.raw_input)) desc,
    c.updated_at desc,
    c.kind,
    c.id
  limit 10;
$$;

revoke all on function public.resolve_case_subject(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_case_subject(uuid, text)
  to service_role;

commit;
