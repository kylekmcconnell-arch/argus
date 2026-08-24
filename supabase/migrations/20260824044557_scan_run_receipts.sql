-- Owner operations ledger for every credit-bearing scan attempt.
-- Provider/check detail remains in the immutable report tables when a report
-- exists; this table preserves the run itself when collection or persistence
-- fails before an immutable report version can be created.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.scan_run_receipts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  run_key               text not null check (char_length(run_key) between 8 and 220),
  initiated_by          uuid not null,
  route                 text not null check (char_length(route) between 1 and 160),
  kind                  text not null check (kind in ('person', 'token', 'investigation', 'site')),
  canonical_ref         text not null check (char_length(canonical_ref) between 1 and 500),
  display_query         text not null check (char_length(display_query) between 1 and 500),
  private_run           boolean not null default false,
  status                text not null check (status in ('running', 'complete', 'degraded', 'failed')),
  credits_charged_millis bigint not null default 0 check (credits_charged_millis >= 0),
  report_version_id     uuid,
  provider_cost_usd     numeric check (provider_cost_usd is null or provider_cost_usd >= 0),
  cost_basis            text not null default 'unknown' check (cost_basis in ('exact', 'estimated', 'unknown')),
  started_at            timestamptz not null,
  finished_at           timestamptz,
  duration_ms           integer check (duration_ms is null or duration_ms >= 0),
  failure_code          text check (failure_code is null or char_length(failure_code) <= 100),
  failure_detail        text check (failure_detail is null or char_length(failure_detail) <= 500),
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint scan_run_receipts_org_run_key_unique unique (organization_id, run_key),
  constraint scan_run_receipts_initiated_member_fkey
    foreign key (organization_id, initiated_by)
    references public.argus_members (organization_id, user_id)
    on delete restrict,
  constraint scan_run_receipts_report_version_fkey
    foreign key (organization_id, report_version_id)
    references public.report_versions (organization_id, id)
    on delete restrict,
  constraint scan_run_receipts_terminal_shape check (
    (status = 'running' and finished_at is null and duration_ms is null)
    or (status <> 'running' and finished_at is not null and duration_ms is not null)
  ),
  constraint scan_run_receipts_cost_shape check (
    (cost_basis = 'unknown' and provider_cost_usd is null)
    or (cost_basis <> 'unknown' and provider_cost_usd is not null)
  )
);

create index scan_run_receipts_org_started_idx
  on public.scan_run_receipts (organization_id, started_at desc, id desc);
create index scan_run_receipts_org_status_started_idx
  on public.scan_run_receipts (organization_id, status, started_at desc);
create index scan_run_receipts_report_version_idx
  on public.scan_run_receipts (organization_id, report_version_id)
  where report_version_id is not null;

create function public.enforce_scan_run_receipt_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.organization_id <> new.organization_id
    or old.run_key <> new.run_key
    or old.initiated_by <> new.initiated_by
    or old.route <> new.route
    or old.kind <> new.kind
    or old.canonical_ref <> new.canonical_ref
    or old.private_run <> new.private_run
    or old.credits_charged_millis <> new.credits_charged_millis
    or old.started_at <> new.started_at
    or old.created_at <> new.created_at then
    raise exception 'scan receipt identity is immutable';
  end if;
  if old.status <> 'running' then
    raise exception 'terminal scan receipt is immutable';
  end if;
  if new.status = 'running' then
    raise exception 'scan receipt may only transition to a terminal state';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_scan_run_receipt_transition() from public, anon, authenticated;
grant execute on function public.enforce_scan_run_receipt_transition() to service_role;

create trigger scan_run_receipts_transition_guard
  before update on public.scan_run_receipts
  for each row execute function public.enforce_scan_run_receipt_transition();

create trigger scan_run_receipts_touch
  before update on public.scan_run_receipts
  for each row execute function public.touch_updated_at();

alter table public.scan_run_receipts enable row level security;
revoke all on table public.scan_run_receipts from public, anon, authenticated;
grant select, insert, update on table public.scan_run_receipts to service_role;

commit;
