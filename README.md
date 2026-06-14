# ARGUS — Forensic due-diligence, person by person

Paste an X handle. ARGUS routes the subject into every role they hold (founder,
fund, KOL, advisor, agency, member), audits each on its own evidence, and
returns an investment-grade verdict you can stake money on. A strong story never
papers over a disqualifying fact.

This is the **web product** surface for the ARGUS-P v2.2.0 engine: handle in →
live audit → a gorgeous, shareable report.

## What's real today

- **The scoring engine is a faithful TypeScript port of `argus_p` v2.2.0.**
  Multi-role scoring, hard caps that override the weighted total, the
  reward-disclosure / never-gate-pseudonymity identity model, testimonial
  corroboration, founder pattern + repeat-backing, and Panoptes graph export.
  - `src/engine/` — `taxonomy`, `profiles`, `corroboration`, `router`, `audit`.
  - `src/engine/engine.test.ts` mirrors all 31 checks from the Python
    `tests/test_profiles.py`. **The port is provably identical to the engine you
    already trust.** Run: `npx vitest run`.
- **The report** (`src/components/Report.tsx`) — composite verdict, per-role
  breakdown with axis bars and rationales, the testimonial corroboration table,
  founder pattern + repeat-backing, advisory graveyard, the Panoptes trust
  graph, and a sourced findings ledger.
- **The live audit console** (`src/components/RunConsole.tsx`) streams the
  protocol steps as the audit runs.
- **Deep links**: `/?s=<handle>` opens straight to a report (shareable dossiers).
- **Curated dossiers** (`src/data/subjects.ts`) — four fully-worked archetypes
  from the whitepaper, each computed by the real engine, not hand-written:
  - `@0xlumen` — multi-role (founder + investor + advisor). Real exit, but a
    manufactured endorsement wall and a paid advisory seat on a confirmed rug.
    Composite **FAIL**, governed by the advisor role's cap.
  - `@satoshi_builds` — clean **PASS**. Two exits, returning tier-1 backers,
    disclosed identity (+5 bonus).
  - `@nova_capital` — investor whose marquee testimonials are unconfirmed and
    one is publicly contradicted. Contradicted-testimonial cap.
  - `@deltagrowth` — agency selling manipulation as a product. **AVOID**.

## The autonomous collector (built)

The engine is a passive scorer. The collector (`server/`) turns `@handle` into a
populated audit and streams the work live. Architecture: every provider is a
swappable **adapter** that contributes typed evidence to a shared bag; the engine
then scores it. Adapters never score; they only acquire.

```
server/
  index.ts            HTTP server: GET /api/providers, GET /api/audit (SSE)
  orchestrate.ts      @handle -> evidence -> verdict, streams progress
  agent.ts            Claude analyst: messy evidence -> axis scores + rationale
  config.ts           provider-key registry (reads .env, never leaks keys)
  adapters/
    x.ts              Grok (content/acknowledgment) + twitterapi.io (follow graph)
    peopledatalabs.ts identity + career history (LinkedIn-derived, defensible)
    crunchbase.ts     funding, investors, acquirers
    coingecko.ts      token market data by contract
    dexscreener.ts    live DEX liquidity/volume + rug signals (free, keyless)
    reddit.ts         community FUD scan (free tier)
    onchain.ts        Helius (Solana) / Bitquery wallet forensics
```

**Graceful degradation is the core design.** With no provider keys, the collector
replays the curated dossier so the demo always runs. Each key in `.env` flips a
provider live. The report badge shows **LIVE** only when real collection happened,
**CURATED** otherwise. For known subjects, the live adapters re-verify the
fixture's *claims* against fresh data (e.g., does the named endorser actually
follow the subject right now).

The Claude analyst (`ANTHROPIC_API_KEY`) scores each axis with a rationale from
the collected evidence; the engine still owns caps, banding and the composite
verdict. See `.env.example` for every key.

**Cold audits.** For an unknown handle (no fixture), `coldIntake` resolves the
profile, pulls recent posts, and runs a claim-extraction agent that reads the
subject's own surfaces to discover their self-claimed ventures, endorsers,
advisory seats, and promotions. Those claims then flow through the same
verification adapters. With no analyst/X keys this degrades to a clean
`not_found` rather than a hollow verdict.

## Calibration (evolving the model)

The model is `profiles.ts` + `taxonomy.ts`. To evolve it safely there is a
golden set of labeled subjects with known verdicts (`src/calibration/`): the four
dossiers plus pure-evidence anchors for each cap, the identity gate, and banding.

```bash
npm run calibrate    # prints the verdict table, exits non-zero on drift
```

Change a weight or cap, run it, and see exactly which verdicts moved. It also runs
inside `npm test`, so drift fails CI. This is where Enigma's ground truth lands:
every confirmed rug or clean exit becomes a new labeled case.

## Stack & running

Vite + React + TypeScript + Tailwind v4 + Framer Motion on the client; a
dependency-free Node server for the collector. The client proxies `/api` to the
server, so when the server is up the app runs live; when it is not, it falls back
to curated dossiers.

```bash
npm install
cp .env.example .env   # fill the keys you have (optional; works with none)

npm run dev:full       # client (5173) + collector (8787) together
# or separately:
npm run dev            # client only
npm run server         # collector only

npm test               # engine port fidelity (all checks pass)
```

Deep links: `/?s=<handle>` opens the curated report; `/?live=<handle>` runs the
live collector. Deployable to Vercel / Supabase edge (the engine depends on
nothing; the adapters are plain fetch).

`engine_reference/` holds the original Python `argus_p` package and its test
suite — the source of truth the TS port is verified against.
