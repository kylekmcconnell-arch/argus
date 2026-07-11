-- Append-only, exact-version provider usage accounting.
--
-- report_cost_lines remains the backwards-compatible aggregate read model.
-- Every new event is first written once under a tenant idempotency key, then
-- atomically added to that projection so repeat runs accumulate without a
-- retried request being counted twice.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.provider_usage_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null
                      references public.organizations(id) on delete restrict,
  report_version_id   uuid not null,
  idempotency_key     text not null
                      check (char_length(idempotency_key) between 1 and 200),
  provider            text not null
                      check (char_length(provider) between 1 and 100),
  operation           text not null
                      check (char_length(operation) between 1 and 160),
  calls               integer not null check (calls >= 0),
  usd                 numeric not null check (usd >= 0),
  status              text not null default 'succeeded'
                      check (status in ('succeeded', 'failed', 'partial', 'cached')),
  meta                text check (meta is null or char_length(meta) <= 500),
  initiated_by        uuid,
  created_at          timestamptz not null default now(),
  constraint provider_usage_events_org_idempotency_key
    unique (organization_id, idempotency_key),
  constraint provider_usage_events_organization_report_version_fkey
    foreign key (organization_id, report_version_id)
    references public.report_versions (organization_id, id)
    on delete restrict,
  constraint provider_usage_events_initiated_member_fkey
    foreign key (organization_id, initiated_by)
    references public.argus_members (organization_id, user_id)
    on delete restrict
);

create index provider_usage_events_org_version_created_idx
  on public.provider_usage_events (
    organization_id,
    report_version_id,
    created_at desc,
    id desc
  );
create index provider_usage_events_org_created_idx
  on public.provider_usage_events (
    organization_id,
    created_at desc,
    id desc
  );
create index provider_usage_events_org_provider_operation_created_idx
  on public.provider_usage_events (
    organization_id,
    provider,
    operation,
    created_at desc,
    id desc
  );
create index provider_usage_events_initiated_member_idx
  on public.provider_usage_events (organization_id, initiated_by, created_at desc)
  where initiated_by is not null;

create or replace function public.reject_provider_usage_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'provider usage events are immutable';
end;
$$;

create trigger provider_usage_events_immutable
  before update or delete on public.provider_usage_events
  for each row execute function public.reject_provider_usage_event_mutation();

create or replace function public.record_provider_usage_event(
  p_organization_id uuid,
  p_report_version_id uuid,
  p_idempotency_key text,
  p_provider text,
  p_operation text,
  p_calls integer,
  p_usd numeric,
  p_initiated_by uuid default null,
  p_status text default 'succeeded',
  p_meta text default null
)
returns public.provider_usage_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.provider_usage_events;
  v_inserted boolean := false;
  v_idempotency_key text := pg_catalog.btrim(p_idempotency_key);
  v_provider text := pg_catalog.btrim(p_provider);
  v_operation text := pg_catalog.btrim(p_operation);
  v_meta text := nullif(pg_catalog.btrim(p_meta), '');
  v_projection_rows integer;
  v_previous_projection_marker text := pg_catalog.current_setting(
    'argus.provider_usage_projection_event',
    true
  );
begin
  if v_idempotency_key is null
     or char_length(v_idempotency_key) not between 1 and 200
     or v_provider is null
     or char_length(v_provider) not between 1 and 100
     or v_operation is null
     or char_length(v_operation) not between 1 and 160
     or p_calls is null
     or p_calls < 0
     or p_usd is null
     or p_usd < 0
     or p_status is null
     or p_status not in ('succeeded', 'failed', 'partial', 'cached')
     or (v_meta is not null and char_length(v_meta) > 500) then
    raise exception using errcode = '22023', message = 'invalid provider usage event';
  end if;

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

  if p_initiated_by is not null and not exists (
    select 1
    from public.argus_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_initiated_by
      and member.active
  ) then
    raise exception using
      errcode = '42501',
      message = 'active organization member required for initiated_by';
  end if;

  insert into public.provider_usage_events (
    organization_id,
    report_version_id,
    idempotency_key,
    provider,
    operation,
    calls,
    usd,
    status,
    meta,
    initiated_by
  ) values (
    p_organization_id,
    p_report_version_id,
    v_idempotency_key,
    v_provider,
    v_operation,
    p_calls,
    p_usd,
    p_status,
    v_meta,
    p_initiated_by
  )
  on conflict on constraint provider_usage_events_org_idempotency_key do nothing
  returning * into v_event;
  v_inserted := found;

  if not v_inserted then
    select event.* into strict v_event
    from public.provider_usage_events event
    where event.organization_id = p_organization_id
      and event.idempotency_key = v_idempotency_key;

    if v_event.report_version_id is distinct from p_report_version_id
       or v_event.provider is distinct from v_provider
       or v_event.operation is distinct from v_operation
       or v_event.calls is distinct from p_calls
       or v_event.usd is distinct from p_usd
       or v_event.status is distinct from p_status
       or v_event.meta is distinct from v_meta
       or v_event.initiated_by is distinct from p_initiated_by then
      raise exception using
        errcode = '40001',
        message = 'provider usage idempotency key already exists with different immutable content';
    end if;

    return v_event;
  end if;

  -- Keep the established report response shape intact while making it a true
  -- aggregate over append-only events. PostgreSQL's ON CONFLICT update is
  -- atomic, so simultaneous distinct events cannot lose one another's spend.
  -- The transaction-local marker tells the compatibility triggers below that
  -- this projection write already has an immutable source event.
  perform pg_catalog.set_config(
    'argus.provider_usage_projection_event',
    v_event.id::text,
    true
  );
  insert into public.report_cost_lines (
    organization_id,
    report_version_id,
    provider,
    operation,
    calls,
    usd,
    meta
  ) values (
    p_organization_id,
    p_report_version_id,
    v_provider,
    v_operation,
    p_calls,
    p_usd,
    v_meta
  )
  on conflict (report_version_id, provider, operation)
  do update set
    calls = public.report_cost_lines.calls + excluded.calls,
    usd = public.report_cost_lines.usd + excluded.usd,
    meta = coalesce(excluded.meta, public.report_cost_lines.meta),
    updated_at = pg_catalog.now()
  where public.report_cost_lines.organization_id = excluded.organization_id;

  get diagnostics v_projection_rows = row_count;
  if v_projection_rows <> 1 then
    raise exception using
      errcode = '23503',
      message = 'provider usage cost projection tenant mismatch';
  end if;

  perform pg_catalog.set_config(
    'argus.provider_usage_projection_event',
    coalesce(v_previous_projection_marker, ''),
    true
  );

  return v_event;
end;
$$;

-- A request can already be executing the pre-cutover function body while this
-- migration replaces that function. CREATE TRIGGER takes a table lock: writes
-- that already reached report_cost_lines finish before the trigger is installed,
-- while a paused old body that reaches the table after commit sees these guards.
-- This closes the function-replacement race instead of relying on DDL visibility.
create or replace function public.bridge_legacy_report_cost_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(
    pg_catalog.current_setting('argus.provider_usage_projection_event', true),
    ''
  ) is not null then
    return new;
  end if;

  -- The retired RPC assigned the latest request totals on conflict. Convert a
  -- pre-resolved old body to additive semantics so its event and projection
  -- remain consistent with the append-only ledger.
  new.calls := old.calls + new.calls;
  new.usd := old.usd + new.usd;
  return new;
end;
$$;

create or replace function public.capture_legacy_report_cost_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_calls integer;
  v_usd numeric;
begin
  if nullif(
    pg_catalog.current_setting('argus.provider_usage_projection_event', true),
    ''
  ) is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_calls := new.calls;
    v_usd := new.usd;
  else
    v_calls := new.calls - old.calls;
    v_usd := new.usd - old.usd;
  end if;

  if v_calls < 0 or v_usd < 0 then
    raise exception using
      errcode = '22023',
      message = 'legacy report cost write cannot reduce append-only usage';
  end if;

  insert into public.provider_usage_events (
    organization_id,
    report_version_id,
    idempotency_key,
    provider,
    operation,
    calls,
    usd,
    status,
    meta
  ) values (
    new.organization_id,
    new.report_version_id,
    'legacy-projection:' || pg_catalog.gen_random_uuid()::text,
    new.provider,
    new.operation,
    v_calls,
    v_usd,
    'succeeded',
    new.meta
  );

  return new;
end;
$$;

create trigger report_cost_lines_bridge_legacy_update
  before update on public.report_cost_lines
  for each row execute function public.bridge_legacy_report_cost_update();

create trigger report_cost_lines_capture_legacy_write
  after insert or update on public.report_cost_lines
  for each row execute function public.capture_legacy_report_cost_write();

create or replace function public.get_provider_usage_summary(
  p_organization_id uuid,
  p_report_version_id uuid default null
)
returns table (
  event_count bigint,
  calls bigint,
  usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    pg_catalog.count(*)::bigint as event_count,
    coalesce(pg_catalog.sum(event.calls), 0)::bigint as calls,
    coalesce(pg_catalog.sum(event.usd), 0)::numeric as usd
  from public.provider_usage_events event
  where event.organization_id = p_organization_id
    and (
      p_report_version_id is null
      or event.report_version_id = p_report_version_id
    );
$$;

-- CREATE TRIGGER has already drained writes that reached this table and holds a
-- SHARE ROW EXCLUSIVE lock through commit. Keep the lock explicit for the
-- snapshot below and fail closed under sustained write traffic.
lock table public.report_cost_lines in share row exclusive mode;

-- Backwards-compatible write bridge for old Vercel instances. Calls that
-- resolve after this transaction commits append through the new ledger even
-- before the application deployment switches to record_provider_usage_event.
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
  perform public.record_provider_usage_event(
    p_organization_id,
    p_report_version_id,
    'legacy-rpc:' || pg_catalog.gen_random_uuid()::text,
    p_provider,
    p_operation,
    p_calls,
    p_usd,
    null,
    'succeeded',
    p_meta
  );
end;
$$;

-- Existing aggregate rows predate event-level accounting. Preserve their
-- totals as one explicitly identified legacy event rather than guessing at the
-- underlying requests. This is a direct history backfill: it intentionally does
-- not mutate the already-correct report_cost_lines projection.
insert into public.provider_usage_events (
  organization_id,
  report_version_id,
  idempotency_key,
  provider,
  operation,
  calls,
  usd,
  status,
  meta,
  created_at
)
select
  line.organization_id,
  line.report_version_id,
  'legacy-report-cost-line:' || line.id::text,
  line.provider,
  line.operation,
  line.calls,
  line.usd,
  'succeeded',
  line.meta,
  line.created_at
from public.report_cost_lines line
on conflict on constraint provider_usage_events_org_idempotency_key do nothing;

alter table public.provider_usage_events enable row level security;

create policy provider_usage_events_read_member_org
  on public.provider_usage_events
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and organization_id in (
      select member.organization_id
      from public.argus_members member
      where member.user_id = (select auth.uid())
        and member.active
    )
  );

revoke all on table public.provider_usage_events
  from public, anon, authenticated, service_role;
grant select on table public.provider_usage_events to authenticated;
-- Writes are server-only and append-only. The service role needs SELECT for
-- idempotent replay checks and INSERT for the RPC, but never mutation/removal.
grant select, insert on table public.provider_usage_events to service_role;

revoke all on function public.reject_provider_usage_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.bridge_legacy_report_cost_update()
  from public, anon, authenticated, service_role;
revoke all on function public.capture_legacy_report_cost_write()
  from public, anon, authenticated, service_role;
revoke all on function public.record_provider_usage_event(
  uuid, uuid, text, text, text, integer, numeric, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.record_provider_usage_event(
  uuid, uuid, text, text, text, integer, numeric, uuid, text, text
) to service_role;
revoke all on function public.get_provider_usage_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_provider_usage_summary(uuid, uuid)
  to service_role;
revoke all on function public.upsert_report_cost_line(
  uuid, uuid, text, text, integer, numeric, text
) from public, anon, authenticated;
grant execute on function public.upsert_report_cost_line(
  uuid, uuid, text, text, integer, numeric, text
) to service_role;

commit;
