-- Safe case lifecycle
--
-- Converts legacy mutable report projections into immutable case history, then
-- adds an owner-only, atomic archive/restore workflow. Archiving never deletes
-- report versions, evidence, checks, case events, or graph intelligence.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

alter table public.report_versions
  add column if not exists contributor_label text not null default 'anonymous';

alter table public.report_versions
  drop constraint if exists report_versions_contributor_label_check;
alter table public.report_versions
  add constraint report_versions_contributor_label_check
  check (char_length(contributor_label) between 1 and 80);

create index if not exists cases_org_status_updated_idx
  on public.cases (organization_id, status, updated_at desc);
create index if not exists share_links_active_version_idx
  on public.share_links (report_version_id)
  where revoked_at is null;

-- Panel calls happen after the immutable report is sealed. Keep their spend in
-- a separate mutable ledger instead of rewriting evidence payloads.
create table if not exists public.report_cost_lines (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  report_version_id   uuid not null references public.report_versions(id) on delete cascade,
  provider            text not null check (char_length(provider) between 1 and 100),
  operation           text not null check (char_length(operation) between 1 and 160),
  calls               integer not null default 0 check (calls >= 0),
  usd                 numeric not null default 0 check (usd >= 0),
  meta                text check (meta is null or char_length(meta) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (report_version_id, provider, operation)
);
create index if not exists report_cost_lines_org_version_idx
  on public.report_cost_lines (organization_id, report_version_id);

-- Keep the legacy projection, its new immutable version, and the invariant
-- trigger below in one short write-locked transaction. Hosted ARGUS has only a
-- small report library, so this lock is brief and prevents a concurrent scan
-- from landing between the backfill and trigger installation.
lock table public.reports, public.cases, public.report_versions
  in share row exclusive mode;

do $backfill$
declare
  v_report record;
  v_check record;
  v_case_id uuid;
  v_report_version_id uuid;
  v_version integer;
  v_attestation text;
  v_check_id text;
  v_check_state text;
  v_source_count integer;
begin
  for v_report in
    select r.*
    from public.reports r
    where r.kind in ('person', 'token', 'investigation', 'site')
      and r.report_version_id is null
    order by r.organization_id, r.kind, r.ref, r.id
    for update
  loop
    insert into public.cases (
      organization_id, kind, canonical_ref, display_query, created_by,
      created_at, updated_at
    ) values (
      v_report.organization_id,
      v_report.kind,
      v_report.ref,
      coalesce(nullif(pg_catalog.btrim(v_report.query), ''), v_report.ref),
      v_report.created_by,
      coalesce(v_report.ts, now()),
      coalesce(v_report.ts, now())
    )
    on conflict (organization_id, kind, canonical_ref)
    do update set
      display_query = excluded.display_query,
      updated_at = greatest(public.cases.updated_at, excluded.updated_at)
    returning id into v_case_id;

    v_report_version_id := null;
    v_attestation := null;

    -- Only a prior run of this exact backfill is reusable. Payload similarity is
    -- not enough to inherit stronger provenance from an unrelated version.
    select rv.id, rv.attestation_state
    into v_report_version_id, v_attestation
    from public.report_versions rv
    where rv.case_id = v_case_id
      and rv.run_id = 'legacy-projection:' || v_report.id::text
    order by rv.version desc
    limit 1;

    if v_report_version_id is null then
      select coalesce(max(rv.version), 0) + 1
      into v_version
      from public.report_versions rv
      where rv.case_id = v_case_id;

      insert into public.report_versions (
        case_id, organization_id, version, payload, verdict, score,
        completeness_state, methodology_version, provider_snapshot, cost,
        run_id, attestation_state, contributor_label, created_by, created_at
      ) values (
        v_case_id,
        v_report.organization_id,
        v_version,
        v_report.payload,
        v_report.verdict,
        v_report.score,
        'partial',
        null,
        case
          when pg_catalog.jsonb_typeof(v_report.payload -> 'providerSnapshot') = 'object'
            then v_report.payload -> 'providerSnapshot'
          when pg_catalog.jsonb_typeof(v_report.payload -> 'providers') = 'object'
            then v_report.payload -> 'providers'
          else '{}'::jsonb
        end,
        case
          when pg_catalog.jsonb_typeof(v_report.payload -> 'cost') = 'object'
            then v_report.payload -> 'cost'
          else '{}'::jsonb
        end,
        'legacy-projection:' || v_report.id::text,
        'legacy_unattested',
        left(coalesce(nullif(pg_catalog.btrim(v_report.contributor), ''), 'anonymous'), 80),
        v_report.created_by,
        coalesce(v_report.ts, now())
      )
      returning id into v_report_version_id;

      v_attestation := 'legacy_unattested';

      insert into public.case_events (
        organization_id, case_id, report_version_id, actor_user_id,
        event_type, metadata, created_at
      ) values (
        v_report.organization_id,
        v_case_id,
        v_report_version_id,
        null,
        'report.version.backfilled',
        pg_catalog.jsonb_build_object(
          'version', v_version,
          'source', 'legacy_projection',
          'projectionId', v_report.id
        ),
        coalesce(v_report.ts, now())
      );

      -- Older person payloads may already contain the exact frozen checklist.
      -- Preserve those outcomes as legacy-unattested check rows when present.
      if pg_catalog.jsonb_typeof(v_report.payload -> 'checkRuns') = 'array' then
        for v_check in
          select item, ordinality
          from pg_catalog.jsonb_array_elements(v_report.payload -> 'checkRuns')
            with ordinality as checks(item, ordinality)
        loop
          if pg_catalog.jsonb_typeof(v_check.item) <> 'object'
             or nullif(pg_catalog.btrim(v_check.item ->> 'label'), '') is null
             or nullif(pg_catalog.btrim(v_check.item ->> 'status'), '') is null then
            continue;
          end if;

          v_check_id := left(coalesce(
            nullif(pg_catalog.btrim(v_check.item ->> 'checkId'), ''),
            nullif(pg_catalog.btrim(v_check.item ->> 'check_id'), ''),
            nullif(pg_catalog.btrim(v_check.item ->> 'id'), ''),
            nullif(
              pg_catalog.btrim(
                pg_catalog.regexp_replace(
                  pg_catalog.lower(v_check.item ->> 'label'),
                  '[^a-z0-9]+',
                  '-',
                  'g'
                ),
                '-'
              ),
              ''
            ) || '-' || v_check.ordinality::text,
            'legacy-check-' || v_check.ordinality::text
          ), 160);

          v_check_state := case v_check.item ->> 'status'
            when 'confirmed' then 'complete'
            when 'finding' then 'complete'
            when 'checked-empty' then 'complete'
            when 'unavailable' then 'unavailable'
            when 'stale' then 'partial'
            else 'not_run'
          end;

          v_source_count := case
            when pg_catalog.jsonb_typeof(v_check.item -> 'sourceCount') = 'number'
              then least(
                2147483647,
                greatest(0, floor((v_check.item ->> 'sourceCount')::numeric))
              )::integer
            else 0
          end;

          insert into public.check_runs (
            organization_id, report_version_id, check_id, provider, state,
            source_count, error_code, error_detail, attestation_state, metadata
          ) values (
            v_report.organization_id,
            v_report_version_id,
            v_check_id,
            left(nullif(pg_catalog.btrim(v_check.item ->> 'provider'), ''), 100),
            v_check_state,
            v_source_count,
            case when v_check_state = 'unavailable' then 'provider_unavailable' end,
            case when v_check_state = 'unavailable'
              then left(nullif(pg_catalog.btrim(v_check.item ->> 'note'), ''), 500)
            end,
            'legacy_unattested',
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
              'label', left(v_check.item ->> 'label', 200),
              'status', left(v_check.item ->> 'status', 40),
              'note', left(nullif(pg_catalog.btrim(v_check.item ->> 'note'), ''), 500),
              'notApplicable', (v_check.item ->> 'status') = 'not-applicable',
              'completedAt', nullif(pg_catalog.btrim(v_check.item ->> 'completedAt'), ''),
              'order', v_check.ordinality - 1
            ))
          )
          on conflict (report_version_id, check_id) do nothing;
        end loop;
      end if;
    end if;

    update public.reports
    set report_version_id = v_report_version_id,
        attestation_state = coalesce(v_attestation, 'legacy_unattested')
    where id = v_report.id;
  end loop;
end;
$backfill$;

-- The column is new in this migration. Freeze the attribution already carried
-- by any correctly linked projection that predates it.
update public.report_versions rv
set contributor_label = left(
  coalesce(nullif(pg_catalog.btrim(r.contributor), ''), 'anonymous'),
  80
)
from public.reports r
where r.report_version_id = rv.id
  and r.organization_id = rv.organization_id;

-- A report projection is only a cache of the newest immutable version of an
-- open case. The advisory lock closes the gap between the version RPC and the
-- API's subsequent projection upsert: archive either wins and rejects the late
-- upsert, or waits and removes it.
create or replace function public.enforce_active_report_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.kind in ('person', 'token', 'investigation', 'site')
     and (
       new.organization_id is distinct from old.organization_id
       or new.kind is distinct from old.kind
       or new.ref is distinct from old.ref
     ) then
    raise exception 'case report projection identity is immutable';
  end if;

  if new.kind not in ('person', 'token', 'investigation', 'site') then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.organization_id::text || ':' || new.kind || ':' || new.ref,
      0
    )
  );

  if new.report_version_id is null then
    raise exception 'case report projection requires an immutable version';
  end if;

  select c.id
  into v_case_id
  from public.cases c
  join public.report_versions rv
    on rv.case_id = c.id
   and rv.id = new.report_version_id
   and rv.organization_id = new.organization_id
  where c.organization_id = new.organization_id
    and c.kind = new.kind
    and c.canonical_ref = new.ref
    and c.display_query = new.query
    and c.status = 'open'
    and rv.payload is not distinct from new.payload
    and rv.verdict is not distinct from new.verdict
    and rv.score is not distinct from new.score
    and rv.attestation_state = new.attestation_state
    and rv.contributor_label = new.contributor
    and rv.created_by is not distinct from new.created_by
    and not exists (
      select 1
      from public.report_versions newer
      where newer.case_id = c.id
        and newer.version > rv.version
    )
  limit 1;

  if v_case_id is null then
    raise exception 'case report projection must match the latest immutable version of an open case';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_enforce_active_case on public.reports;
create trigger reports_enforce_active_case
  before insert or update on public.reports
  for each row execute function public.enforce_active_report_projection();

-- Validate pre-existing linked projections without firing the advisory-locking
-- trigger. The migration already owns write-conflicting table locks; acquiring
-- advisory locks here would invert the live persistence lock order.
do $validate_projections$
begin
  if exists (
    select 1
    from public.reports r
    left join public.cases c
      on c.organization_id = r.organization_id
     and c.kind = r.kind
     and c.canonical_ref = r.ref
    left join public.report_versions rv
      on rv.id = r.report_version_id
     and rv.case_id = c.id
     and rv.organization_id = r.organization_id
    where r.kind in ('person', 'token', 'investigation', 'site')
      and (
        c.id is null
        or rv.id is null
        or c.status <> 'open'
        or c.display_query is distinct from r.query
        or rv.payload is distinct from r.payload
        or rv.verdict is distinct from r.verdict
        or rv.score is distinct from r.score
        or rv.attestation_state is distinct from r.attestation_state
        or rv.contributor_label is distinct from r.contributor
        or rv.created_by is distinct from r.created_by
        or exists (
          select 1
          from public.report_versions newer
          where newer.case_id = c.id
            and newer.version > rv.version
        )
      )
  ) then
    raise exception 'existing case report projection violates immutable version invariant';
  end if;
end;
$validate_projections$;

-- Share creation participates in the same per-case lock as persistence and
-- archive. If share wins first, archive waits and revokes it; if archive wins,
-- this trigger wakes up, sees the archived case, and rejects the new link.
create or replace function public.enforce_open_case_share()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.report_version_id is distinct from old.report_version_id
     ) then
    raise exception 'share link case identity is immutable';
  end if;

  -- Revocation must remain possible after the case has already been archived.
  if new.revoked_at is not null then
    return new;
  end if;

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

drop trigger if exists share_links_enforce_open_case on public.share_links;
create trigger share_links_enforce_open_case
  before insert or update on public.share_links
  for each row execute function public.enforce_open_case_share();

create or replace function public.upsert_report_cost_line(
  p_organization_id uuid,
  p_report_version_id uuid,
  p_provider text,
  p_operation text,
  p_calls integer,
  p_usd numeric,
  p_meta text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(p_provider), '') is null
     or char_length(p_provider) > 100
     or nullif(pg_catalog.btrim(p_operation), '') is null
     or char_length(p_operation) > 160
     or p_calls is null
     or p_calls < 0
     or p_usd is null
     or p_usd < 0
     or (p_meta is not null and char_length(p_meta) > 500) then
    raise exception 'invalid report cost line';
  end if;

  if not exists (
    select 1
    from public.report_versions rv
    where rv.id = p_report_version_id
      and rv.organization_id = p_organization_id
  ) then
    raise exception 'report version does not belong to organization';
  end if;

  insert into public.report_cost_lines (
    organization_id, report_version_id, provider, operation, calls, usd, meta
  ) values (
    p_organization_id,
    p_report_version_id,
    pg_catalog.btrim(p_provider),
    pg_catalog.btrim(p_operation),
    p_calls,
    p_usd,
    nullif(pg_catalog.btrim(p_meta), '')
  )
  on conflict (report_version_id, provider, operation)
  do update set
    calls = excluded.calls,
    usd = excluded.usd,
    meta = excluded.meta,
    updated_at = now()
  where public.report_cost_lines.organization_id = excluded.organization_id;
end;
$$;

-- Replay-safe immutable persistence. An old run id is returned before any case
-- mutation, so replaying a pre-archive request cannot silently reopen a case.
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
  v_previous_status text;
  v_contributor text;
  v_existing_payload jsonb;
  v_existing_attestation text;
  v_existing_verdict text;
  v_existing_score numeric;
  v_existing_completeness text;
  v_existing_methodology text;
  v_existing_providers jsonb;
  v_existing_cost jsonb;
begin
  if p_kind not in ('person', 'token', 'investigation', 'site') then
    raise exception 'invalid case kind';
  end if;
  if nullif(pg_catalog.btrim(p_canonical_ref), '') is null
     or char_length(p_canonical_ref) > 500 then
    raise exception 'invalid canonical reference';
  end if;
  if nullif(pg_catalog.btrim(p_query), '') is null or char_length(p_query) > 500 then
    raise exception 'invalid display query';
  end if;
  if p_completeness_state not in ('complete', 'partial', 'failed') then
    raise exception 'invalid completeness state';
  end if;
  if p_attestation_state not in ('server_collected', 'analyst_submitted', 'legacy_unattested') then
    raise exception 'invalid attestation state';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_kind || ':' || p_canonical_ref,
      0
    )
  );

  insert into public.cases (
    organization_id, kind, canonical_ref, display_query, created_by
  ) values (
    p_organization_id, p_kind, p_canonical_ref, p_query, p_created_by
  )
  on conflict (organization_id, kind, canonical_ref) do nothing
  returning id, status into v_case_id, v_previous_status;

  if v_case_id is null then
    select c.id, c.status
    into v_case_id, v_previous_status
    from public.cases c
    where c.organization_id = p_organization_id
      and c.kind = p_kind
      and c.canonical_ref = p_canonical_ref
    for update;
  end if;

  if p_run_id is not null and char_length(p_run_id) > 0 then
    select rv.id, rv.version, rv.payload, rv.attestation_state, rv.verdict,
           rv.score, rv.completeness_state, rv.methodology_version,
           rv.provider_snapshot, rv.cost
    into v_report_version_id, v_version, v_existing_payload, v_existing_attestation,
         v_existing_verdict, v_existing_score, v_existing_completeness,
         v_existing_methodology, v_existing_providers, v_existing_cost
    from public.report_versions rv
    where rv.case_id = v_case_id and rv.run_id = p_run_id
    limit 1;

    if v_report_version_id is not null then
      if v_existing_payload is distinct from p_payload
         or v_existing_attestation is distinct from p_attestation_state
         or v_existing_verdict is distinct from p_verdict
         or v_existing_score is distinct from p_score
         or v_existing_completeness is distinct from p_completeness_state
         or v_existing_methodology is distinct from p_methodology_version
         or v_existing_providers is distinct from coalesce(p_provider_snapshot, '{}'::jsonb)
         or v_existing_cost is distinct from coalesce(p_cost, '{}'::jsonb) then
        raise exception 'run id already exists with different immutable content';
      end if;

      return query select v_case_id, v_report_version_id, v_version;
      return;
    end if;
  end if;

  select left(coalesce(nullif(pg_catalog.btrim(m.display_name), ''), 'anonymous'), 80)
  into v_contributor
  from public.argus_members m
  where m.user_id = p_created_by
    and m.organization_id = p_organization_id
    and m.active
  limit 1;
  v_contributor := coalesce(v_contributor, 'anonymous');

  update public.cases
  set display_query = p_query,
      status = 'open',
      updated_at = now()
  where id = v_case_id;

  select coalesce(max(rv.version), 0) + 1
  into v_version
  from public.report_versions rv
  where rv.case_id = v_case_id;

  insert into public.report_versions (
    case_id, organization_id, version, payload, verdict, score,
    completeness_state, methodology_version, provider_snapshot, cost, run_id,
    attestation_state, contributor_label, created_by
  ) values (
    v_case_id, p_organization_id, v_version, p_payload, p_verdict, p_score,
    p_completeness_state, p_methodology_version,
    coalesce(p_provider_snapshot, '{}'::jsonb),
    coalesce(p_cost, '{}'::jsonb), nullif(p_run_id, ''),
    p_attestation_state, v_contributor, p_created_by
  ) returning id into v_report_version_id;

  -- A newer immutable version invalidates the old active cache immediately.
  -- The API activates this version only after provenance/check persistence
  -- succeeds; an absent projection is safer than stale or incomplete evidence.
  delete from public.reports r
  where r.organization_id = p_organization_id
    and r.kind = p_kind
    and r.ref = p_canonical_ref;

  if v_previous_status = 'archived' then
    insert into public.case_events (
      organization_id, case_id, report_version_id, actor_user_id,
      event_type, metadata
    ) values (
      p_organization_id, v_case_id, v_report_version_id, p_created_by,
      'case.reopened',
      pg_catalog.jsonb_build_object('reason', 'new_report_version', 'version', v_version)
    );
  end if;

  insert into public.case_events (
    organization_id, case_id, report_version_id, actor_user_id, event_type,
    metadata
  ) values (
    p_organization_id, v_case_id, v_report_version_id, p_created_by,
    'report.version.created',
    pg_catalog.jsonb_build_object(
      'version', v_version,
      'attestation', p_attestation_state
    )
  );

  return query select v_case_id, v_report_version_id, v_version;
end;
$$;

-- Publish a version only after the API has persisted its evidence/check
-- provenance. This second phase is lock-aware and idempotent: archive either
-- removes the projection afterward or wins first and makes activation fail.
create or replace function public.activate_report_version(
  p_organization_id uuid,
  p_report_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kind text;
  v_ref text;
  v_case public.cases%rowtype;
  v_version public.report_versions%rowtype;
  v_current_version_id uuid;
begin
  select c.kind, c.canonical_ref
  into v_kind, v_ref
  from public.report_versions rv
  join public.cases c on c.id = rv.case_id
  where rv.id = p_report_version_id
    and rv.organization_id = p_organization_id
    and c.organization_id = p_organization_id
  limit 1;

  if v_kind is null or v_ref is null then
    raise exception 'report version does not belong to organization case';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_kind || ':' || v_ref,
      0
    )
  );

  select c.*
  into v_case
  from public.cases c
  join public.report_versions rv on rv.case_id = c.id
  where rv.id = p_report_version_id
    and rv.organization_id = p_organization_id
    and c.organization_id = p_organization_id
  for update of c;

  select rv.*
  into v_version
  from public.report_versions rv
  where rv.id = p_report_version_id
    and rv.organization_id = p_organization_id;

  if v_case.id is null or v_version.id is null or v_case.status <> 'open' then
    raise exception 'only an open case report can be activated';
  end if;
  if exists (
    select 1
    from public.report_versions newer
    where newer.case_id = v_case.id
      and newer.version > v_version.version
  ) then
    raise exception 'only the latest report version can be activated';
  end if;
  if v_version.completeness_state = 'complete'
     and not exists (
       select 1
       from public.check_runs cr
       where cr.report_version_id = v_version.id
         and cr.organization_id = p_organization_id
     ) then
    raise exception 'complete report version requires persisted check provenance';
  end if;

  select r.report_version_id
  into v_current_version_id
  from public.reports r
  where r.organization_id = p_organization_id
    and r.kind = v_case.kind
    and r.ref = v_case.canonical_ref
  limit 1;

  if v_current_version_id is not distinct from v_version.id then
    return;
  end if;

  insert into public.reports (
    organization_id, ref, kind, query, contributor, created_by,
    report_version_id, attestation_state, payload, verdict, score, ts
  ) values (
    p_organization_id,
    v_case.canonical_ref,
    v_case.kind,
    v_case.display_query,
    v_version.contributor_label,
    v_version.created_by,
    v_version.id,
    v_version.attestation_state,
    v_version.payload,
    v_version.verdict,
    v_version.score,
    v_version.created_at
  )
  on conflict (organization_id, ref, kind)
  do update set
    query = excluded.query,
    contributor = excluded.contributor,
    created_by = excluded.created_by,
    report_version_id = excluded.report_version_id,
    attestation_state = excluded.attestation_state,
    payload = excluded.payload,
    verdict = excluded.verdict,
    score = excluded.score,
    ts = excluded.ts;

  insert into public.case_events (
    organization_id, case_id, report_version_id, actor_user_id,
    event_type, metadata
  ) values (
    p_organization_id,
    v_case.id,
    v_version.id,
    v_version.created_by,
    'report.version.activated',
    pg_catalog.jsonb_build_object('version', v_version.version)
  );
end;
$$;

-- Archive or restore up to 50 exact case subjects in one transaction. The API
-- validates the same shape, while the database independently verifies the
-- actor's current owner membership and tenant boundary.
create or replace function public.manage_case_lifecycle(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_subjects jsonb
)
returns table (
  subject_kind text,
  subject_ref text,
  case_status text,
  changed boolean,
  revoked_share_links integer,
  latest_report_version_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action text := pg_catalog.lower(pg_catalog.btrim(p_action));
  v_subject record;
  v_case public.cases%rowtype;
  v_latest public.report_versions%rowtype;
  v_changed boolean;
  v_revoked integer;
begin
  if not exists (
    select 1
    from public.argus_members m
    where m.user_id = p_actor_user_id
      and m.organization_id = p_organization_id
      and m.active
      and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'active owner access required';
  end if;

  if v_action is null or v_action not in ('archive', 'restore') then
    raise exception 'invalid lifecycle action';
  end if;
  if p_subjects is null
     or pg_catalog.jsonb_typeof(p_subjects) <> 'array'
     or pg_catalog.jsonb_array_length(p_subjects) < 1
     or pg_catalog.jsonb_array_length(p_subjects) > 50 then
    raise exception 'subjects must contain between 1 and 50 cases';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_subjects) item
    where pg_catalog.jsonb_typeof(item) <> 'object'
      or coalesce(item ->> 'kind', '') not in ('person', 'token', 'investigation', 'site')
      or nullif(pg_catalog.btrim(item ->> 'ref'), '') is null
      or char_length(item ->> 'ref') > 500
  ) then
    raise exception 'every subject requires a valid case kind and reference';
  end if;

  -- Acquire every lock in a deterministic order before mutating any row. This
  -- prevents two overlapping batch operations from deadlocking each other.
  for v_subject in
    select distinct item ->> 'kind' as item_kind, item ->> 'ref' as item_ref
    from pg_catalog.jsonb_array_elements(p_subjects) item
    order by item_kind, item_ref
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':' || v_subject.item_kind || ':' || v_subject.item_ref,
        0
      )
    );
  end loop;

  for v_subject in
    select distinct item ->> 'kind' as item_kind, item ->> 'ref' as item_ref
    from pg_catalog.jsonb_array_elements(p_subjects) item
    order by item_kind, item_ref
  loop
    select c.*
    into v_case
    from public.cases c
    where c.organization_id = p_organization_id
      and c.kind = v_subject.item_kind
      and c.canonical_ref = v_subject.item_ref
    for update;

    if not found then
      raise exception 'case not found for %:%', v_subject.item_kind, v_subject.item_ref;
    end if;

    v_latest := null;
    select rv.*
    into v_latest
    from public.report_versions rv
    where rv.case_id = v_case.id
    order by rv.version desc
    limit 1;

    v_changed := false;
    v_revoked := 0;

    if v_action = 'archive' then
      if v_case.status <> 'archived' then
        update public.cases
        set status = 'archived', updated_at = now()
        where id = v_case.id;
        v_changed := true;
      end if;

      update public.share_links sl
      set revoked_at = now()
      where sl.revoked_at is null
        and sl.report_version_id in (
          select rv.id from public.report_versions rv where rv.case_id = v_case.id
        );
      get diagnostics v_revoked = row_count;

      delete from public.reports r
      where r.organization_id = p_organization_id
        and r.kind = v_subject.item_kind
        and r.ref = v_subject.item_ref;

      if v_changed then
        insert into public.case_events (
          organization_id, case_id, report_version_id, actor_user_id,
          event_type, metadata
        ) values (
          p_organization_id,
          v_case.id,
          v_latest.id,
          p_actor_user_id,
          'case.archived',
          pg_catalog.jsonb_build_object('revokedShareLinks', v_revoked)
        );
      end if;

      case_status := 'archived';
    else
      if v_latest.id is null then
        raise exception 'case has no immutable report version for %:%',
          v_subject.item_kind, v_subject.item_ref;
      end if;

      if v_case.status <> 'open' then
        update public.cases
        set status = 'open', updated_at = now()
        where id = v_case.id;
        v_changed := true;
      end if;

      insert into public.reports (
        organization_id, ref, kind, query, contributor, created_by,
        report_version_id, attestation_state, payload, verdict, score, ts
      ) values (
        p_organization_id,
        v_case.canonical_ref,
        v_case.kind,
        v_case.display_query,
        v_latest.contributor_label,
        v_latest.created_by,
        v_latest.id,
        v_latest.attestation_state,
        v_latest.payload,
        v_latest.verdict,
        v_latest.score,
        v_latest.created_at
      )
      on conflict (organization_id, ref, kind)
      do update set
        query = excluded.query,
        contributor = excluded.contributor,
        created_by = excluded.created_by,
        report_version_id = excluded.report_version_id,
        attestation_state = excluded.attestation_state,
        payload = excluded.payload,
        verdict = excluded.verdict,
        score = excluded.score,
        ts = excluded.ts;

      if v_changed then
        insert into public.case_events (
          organization_id, case_id, report_version_id, actor_user_id,
          event_type, metadata
        ) values (
          p_organization_id,
          v_case.id,
          v_latest.id,
          p_actor_user_id,
          'case.restored',
          '{}'::jsonb
        );
      end if;

      case_status := 'open';
    end if;

    subject_kind := v_subject.item_kind;
    subject_ref := v_subject.item_ref;
    changed := v_changed;
    revoked_share_links := v_revoked;
    latest_report_version_id := v_latest.id;
    return next;
  end loop;
end;
$$;

alter table public.report_cost_lines enable row level security;
drop policy if exists report_cost_lines_read_member_org on public.report_cost_lines;
create policy report_cost_lines_read_member_org on public.report_cost_lines
  for select to authenticated
  using (organization_id in (
    select m.organization_id
    from public.argus_members m
    where m.user_id = (select auth.uid())
      and m.active
  ));

revoke all on table public.report_cost_lines from anon, authenticated;
grant select on table public.report_cost_lines to authenticated;
grant all on table public.report_cost_lines to service_role;

revoke all on function public.enforce_active_report_projection()
  from public, anon, authenticated;
revoke all on function public.enforce_open_case_share()
  from public, anon, authenticated;
revoke all on function public.upsert_report_cost_line(uuid, uuid, text, text, integer, numeric, text)
  from public, anon, authenticated;
revoke all on function public.activate_report_version(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.manage_case_lifecycle(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.persist_report_version(uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text, text, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.enforce_active_report_projection()
  to service_role;
grant execute on function public.enforce_open_case_share()
  to service_role;
grant execute on function public.upsert_report_cost_line(uuid, uuid, text, text, integer, numeric, text)
  to service_role;
grant execute on function public.activate_report_version(uuid, uuid)
  to service_role;
grant execute on function public.manage_case_lifecycle(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.persist_report_version(uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text, text, jsonb, jsonb)
  to service_role;

commit;
