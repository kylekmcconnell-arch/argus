# Token Threat Scanner — research base (2026-08-09)

Why this module looks the way it does. Two research passes: a deep crawl of
nlyra.xyz (the reference product) and a sweep of the competitive landscape.

## nlyra.xyz ("NERON & LYRA — AI Token Threat Scanner")

Closed-source (no GitHub); everything below observed from the live site and its
unauthenticated JSON API (`/api/scan`, `/api/lyra`, `/api/wallet`, `/api/stats`,
`/api/recent`, `/api/receipts`, `/api/rhboard`, `/api/bundle`).

**Output model (adopted here):**
- Verdicts `SAFE | CAUTION | DANGER | RUG | UNKNOWN`; risk score 0–100, higher =
  worse (SAFE ≈ 0–13, CAUTION ≈ 20–38, DANGER ≈ 47–55, RUG = 100).
- One-line imperative `action` ("DON'T TOUCH IT" / "no mechanical red flags
  (not financial advice)").
- Three severity-tiered arrays of pre-written second-person plain-English
  strings — `flags` / `warnings` / `positives` — CAPS on the scary word, emoji
  garnish, positives shown even on a RUG.
- `shareUrl` per token; every scan recorded.

**Architecture (adopted here):** two-stage — (1) fast mechanical aggregation
(GoPlus + DexScreener + honeypot sim → rule-based score + canned strings);
(2) lazy, cached, rate-budgeted LLM read of verified Solidity (`/api/lyra`),
fed mechanical pre-analysis (function count, ownerOnly count, danger-pattern
regex hits, isProxy), allowed to **dissent** from the mechanical score ("knows
guarded power from open power. May dissent — and says why"). NERON/LYRA are
persona layers over pipeline + LLM.

**Their credibility loop (adopted as receipts.ts):** `/api/receipts` records
verdicts with liquidity at flag time, later re-checked — `liqThen/liqNow/
priceDropPct/status:dead` — "flagged while it still had real liquidity."
Plus `/api/stats` counters and a public recent-scans ticker.

**Wallet scanner (future phase):** portfolio join against cached verdicts;
totals `valueUsd / atRiskUsd / deadMarkets` + per-token verdict; "NO MARKET —
there may be nowhere left to sell it."

**Premium packaging:** token-gated (hold 1M $NLYRA): 10x scan rate, 20 LYRA
reads/day, 50-token watchlist re-scanned every 20–35 min with Telegram alerts
on verdict flips, 25-wallet tracking.

## Competitor landscape — what we folded in

| Source | What it adds | API |
|---|---|---|
| GoPlus | Richest EVM flag set (the industry backbone); Solana beta | free, keyless, ~30/min — already in `src/token/sources.ts` |
| Honeypot.is | Best EVM sim + **per-holder sell analysis** (failed/siphoned sellers, per-address tax) — nobody else has this | free, keyless — `deepsources.ts` |
| RugCheck | Solana full report: 30+ named risks, **insider networks**, LP lockers, `rugged` flag | free, keyless GETs — `deepsources.ts` |
| DexScreener | market/liquidity/age leg | free ~300/min — already in |
| Sourcify / Blockscout | keyless verified-source fetch | free — `source.ts` |
| Etherscan v2 | deepest source coverage (server-side, keyed) | `api/code-review.ts` |

Paid/gated, deliberately skipped for now: Token Sniffer ($99+/mo; deployer
rap-sheet + scam-code fingerprinting), Quick Intel (55+ chains, x402
pay-per-scan), SolSniffer, Bubblemaps Data API (B2B), CertiK/SolidityScan/De.Fi.

**Differentiators worth building later:** scam-code fingerprinting (we already
have `api/bytecode.ts` — extend fingerprint matching to a known-rug DB);
cross-chain similar-contract search; pre-launch liquidity simulation
(`simulateLiquidity` on Honeypot.is); wallet scanner with at-risk-USD;
GoPlus `fake_token` counterfeit flag (namesquat detection — pairs with the
methodology memory's token-disambiguation step).

## Design deltas vs nlyra (deliberate)

- **Legitimacy gate**: soft signals (unverified LP custody, concentration,
  capability-class code flags) score 0 on established tokens (CEX-listed with
  mcap floors) — the base engine's anti-false-positive philosophy. nlyra has no
  equivalent; we keep PEPE/BONK at SAFE where their raw rules would mark DANGER.
- **RUG reserved for confirmed traps** (honeypot-class / already-rugged), not
  merely high risk — a claim we can defend.
- **Static code scanner with line citations runs keyless client-side**
  (`solidity.ts`); nlyra's equivalent lives behind their API only.
- Receipts are honest both ways: recovered tokens (our misses) stay visible.
