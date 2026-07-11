-- Canonical case lookup and legacy Solana identity repair.
--
-- Historical mutable report keys lower-cased every subject. That is safe for
-- X handles and EVM addresses, but corrupts case-sensitive Solana mints. Repair
-- those case identities from their immutable payloads, then expose a bounded
-- service-only resolver so labels and legacy case-folded refs can never fall
-- through into a paid person audit.

-- First harden share creation against any case identity change. It must re-read
-- the case after acquiring the advisory key; otherwise a request that read the
-- old key before waiting could validate without holding the new key.
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
    join public.reports r
      on r.organization_id = c.organization_id
     and r.kind = c.kind
     and r.ref = c.canonical_ref
     and r.report_version_id = rv.id
    where rv.id = new.report_version_id
      and rv.organization_id = new.organization_id
      and c.organization_id = new.organization_id
      and c.status = 'open'
      and not exists (
        select 1
        from public.report_versions newer
        where newer.case_id = c.id
          and newer.version > rv.version
      )
  ) then
    raise exception 'public links can only target the latest active case report';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_open_case_share()
  from public, anon, authenticated;
grant execute on function public.enforce_open_case_share()
  to service_role;

-- Recreating the trigger takes a write-conflicting table lock. That is an
-- explicit drain barrier for transactions already running the previous body;
-- after this commits, every new share write uses the re-locking implementation.
drop trigger if exists share_links_enforce_open_case on public.share_links;
create trigger share_links_enforce_open_case
before insert or update on public.share_links
for each row execute function public.enforce_open_case_share();

commit;

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $repair_solana_case_identity$
declare
  v_target record;
  v_lock_key text;
  v_case_status text;
  v_report_version_id uuid;
  v_report_version integer;
  v_current_correct_ref text;
  v_had_active_projection boolean;
begin
  create temporary table argus_solana_identity_repairs
  on commit drop
  as
    select
      c.id as case_id,
      c.organization_id,
      c.kind,
      c.canonical_ref as old_ref,
      candidate.correct_ref
    from public.cases c
    join lateral (
      select latest.*
      from public.report_versions latest
      where latest.case_id = c.id
      order by latest.version desc
      limit 1
    ) rv on true
    cross join lateral (
      select case
        when c.kind = 'token'
          and pg_catalog.lower(coalesce(rv.payload ->> 'chain', '')) = 'solana'
          then rv.payload ->> 'address'
        when c.kind = 'investigation'
          and pg_catalog.lower(coalesce(rv.payload #>> '{token,chain}', '')) = 'solana'
          then rv.payload #>> '{token,address}'
        else null
      end as correct_ref
    ) candidate
    where c.kind in ('token', 'investigation')
      and candidate.correct_ref ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
      and c.canonical_ref = pg_catalog.lower(candidate.correct_ref)
      and c.canonical_ref <> candidate.correct_ref;

  -- Acquire every old/new identity lock in one global order before mutating
  -- any row. Live persist, lifecycle, share, and activation paths use the same
  -- keys, so this cannot deadlock by taking target pairs in a different order.
  for v_lock_key in
    select locks.lock_key
    from (
      select organization_id::text || ':' || kind || ':' || old_ref as lock_key
      from argus_solana_identity_repairs
      union
      select organization_id::text || ':' || kind || ':' || correct_ref as lock_key
      from argus_solana_identity_repairs
    ) locks
    order by locks.lock_key
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_key, 0));
  end loop;

  for v_target in
    select *
    from argus_solana_identity_repairs
    order by organization_id, kind, old_ref
  loop
    select c.status
    into v_case_status
    from public.cases c
    where c.id = v_target.case_id
      and c.canonical_ref = v_target.old_ref
    for update;
    if not found then
      continue;
    end if;

    select
      rv.id,
      rv.version,
      case
        when v_target.kind = 'token'
          and pg_catalog.lower(coalesce(rv.payload ->> 'chain', '')) = 'solana'
          then rv.payload ->> 'address'
        when v_target.kind = 'investigation'
          and pg_catalog.lower(coalesce(rv.payload #>> '{token,chain}', '')) = 'solana'
          then rv.payload #>> '{token,address}'
        else null
      end
    into v_report_version_id, v_report_version, v_current_correct_ref
    from public.report_versions rv
    where rv.case_id = v_target.case_id
    order by rv.version desc
    limit 1;

    if v_current_correct_ref is distinct from v_target.correct_ref then
      raise exception 'latest immutable Solana identity changed during repair for case %',
        v_target.case_id;
    end if;

    if exists (
      select 1
      from public.cases conflict
      where conflict.organization_id = v_target.organization_id
        and conflict.kind = v_target.kind
        and conflict.canonical_ref = v_target.correct_ref
        and conflict.id <> v_target.case_id
    ) then
      raise exception 'canonical Solana case already exists for %:%',
        v_target.kind, v_target.correct_ref;
    end if;

    select exists (
      select 1
      from public.reports active_report
      where active_report.organization_id = v_target.organization_id
        and active_report.kind = v_target.kind
        and active_report.ref = v_target.old_ref
        and active_report.report_version_id = v_report_version_id
    )
    into v_had_active_projection;

    -- A projection's identity is immutable by trigger. Remove only that mutable
    -- cache, repair the durable case key, then recreate the exact latest cache
    -- through the same invariant-checked activation path used by live writes.
    delete from public.reports r
    where r.organization_id = v_target.organization_id
      and r.kind = v_target.kind
      and r.ref = v_target.old_ref;

    update public.cases
    set canonical_ref = v_target.correct_ref,
        updated_at = now()
    where id = v_target.case_id;

    -- Archived cases intentionally have no mutable projection. Preserve that
    -- lifecycle state instead of implicitly restoring them during identity repair.
    if v_case_status = 'open' and v_had_active_projection then
      perform public.activate_report_version(
        v_target.organization_id,
        v_report_version_id
      );
    end if;

    insert into public.case_events (
      organization_id,
      case_id,
      report_version_id,
      actor_user_id,
      event_type,
      metadata
    ) values (
      v_target.organization_id,
      v_target.case_id,
      v_report_version_id,
      null,
      'case.identity.repaired',
      pg_catalog.jsonb_build_object(
        'oldRef', v_target.old_ref,
        'newRef', v_target.correct_ref,
        'chain', 'solana',
        'source', 'immutable_report_payload',
        'version', v_report_version
      )
    );
  end loop;
end;
$repair_solana_case_identity$;

-- A request that started before this migration can still carry the retired
-- lower-cased ref after waiting on the old advisory key. Reserve exact legacy
-- aliases so that stale writer fails safely instead of recreating a duplicate
-- case after the original identity has moved.
create or replace function public.reject_retired_case_subject_alias()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.case_events alias_event
    where alias_event.organization_id = new.organization_id
      and alias_event.event_type = 'case.identity.repaired'
      and alias_event.metadata ->> 'oldRef' = new.canonical_ref
      and alias_event.metadata ->> 'newRef' is distinct from new.canonical_ref
      and exists (
        select 1
        from public.cases canonical_case
        where canonical_case.id = alias_event.case_id
          and canonical_case.organization_id = new.organization_id
          and canonical_case.kind = new.kind
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'retired case subject alias; retry with canonical identity';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_retired_case_subject_alias()
  from public, anon, authenticated;
grant execute on function public.reject_retired_case_subject_alias()
  to service_role;

drop trigger if exists cases_reject_retired_subject_alias on public.cases;
create trigger cases_reject_retired_subject_alias
before insert on public.cases
for each row execute function public.reject_retired_case_subject_alias();

-- Install the read path in the same transaction as the identity repair. The
-- optional lookup indexes are built afterward, so lock contention on index DDL
-- can never leave repaired aliases without a working resolver.
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

-- Keep heavyweight index DDL out of the advisory-locking repair transaction.
-- This avoids inverting CREATE INDEX's table lock against live writers that
-- already hold the same per-case advisory locks.
begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

create index if not exists cases_org_lower_query_idx
  on public.cases (organization_id, pg_catalog.lower(display_query));
create index if not exists case_events_org_legacy_subject_alias_idx
  on public.case_events (organization_id, ((metadata ->> 'oldRef')))
  where event_type = 'case.identity.repaired';

commit;
