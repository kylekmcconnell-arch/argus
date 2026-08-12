-- LEGACY REFERENCE ONLY — do not run this file on a new or upgraded project.
-- The authoritative, zero-downtime schema is in supabase/migrations/. Apply it
-- with `supabase db push` after linking the intended project.
--
-- ARGUS shared trust graph — original community-wide persistent store.
--
-- Every audit contributes its Panoptes subgraph here, so the network compounds
-- across ALL analysts (Kyle + Enigma), not just one browser's localStorage. A
-- token two people audit that share a deployer bridge automatically; a funder
-- bankrolling launches across separate investigations becomes a serial-operator
-- hub visible to everyone. This table IS the moat.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SETUP (Kyle, one time — I can't provision infra or hold credentials):
--   1. Create a Supabase project (or reuse one). Open the SQL editor and run
--      this whole file.
--   2. Get the project URL and the SERVICE ROLE key (Settings → API). The
--      service role key is SECRET — it bypasses RLS. Never put it in client code.
--   3. Add both to Vercel (Production) for the `argus` project:
--        vercel env add SUPABASE_URL production
--        vercel env add SUPABASE_SERVICE_ROLE_KEY production
--      then redeploy (git push, or `vercel --prod`).
--   With these set, /api/graph goes live and the graph becomes shared. With them
--   UNSET, ARGUS silently stays local-only (today's behavior) — nothing breaks.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.graph_contributions (
  id            uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,          -- normalized subject id (one row per subject; re-audits upsert)
  handle        text not null,                 -- display label ($SYM, @handle, project name)
  verdict       text,                          -- subject verdict, when known
  nodes         jsonb not null default '[]'::jsonb,
  edges         jsonb not null default '[]'::jsonb,
  contributor   text,                          -- optional analyst tag (anonymous by default)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists graph_contributions_updated_idx
  on public.graph_contributions (updated_at desc);

-- Re-audits sort as most-recent (latest-wins ordering on read).
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists graph_contributions_touch on public.graph_contributions;
create trigger graph_contributions_touch
  before insert or update on public.graph_contributions
  for each row execute function public.touch_updated_at();

-- Lock the table to the service role only. The API talks to it with the service
-- role key (server-side, in a Vercel env var); the anon key can't read or write.
alter table public.graph_contributions enable row level security;

-- ── Shared "Recent audits" log (community feed) ─────────────────────────────
-- Append-only history of every audit run, tagged by analyst, so Kyle + Enigma
-- see each other's scans. Same service-role-only access as graph_contributions.
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null unique,   -- LogEntry.id namespaced by contributor (idempotent re-posts)
  ts          timestamptz not null,   -- client audit time (ordering must match the analyst's view)
  kind        text not null,          -- 'site' | 'token' | 'person'
  query       text not null,
  ref         text,
  image       text,
  verdict     text,
  score       numeric,
  summary     text not null default '',
  coverage    text,
  flags       jsonb not null default '[]'::jsonb,
  contributor text not null,          -- analyst tag (a shared rail with anonymous rows is useless)
  inserted_at timestamptz not null default now()
);
create index if not exists audit_log_ts_idx on public.audit_log (ts desc);
alter table public.audit_log enable row level security;  -- service-role only

-- ── Persistent reports (full rendered audits) ───────────────────────────────
-- The complete Dossier/TokenDossier/Investigation payload, latest-wins per
-- subject, so a recent audit re-opens the real report (across reloads, and
-- across analysts) instead of re-running. Service-role only.
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null,          -- normalized subject id (handle / contract)
  kind        text not null,          -- 'person' | 'token' | 'investigation'
  query       text,                   -- display label
  contributor text not null default 'anonymous',
  payload     jsonb not null,         -- the full serialized report
  verdict     text,
  score       numeric,
  ts          timestamptz not null default now()
);
create unique index if not exists reports_ref_kind_uidx on public.reports (ref, kind);
create index if not exists reports_ts_idx on public.reports (ts desc);
alter table public.reports enable row level security;
