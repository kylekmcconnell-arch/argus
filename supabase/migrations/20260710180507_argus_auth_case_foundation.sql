-- ARGUS P0 trust foundation
--
-- Adds organization-scoped access, authenticated analyst membership, immutable
-- report versions, evidence/check provenance, and atomic usage quotas while
-- preserving the three legacy tables during the client migration.

create extension if not exists pgcrypto;

-- Bootstrap the pre-migration shared stores on a fresh environment. Hosted
-- ARGUS already has these tables, so every statement is intentionally additive.
create table if not exists public.graph_contributions (
  id            uuid primary key default gen_random_uuid(),
  canonical_key text not null,
  handle        text not null,
  verdict       text,
  nodes         jsonb not null default '[]'::jsonb,
  edges         jsonb not null default '[]'::jsonb,
  contributor   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists graph_contributions_canonical_key_key
  on public.graph_contributions (canonical_key);

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null,
  ts          timestamptz not null,
  kind        text not null,
  query       text not null,
  ref         text,
  image       text,
  verdict     text,
  score       numeric,
  summary     text not null default '',
  coverage    text,
  flags       jsonb not null default '[]'::jsonb,
  contributor text not null,
  inserted_at timestamptz not null default now()
);
create unique index if not exists audit_log_client_id_key
  on public.audit_log (client_id);

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null,
  kind        text not null,
  query       text,
  contributor text not null default 'anonymous',
  payload     jsonb not null,
  verdict     text,
  score       numeric,
  ts          timestamptz not null default now()
);
create unique index if not exists reports_ref_kind_uidx
  on public.reports (ref, kind);

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text not null check (char_length(name) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Stable default organization for the existing Kyle + Enigma workspace. New
-- organizations can be added without changing any legacy data.
insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-000000000001', 'argus', 'ARGUS')
on conflict (id) do update set slug = excluded.slug, name = excluded.name;

create table if not exists public.argus_members (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  role             text not null default 'viewer'
                   check (role in ('owner', 'analyst', 'viewer')),
  display_name     text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists argus_members_org_idx
  on public.argus_members (organization_id, active);

create table if not exists public.cases (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  kind               text not null check (kind in ('person', 'token', 'investigation', 'site')),
  canonical_ref      text not null check (char_length(canonical_ref) between 1 and 500),
  display_query      text not null check (char_length(display_query) between 1 and 500),
  status             text not null default 'open' check (status in ('open', 'archived')),
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (organization_id, kind, canonical_ref)
);
create index if not exists cases_org_updated_idx
  on public.cases (organization_id, updated_at desc);

create table if not exists public.report_versions (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references public.cases(id) on delete cascade,
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  version               integer not null check (version > 0),
  payload               jsonb not null,
  verdict               text,
  score                 numeric,
  completeness_state    text not null default 'partial'
                        check (completeness_state in ('complete', 'partial', 'failed')),
  methodology_version   text,
  provider_snapshot     jsonb not null default '{}'::jsonb,
  cost                  jsonb not null default '{}'::jsonb,
  run_id                text,
  attestation_state     text not null default 'analyst_submitted'
                        check (attestation_state in ('server_collected', 'analyst_submitted', 'legacy_unattested')),
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (case_id, version)
);
create index if not exists report_versions_org_created_idx
  on public.report_versions (organization_id, created_at desc);
create index if not exists report_versions_case_latest_idx
  on public.report_versions (case_id, version desc);
create unique index if not exists report_versions_case_run_uidx
  on public.report_versions (case_id, run_id)
  where run_id is not null;

create table if not exists public.evidence_items (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  report_version_id   uuid not null references public.report_versions(id) on delete cascade,
  evidence_key        text not null,
  provider            text,
  source_type         text,
  source_url          text,
  title               text,
  excerpt             text,
  published_at        timestamptz,
  captured_at         timestamptz not null default now(),
  content_hash        text,
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  attestation_state   text not null default 'analyst_submitted'
                      check (attestation_state in ('server_collected', 'analyst_submitted', 'legacy_unattested')),
  metadata            jsonb not null default '{}'::jsonb
);
create index if not exists evidence_items_report_idx
  on public.evidence_items (report_version_id, captured_at);
alter table public.evidence_items
  add constraint evidence_items_report_key_unique unique (report_version_id, evidence_key);

create table if not exists public.check_runs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  report_version_id   uuid not null references public.report_versions(id) on delete cascade,
  check_id            text not null,
  provider            text,
  state               text not null check (state in ('complete', 'partial', 'unavailable', 'failed', 'not_run')),
  source_count        integer not null default 0 check (source_count >= 0),
  started_at          timestamptz,
  finished_at         timestamptz,
  stale_at            timestamptz,
  error_code          text,
  error_detail        text,
  attestation_state   text not null default 'analyst_submitted'
                      check (attestation_state in ('server_collected', 'analyst_submitted', 'legacy_unattested')),
  metadata            jsonb not null default '{}'::jsonb,
  unique (report_version_id, check_id)
);
create index if not exists check_runs_report_idx
  on public.check_runs (report_version_id, state);

create table if not exists public.case_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  case_id             uuid not null references public.cases(id) on delete cascade,
  report_version_id   uuid references public.report_versions(id) on delete set null,
  actor_user_id       uuid references auth.users(id) on delete set null,
  event_type          text not null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists case_events_case_created_idx
  on public.case_events (case_id, created_at desc);

create table if not exists public.usage_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  user_id           uuid references auth.users(id) on delete set null,
  event_type        text not null,
  route             text,
  units             numeric not null default 1 check (units >= 0),
  estimated_cost_usd numeric check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists usage_events_daily_idx
  on public.usage_events (organization_id, user_id, event_type, created_at desc);

create table if not exists public.share_links (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  report_version_id   uuid not null references public.report_versions(id) on delete cascade,
  token_hash          text not null unique,
  created_by          uuid references auth.users(id) on delete set null,
  expires_at          timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now()
);

-- Make the legacy stores tenant aware without invalidating existing reports.
alter table public.graph_contributions
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists contributor_user_id uuid references auth.users(id) on delete set null,
  add column if not exists aliases jsonb not null default '[]'::jsonb;
update public.graph_contributions
set organization_id = '00000000-0000-4000-8000-000000000001'
where organization_id is null;
alter table public.graph_contributions
  alter column organization_id set default '00000000-0000-4000-8000-000000000001',
  alter column organization_id set not null;
create unique index if not exists graph_contributions_org_key_uidx
  on public.graph_contributions (organization_id, canonical_key);
create index if not exists graph_contributions_org_updated_idx
  on public.graph_contributions (organization_id, updated_at desc);

alter table public.audit_log
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists contributor_user_id uuid references auth.users(id) on delete set null;
update public.audit_log
set organization_id = '00000000-0000-4000-8000-000000000001'
where organization_id is null;
alter table public.audit_log
  alter column organization_id set default '00000000-0000-4000-8000-000000000001',
  alter column organization_id set not null;
create unique index if not exists audit_log_org_client_uidx
  on public.audit_log (organization_id, client_id);
create index if not exists audit_log_org_ts_idx
  on public.audit_log (organization_id, ts desc);

alter table public.reports
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists report_version_id uuid references public.report_versions(id) on delete set null,
  add column if not exists attestation_state text not null default 'legacy_unattested'
    check (attestation_state in ('server_collected', 'analyst_submitted', 'legacy_unattested'));
update public.reports
set organization_id = '00000000-0000-4000-8000-000000000001'
where organization_id is null;
alter table public.reports
  alter column organization_id set default '00000000-0000-4000-8000-000000000001',
  alter column organization_id set not null;
create unique index if not exists reports_org_ref_kind_uidx
  on public.reports (organization_id, ref, kind);
create index if not exists reports_org_ts_idx
  on public.reports (organization_id, ts desc);

-- Keep updated timestamps deterministic and remove the mutable search_path
-- warning on the legacy trigger function.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_touch on public.organizations;
create trigger organizations_touch
  before update on public.organizations
  for each row execute function public.touch_updated_at();
drop trigger if exists argus_members_touch on public.argus_members;
create trigger argus_members_touch
  before update on public.argus_members
  for each row execute function public.touch_updated_at();
drop trigger if exists cases_touch on public.cases;
create trigger cases_touch
  before update on public.cases
  for each row execute function public.touch_updated_at();
drop trigger if exists graph_contributions_touch on public.graph_contributions;
create trigger graph_contributions_touch
  before insert or update on public.graph_contributions
  for each row execute function public.touch_updated_at();

-- Persist a report as a new immutable version. Advisory locking serializes two
-- simultaneous completions of the same case so version numbers cannot collide.
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
security definer
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_report_version_id uuid;
  v_version integer;
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
  if p_completeness_state not in ('complete', 'partial', 'failed') then
    raise exception 'invalid completeness state';
  end if;
  if p_attestation_state not in ('server_collected', 'analyst_submitted', 'legacy_unattested') then
    raise exception 'invalid attestation state';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_kind || ':' || p_canonical_ref, 0)
  );

  insert into public.cases (
    organization_id, kind, canonical_ref, display_query, created_by
  ) values (
    p_organization_id, p_kind, p_canonical_ref, p_query, p_created_by
  )
  on conflict (organization_id, kind, canonical_ref)
  do update set display_query = excluded.display_query, updated_at = now()
  returning id into v_case_id;

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

  select coalesce(max(rv.version), 0) + 1
  into v_version
  from public.report_versions rv
  where rv.case_id = v_case_id;

  insert into public.report_versions (
    case_id, organization_id, version, payload, verdict, score,
    completeness_state, methodology_version, provider_snapshot, cost, run_id,
    attestation_state, created_by
  ) values (
    v_case_id, p_organization_id, v_version, p_payload, p_verdict, p_score,
    p_completeness_state, p_methodology_version, coalesce(p_provider_snapshot, '{}'::jsonb),
    coalesce(p_cost, '{}'::jsonb), nullif(p_run_id, ''), p_attestation_state, p_created_by
  ) returning id into v_report_version_id;

  insert into public.case_events (
    organization_id, case_id, report_version_id, actor_user_id, event_type,
    metadata
  ) values (
    p_organization_id, v_case_id, v_report_version_id, p_created_by,
    'report.version.created', jsonb_build_object('version', v_version, 'attestation', p_attestation_state)
  );

  return query select v_case_id, v_report_version_id, v_version;
end;
$$;

-- Atomically enforce a per-user daily quota and record the accepted unit.
create or replace function public.consume_usage_quota(
  p_organization_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_route text,
  p_daily_limit integer,
  p_metadata jsonb default '{}'::jsonb,
  p_units numeric default 1
)
returns table (allowed boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_daily_limit < 1 or p_units <= 0 then
    raise exception 'daily limit must be positive';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_user_id::text || ':' || p_event_type || ':' || current_date::text,
      0
    )
  );

  select coalesce(ceil(sum(ue.units)), 0)::integer
  into v_used
  from public.usage_events ue
  where ue.organization_id = p_organization_id
    and ue.user_id = p_user_id
    and ue.event_type = p_event_type
    and ue.created_at >= date_trunc('day', now());

  if v_used + ceil(p_units)::integer > p_daily_limit then
    return query select false, v_used, 0;
    return;
  end if;

  insert into public.usage_events (
    organization_id, user_id, event_type, route, units, metadata
  ) values (
    p_organization_id, p_user_id, p_event_type, p_route, p_units, coalesce(p_metadata, '{}'::jsonb)
  );

  v_used := v_used + ceil(p_units)::integer;
  return query select true, v_used, greatest(p_daily_limit - v_used, 0);
end;
$$;

-- RLS is defense in depth. The browser normally reads through authenticated API
-- routes, but any direct Data API read remains constrained to the user's org.
alter table public.organizations enable row level security;
alter table public.argus_members enable row level security;
alter table public.cases enable row level security;
alter table public.report_versions enable row level security;
alter table public.evidence_items enable row level security;
alter table public.check_runs enable row level security;
alter table public.case_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.share_links enable row level security;
alter table public.graph_contributions enable row level security;
alter table public.audit_log enable row level security;
alter table public.reports enable row level security;

drop policy if exists members_read_self on public.argus_members;
create policy members_read_self on public.argus_members
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists organizations_read_member_org on public.organizations;
create policy organizations_read_member_org on public.organizations
  for select to authenticated
  using (id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));

drop policy if exists cases_read_member_org on public.cases;
create policy cases_read_member_org on public.cases
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists report_versions_read_member_org on public.report_versions;
create policy report_versions_read_member_org on public.report_versions
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists evidence_items_read_member_org on public.evidence_items;
create policy evidence_items_read_member_org on public.evidence_items
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists check_runs_read_member_org on public.check_runs;
create policy check_runs_read_member_org on public.check_runs
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists case_events_read_member_org on public.case_events;
create policy case_events_read_member_org on public.case_events
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists usage_events_read_self on public.usage_events;
create policy usage_events_read_self on public.usage_events
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (
      select m.organization_id from public.argus_members m
      where m.user_id = (select auth.uid()) and m.active
    )
  );
drop policy if exists share_links_read_creator on public.share_links;
create policy share_links_read_creator on public.share_links
  for select to authenticated
  using (
    created_by = (select auth.uid())
    and organization_id in (
      select m.organization_id from public.argus_members m
      where m.user_id = (select auth.uid()) and m.active
    )
  );

drop policy if exists graph_contributions_read_member_org on public.graph_contributions;
create policy graph_contributions_read_member_org on public.graph_contributions
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists audit_log_read_member_org on public.audit_log;
create policy audit_log_read_member_org on public.audit_log
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));
drop policy if exists reports_read_member_org on public.reports;
create policy reports_read_member_org on public.reports
  for select to authenticated
  using (organization_id in (
    select m.organization_id from public.argus_members m
    where m.user_id = (select auth.uid()) and m.active
  ));

-- No browser-side writes. All mutations go through authenticated API handlers,
-- where role and quota checks run, using the server-only service role.
revoke all on table public.organizations, public.argus_members, public.cases,
  public.report_versions, public.evidence_items, public.check_runs,
  public.case_events, public.usage_events, public.share_links,
  public.graph_contributions, public.audit_log, public.reports
  from anon, authenticated;
grant select on table public.organizations, public.argus_members, public.cases,
  public.report_versions, public.evidence_items, public.check_runs,
  public.case_events, public.usage_events, public.graph_contributions,
  public.audit_log, public.reports
  to authenticated;

-- New Supabase projects no longer expose newly-created tables to the Data API
-- automatically. Explicit server-role grants keep PostgREST available to the
-- authenticated API layer while anon/authenticated browser writes stay revoked.
grant usage on schema public to service_role;
grant all on table public.organizations, public.argus_members, public.cases,
  public.report_versions, public.evidence_items, public.check_runs,
  public.case_events, public.usage_events, public.share_links,
  public.graph_contributions, public.audit_log, public.reports
  to service_role;

revoke all on function public.persist_report_version(uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.consume_usage_quota(uuid, uuid, text, text, integer, jsonb, numeric)
  from public, anon, authenticated;
grant execute on function public.persist_report_version(uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text, text, jsonb, jsonb)
  to service_role;
grant execute on function public.consume_usage_quota(uuid, uuid, text, text, integer, jsonb, numeric)
  to service_role;
