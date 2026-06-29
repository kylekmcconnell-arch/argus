-- ARGUS shared trust graph — community-wide persistent store.
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
