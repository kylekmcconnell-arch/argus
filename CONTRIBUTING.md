# Contributing to ARGUS

ARGUS is forensic, multi-class due-diligence for crypto. Paste an X handle, the
engine routes the subject into every role they hold (founder, fund, KOL, advisor,
agency, member) and scores each on its own evidence, governed by the most severe
role and never averaged. This doc gets you productive in a few minutes.

## Quick start

```bash
git clone https://github.com/kylekmcconnell-arch/argus
cd argus
npm install

npm run dev:full     # web on :5173 + collector API on :8787
# open http://localhost:5173

npm test             # engine port fidelity + golden-set calibration (must pass)
npm run calibrate    # prints the verdict table; fails on drift
```

`npm run dev` is web-only. The app runs fully without the collector (it falls
back to curated dossiers), so you do not need any API keys to work on the UI or
the engine.

## The map

```
src/engine/        the scoring engine (TS port of argus_p v2.2). Pure, no deps.
src/engine/*.test  mirrors the 31 Python checks; the port is provably identical.
src/calibration/   golden set + runner. The model-evolution guardrail.
src/data/          evidence shape, dossier assembly, the curated subjects.
src/components/    the origami-style UI (AppShell, Landing, Report, TrustGraph…).
server/            the autonomous collector: provider adapters + Claude analyst.
engine_reference/  the original Python argus_p package (source of truth).
```

## The model lives in two files

`src/engine/profiles.ts` (axes, weights, caps, flags, sources per role) and
`src/engine/taxonomy.ts` (outcome vocabulary, fund tiers, verdict bands, dox
bonus) ARE the model. Tuning ARGUS means editing those, never the orchestrator.

**The guardrail.** When you change a weight or a cap, run `npm run calibrate`.
It scores a labeled golden set (the four dossiers plus pure-evidence anchors for
every cap and the identity gate) and shows exactly which verdicts moved. This is
how two people evolve the engine without quietly breaking each other's work.
Grow the golden set in `src/calibration/golden.ts` as real ground truth accrues.

## Working together

- Branch off `main`, open a PR. CI runs typecheck + tests + calibration + build
  on every push; keep it green.
- `main` auto-deploys to Vercel, so only merge what you would ship.
- Two people cannot share one Claude session; collaborate through the repo
  (branches and PRs). Claude on the web (claude.ai/code) or local Claude Code
  both work against this repo.

## Conventions

- **Design system mimics origami.chat**: Sora typeface, light paper theme, a
  single pink accent (`#d64a9e`), near-black buttons, small radii. The brand mark
  is the peacock ocellus (Argus Panoptes, the hundred-eyed giant). Tokens live in
  `src/index.css`; components use the CSS variables, so reskins are a token edit.
- **No em dashes** in any user-facing copy.
- The engine owns caps, banding, and the composite verdict. Adapters only
  acquire evidence; the analyst only fills axis scores. Keep that separation.

## Live collector (optional)

To run real audits instead of curated dossiers, copy `.env.example` to `.env`
and add the provider keys you have (Grok + twitterapi.io for X, Crunchbase,
People Data Labs, CoinGecko, Reddit, Helius/Bitquery, and ANTHROPIC_API_KEY for
the analyst). With no keys it stays in curated mode. Never commit `.env`.
