# SPEC: Shared "Recent audits" rail (community audit log)

Handover spec — written by a parallel Claude session that provisioned the shared-graph
backend on 2026-07-02. That session is NOT touching code; this doc is the full context
you need. Kyle's ask, verbatim: *"I don't see what scans Enigma is running on the
recent audits thing on the left sidebar."*

## Goal

The Recent-audits list in `src/components/Sidebar.tsx` currently reads only the local
browser log (`src/lib/auditlog.ts`, localStorage key `argus:auditlog`). Make it show
ALL analysts' scans (Kyle + Enigma), merged with local, tagged by who ran them —
same silent env-gated pattern as the shared graph: backend configured → shared;
not configured → exactly today's local-only behavior, nothing breaks.

## Infra that ALREADY EXISTS (do not re-provision)

- Supabase project `argus`, ref `mpjpmgdklxpzggypmpwn` (us-east-1, same org as
  kindred-ai). Holds `graph_contributions` (the shared graph, live and verified).
- Vercel production env vars `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are SET
  on the `argus` Vercel project. `api/graph.ts` uses them; reuse the same two.
- To run SQL without psql (not installed): Supabase management API. The CLI token is
  in the macOS keychain, base64-wrapped. MUST be curl — Cloudflare 1010-blocks
  python urllib's user-agent:

  ```sh
  RAW=$(security find-generic-password -s "Supabase CLI" -w)
  TOKEN=$(echo "${RAW#go-keyring-base64:}" | base64 -d)
  curl -sS -X POST "https://api.supabase.com/v1/projects/mpjpmgdklxpzggypmpwn/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"query":"<SQL here>"}'
  ```

## 1. Table (append to `supabase/schema.sql`, then run just the new DDL via the API above)

Mirror `LogEntry` (src/lib/auditlog.ts). Unlike `graph_contributions` (latest-wins
upsert per subject), the audit log is APPEND-ONLY history — a re-audit is a new row.

```sql
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null unique,   -- the client's LogEntry.id namespaced by contributor (idempotent re-posts)
  ts          timestamptz not null,   -- client audit time (NOT inserted_at; ordering must match the analyst's view)
  kind        text not null,          -- 'site' | 'token' | 'person'
  query       text not null,
  ref         text,
  image       text,
  verdict     text,
  score       numeric,
  summary     text not null default '',
  coverage    text,
  flags       jsonb not null default '[]'::jsonb,
  contributor text not null,          -- analyst tag, required here (a shared rail with anonymous rows is useless)
  inserted_at timestamptz not null default now()
);
create index if not exists audit_log_ts_idx on public.audit_log (ts desc);
alter table public.audit_log enable row level security;  -- service-role only, like graph_contributions
```

## 2. API: `api/auditlog.ts` — clone the shape of `api/graph.ts` exactly

Same `creds()` gating on SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, same PostgREST
fetch with service-role headers, same `available:false` fallback when unset, same
`config = { maxDuration: 15 }`, same never-throw (errors return 200 + `error` field).

- `GET  /api/auditlog` → `{ available, entries: LogEntry-shaped[] }` — newest 200
  (`order=ts.desc&limit=200`). Map rows to the client `LogEntry` shape + `contributor`.
- `POST /api/auditlog` body = LogEntry + contributor → `{ ok }`. Insert with
  `on_conflict=client_id` + `prefer: resolution=ignore-duplicates` (idempotent retries).
  Sanitize like graph.ts does: slice strings (query/summary 500, contributor 80),
  cap flags at 20, reject missing kind/query/contributor with 400. `client_id` =
  `${contributor}:${entry.id}` — the local id generator (ts+counter) collides across
  browsers, so it MUST be namespaced server-side or client-side.

## 3. Analyst identity (new, tiny)

Nothing sets `contributor` today — api/graph.ts accepts it but the client never sends
it. Add `src/lib/analyst.ts`: `getAnalyst(): string | null` reading localStorage
`argus:analyst`; a one-line "Signing audits as ___" inline edit in the Sidebar footer
(or Admin page) to set it. Then:
- Send it on audit-log POSTs (required — skip sync silently if unset, or default to
  "anonymous"; RECOMMEND: default "anonymous" so sharing works day one with zero setup).
- Bonus, one line: also pass it as `contributor` in the graph sync in
  `src/graph/store.ts` — the field already exists end-to-end there.

## 4. Client sync in `src/lib/auditlog.ts` — copy the pattern from `src/graph/store.ts`

localStorage stays the synchronous working cache; the backend is additive.

- `logAudit()`: after the local write, fire-and-forget `fetch(POST /api/auditlog)`
  with the entry + contributor. Never await in the caller path, never throw.
- New `hydrateSharedLog(): Promise<LogEntry[]>`: GET, on `available:true` merge
  remote entries into the in-memory view (NOT into the local localStorage log —
  keep "mine" and "community" separable), de-duped by namespaced id, sorted by ts
  desc. Mark remote-only entries with their `contributor`.
- Add `contributor?: string` to `LogEntry` (optional — existing local entries lack it).
- Pub/sub or a simple refresh callback so the Sidebar re-renders when hydration lands
  (graph store's `subscribeGraph` is the in-repo precedent).

## 5. Sidebar UI (`src/components/Sidebar.tsx`)

- Render the merged list. Entries from other analysts get a small contributor tag
  (e.g. Enigma's name); own entries look exactly as today ("you" tag optional).
  Keep click-to-re-run working for remote entries — `ref`/`kind` travel through.
- `logStats` (auditlog.ts) is also used by AdminPage — either keep it fed with
  local-only (fine) or the merged list; just don't break its callers
  (App.tsx, ReconPage.tsx, AdminPage.tsx, Sidebar.tsx all import from auditlog).

## Non-goals

- NOT sharing full report/dossier documents — only the log line. (Shared reports
  are a separate future build on this same Supabase project.)
- No auth/roles. Two trusted analysts; service-role key stays server-side, table
  RLS-locked exactly like graph_contributions.

## Verify (per the ARGUS bar: green build ≠ working function)

1. Table exists: management-API query `select relname, relrowsecurity from pg_class where relname='audit_log';` → `relrowsecurity: true`.
2. `curl -sS https://argus-one-flax.vercel.app/api/auditlog` → `{"available":true,"entries":[...]}`.
3. POST a smoke entry → GET shows it → delete the row via management API (keep prod clean).
4. Two-browser check (or normal + private window with different `argus:analyst`):
   run an audit in one, see it appear in the other's sidebar with the tag.
5. Env-unset regression: nothing to do — gating mirrors graph.ts; just confirm no
   sidebar crash when `available:false` (unit of trust: the graph rail already works).

## Known deploy gotchas (hit on 2026-07-02)

- `vercel redeploy <most recent prod URL from vercel ls>` can grab a FAILED
  deployment — check the Status column first. Normal git-push deploys are fine.
- Vercel build runs real tsc — implicit-any breaks the deploy even though vite dev
  doesn't care.

Delete this file once implemented (it's untracked on purpose).
