begin;
-- Provider sentinel: live key/credit probe state, 30-day history, alert log,
-- and run log. Deployment-wide operational data (not tenant data), written and
-- read only by the service role from /api/provider-sentinel and
-- /api/provider-status. RLS is enabled with no policies, so anon and
-- authenticated clients can never read provider state directly.

create table public.provider_status (
  provider text primary key check (provider ~ '^[a-z0-9-]{1,40}$'),
  label text not null,
  status text not null check (status in ('ok','degraded','down','not_configured')),
  reason text check (reason is null or reason in ('missing_key','auth_invalid','out_of_credits','rate_limited','timeout','provider_error_5xx','unexpected_response')),
  detail text not null default '' check (char_length(detail) <= 400),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  http_status integer,
  costly boolean not null default false,
  optional boolean not null default false,
  low_credit boolean not null default false,
  balance jsonb,
  checked_at timestamptz not null,
  last_ok_at timestamptz,
  last_change_at timestamptz
);

create table public.provider_checks (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  provider text not null,
  status text not null check (status in ('ok','degraded','down','not_configured')),
  reason text,
  detail text not null default '' check (char_length(detail) <= 400),
  latency_ms integer,
  http_status integer,
  low_credit boolean not null default false,
  balance jsonb,
  checked_at timestamptz not null default now()
);
create index provider_checks_provider_time on public.provider_checks (provider, checked_at desc);
create index provider_checks_time on public.provider_checks (checked_at);

create table public.provider_alerts (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  provider text not null,
  kind text not null check (kind in ('down','degraded','recovered','low_credit')),
  status text not null check (status in ('ok','degraded','down','not_configured')),
  detail text not null default '' check (char_length(detail) <= 400),
  delivered boolean not null default false,
  sent_at timestamptz not null default now()
);
create index provider_alerts_dedupe on public.provider_alerts (provider, kind, sent_at desc) where delivered;
create index provider_alerts_time on public.provider_alerts (sent_at);

create table public.provider_sentinel_runs (
  id uuid primary key,
  trigger text not null check (trigger in ('cron','manual')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  summary jsonb not null default '{}'::jsonb,
  alerts_sent integer not null default 0,
  email_status text not null default 'none'
);
create index provider_sentinel_runs_time on public.provider_sentinel_runs (started_at desc);

alter table public.provider_status enable row level security;
alter table public.provider_checks enable row level security;
alter table public.provider_alerts enable row level security;
alter table public.provider_sentinel_runs enable row level security;

revoke all on public.provider_status from public, anon, authenticated;
revoke all on public.provider_checks from public, anon, authenticated;
revoke all on public.provider_alerts from public, anon, authenticated;
revoke all on public.provider_sentinel_runs from public, anon, authenticated;

grant select, insert, update on public.provider_status to service_role;
grant select, insert, delete on public.provider_checks to service_role;
grant select, insert, delete on public.provider_alerts to service_role;
grant select, insert, delete on public.provider_sentinel_runs to service_role;

commit;
