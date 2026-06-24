# ARGUS — contributor onboarding

Forensic crypto due-diligence. Vite + React + TypeScript front end, a Node
collector (`server/`) bundled into Vercel serverless functions (`api/`). Auto
deploys to the live site on push to `main`.

## 1. Access (ask Kyle)
- **GitHub:** added as a collaborator on `kylekmcconnell-arch/argus` (clone + push).
- **Vercel:** added as a member of the `argus` project — this is how you get the
  API keys without anyone pasting them.

## 2. Run it locally
```bash
git clone https://github.com/kylekmcconnell-arch/argus.git
cd argus
npm install

# pull every funded provider key straight from Vercel (recommended):
npm i -g vercel && vercel login && vercel link   # pick the "argus" project
vercel env pull .env

# ...or, without Vercel: cp .env.example .env and fill in the keys you have.

npm run dev:full     # runs the web app (Vite) + the collector server together
```
Vite prints the local URL. `npm run check-env` reports which providers are wired
(without printing any secrets).

## 3. How it's wired
- **Front end:** `src/` (React, Tailwind v4). The audit/report/investigation UI.
- **Collector:** `server/` — adapters per data source (`server/adapters/`) feed a
  shared evidence bag; `server/orchestrate.ts` runs the pipeline. It is bundled
  to `api/_collector.js` by `scripts/build-collector.mjs` (runs on every build).
- **Serverless:** `api/*.ts` are Vercel functions (e.g. `api/audit.ts` streams an
  audit, `api/deployer.ts` traces a deployer's funding chain).
- **Engine:** `src/engine/` owns scoring, caps, and the verdict (deterministic).
- **Graph:** `src/graph/` is the compounding trust graph (localStorage for now).

## 4. Keys (what flips things live)
Minimum for live people-audits: `ANTHROPIC_API_KEY` + one X source
(`XAI_API_KEY` or `TWITTERAPI_KEY`). The rest (`PDL_API_KEY`, `GITHUB_TOKEN`,
`HELIUS_API_KEY`, `COINGECKO_API_KEY`) add depth. See `.env.example` for the full
list and where to get each. **Never** paste a key into chat, an issue, or a
commit — `.env` is gitignored; production keys live in Vercel env.

## 5. Shipping
- Push to `main` → auto-deploys to production.
- Bigger changes: branch + PR. Verify a deploy via the Vercel dashboard or
  `gh api repos/kylekmcconnell-arch/argus/commits/<sha>/status`.
- Local `tsc` can be slow under load; the source of truth for type-checking is
  the Vercel build (`tsc -b` runs there). `vite build` alone does not type-check.
