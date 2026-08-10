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

## Tokenomics methodology (operator requirement, 2026-08-09)

Standing checks the scanner must run on every token (`tokenomics.ts` +
`solidity.ts::tokenomicsSignals`). The naive "big holder = bad / tax = bad"
read is wrong for launchpad and RWA-distributing tokens:

1. **Separate the LP from holder concentration** — pools (and CEX/reward
   contracts) are identified by holder tag and excluded; `realHolderTopPct` is
   the top holder *after* those exclusions.
2. **LP lock, launchpad-aware** — recognizes lockers by name (Pons LaunchLocker,
   Team Finance, Unicrypt, Streamflow…). CRITICAL: on early launchpad chains
   (Robinhood/Pons) a real lock may **not surface in DexScreener/GoPlus**, so the
   `unconfirmed` status never asserts "removable" as fact — it says verify on the
   launchpad. A recognized launchpad locker → `launchpad-locked` ("by design").
3. **Reward / emission pools** — identified and separated (tag match). Their
   distribution *cadence over time* + **FDV-vs-mcap by emission stage** graph is
   the **deferred next phase** (needs snapshot infra).
4. **Tax destination** — `tokenomicsSignals` reads the source for reflection /
   buyback-burn / auto-liquidity / marketing-treasury / **RWA-stock
   distribution** (the new Robinhood/Solana pattern: tax buys stocks and
   distributes to holders — a *positive*, not a rug tax). LYRA is prompted to
   name the destination too.
5. **Burns** — % of total supply at burn addresses (snapshot), plus burn-function
   / auto-burn-on-transfer detection. **Deferred:** tracking ongoing burn cadence
   via the project's X burn-announcement feed + a burned-over-time series (needs
   the X adapter + snapshots).

## Migrate.fun migration detection (#5) — status

Migrate.fun is **Solana-only** (Emblem Vault; the on-chain program is
`EmblemCompany/hustle-migration`, Halborn-audited commit e64c641). A migration
mints a **new token address** (new chart). Its claim flow is **pull-based**: each
holder deposits the old token to a program vault, gets an **MFT** (Migration
Fungible Token) receipt, and later **burns the MFT to claim** the new token
**from the program vault**, spread over a 90-day window. So a migration claim is
NOT a same-block bundle — it's many *independent* wallets claiming over time.

**Shipped (verifiable, no program ID needed):** the false-positive the operator
flagged — a claim distribution reading as a "bundle" — is fixed in the judge: on
Solana a "bundled launch / coordinated snipe" flag now requires RugCheck's
**common-funder** insider proof; concentration WITHOUT a shared funder is called
a DISTRIBUTION (airdrop / migration claim) and prompts the migration caveat,
never branded a coordinated launch.

**Positive identification — DONE.** Program ID pulled from a live project page
(mig180): **`migK824DsBMp2eZXdhSBAWFS6PbvA6UN8DV15HfmstR`** (the account `owner`;
the "mig" vanity prefix confirms it). `api/migration.ts`:
`getProgramAccounts(program, memcmp offset 0 = project-account discriminator
`YSC6fNifLgY`)` → ~215 project accounts; each is `[8 disc][u32+projectId]
[u32+name][creator:32][newMint:32][oldMint:32]`, so we read the length-prefixed
strings to locate the mints exactly and match the scanned mint → role new/old.
Verified live: the Rizzmas token resolves to project mig180 as the NEW mint,
old (pre-migration) mint `ADA9…pump`, creator matching the project's creator
endpoint. The judge then skips the fresh-age penalty and reclassifies the claim
spread as a distribution (not a bundle) for a confirmed post-migration token.

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
