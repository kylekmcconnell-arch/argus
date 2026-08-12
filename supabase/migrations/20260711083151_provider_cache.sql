-- Deliberately global, service-only cache for public provider responses.
--
-- Provider cache entries are implementation details, not tenant reports. Moving
-- them out of public.reports lets every report-like artifact become explicitly
-- organization-scoped without exposing cached prompts/results to members.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.provider_cache (
  cache_key   text primary key check (char_length(cache_key) between 3 and 120),
  payload     jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index provider_cache_expires_idx
  on public.provider_cache (expires_at);

drop trigger if exists provider_cache_touch on public.provider_cache;
create trigger provider_cache_touch
  before update on public.provider_cache
  for each row execute function public.touch_updated_at();

-- Preserve warm caches during the transition. The old report rows stay in
-- place for one release so the previous application remains rollback-safe.
insert into public.provider_cache (cache_key, payload, expires_at, created_at, updated_at)
select
  case
    when r.payload ? 'text' then 'gt:' || pg_catalog.regexp_replace(r.ref, '^g:', '')
    when r.payload ? 'value' then 'gj:' || pg_catalog.regexp_replace(r.ref, '^g:', '')
  end,
  r.payload,
  case
    -- The legacy writers used JavaScript Date.now(): exactly 13-digit
    -- milliseconds. Anything else falls back to the row timestamp so a
    -- malformed cache entry can never abort the migration.
    when r.payload ->> 'at' ~ '^[0-9]{13}$'
      then pg_catalog.to_timestamp((r.payload ->> 'at')::numeric / 1000) + interval '24 hours'
    else r.ts + interval '24 hours'
  end,
  r.ts,
  r.ts
from public.reports r
where r.kind = 'grokcache'
  and r.ref ~ '^g:[0-9a-f]{40}$'
  and (r.payload ? 'text' or r.payload ? 'value')
on conflict (cache_key) do update set
  payload = excluded.payload,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at
where public.provider_cache.updated_at <= excluded.updated_at;

-- An indexed statement-level trigger keeps the TTL cache bounded without a
-- platform-specific scheduler. It runs once per write statement, not once per
-- row, and removes only already-expired entries.
create function public.provider_cache_prune_expired()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.provider_cache
  where expires_at < pg_catalog.now();
  return null;
end;
$$;

create trigger provider_cache_prune_after_write
  after insert or update on public.provider_cache
  for each statement execute function public.provider_cache_prune_expired();

alter table public.provider_cache enable row level security;

revoke all on table public.provider_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.provider_cache to service_role;

revoke all on function public.provider_cache_prune_expired() from public, anon, authenticated;
grant execute on function public.provider_cache_prune_expired() to service_role;

commit;
