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

## Concentrated-liquidity (Uniswap V3) position custody — status

Reported bug: on a v3/v4 pool (Robinhood, Base), the scan called liquidity an
"NFT position" and gave up — "judge it by the position owner," without ever
looking up who the owner actually is. `$GWOOD` (Robinhood, pool
`0x72678B2e…Eb771`) was the concrete case.

**How a v3 position is actually custodied (verified on-chain, not assumed):**
the pool's own `Mint` event always names the chain's NonfungiblePositionManager
(NFPM) as `owner` — the periphery contract mints the position NFT to *itself*
per Uniswap's own code, so the pool alone never reveals who really holds it.
The real owner only shows up by: taking the Mint tx, finding the NFPM's
`Transfer` (initial mint) or `IncreaseLiquidity` log in the same tx to recover
the `tokenId`, then calling `ownerOf(tokenId)` on the NFPM **now** (it may have
moved since mint — e.g. transferred into a locker).

**NFPM addresses are chain-specific, not a shared constant** — verified by
finding a real V3 pool's Mint-log owner and cross-checking the explorer's
contract name, not by assuming Ethereum's canonical address ports over:
- Robinhood: `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` ("Uniswap V3
  Positions NFT-V1", 39k+ holders — confirmed via
  `robinhoodchain.blockscout.com`).
- Base: `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` (same explorer check on
  `base.blockscout.com`). Ethereum's address
  (`0xC36442b4a4522E871399CD717aBDD847Ab11FE88`) is a *different*, unrelated
  contract on Base ("Recover") — it does NOT port over; guessing it would have
  silently misidentified every position on Base.

**Once the current owner is known, classify it — don't stop at "it's a
contract":**
- Burn address → permanently locked, best case.
- Plain EOA (`eth_getCode` = `0x`) → removable at will; report the wallet.
- Contract → read verified source (Blockscout) for any reachable
  `transferFrom` / `safeTransferFrom` / `decreaseLiquidity` / `burn(tokenId)`
  call. None found → provably locked, not "locked by design" folklore. Found →
  it has an exit; name it. Unverified → fall back to a bytecode selector probe
  (weaker: misses a custom function that internally forwards the call).
- `ownerOf` reverting "nonexistent token" means the position was fully
  withdrawn and its NFT closed — worth reporting on its own (a large historical
  add that's since been fully pulled), not silently dropped.

**Ground-truthed on `$GWOOD`** (`api/nftlock.ts`, RPC + Blockscout, both
keyless): 49 Mint events, all "owned" by the Robinhood NFPM as expected. The
**largest** live position (tokenId 267009, ~45× the next largest) is held by a
plain wallet (`0xf48ac1…01df`, not the token's own on-chain creator) —
**removable**, not locked. A second, much smaller position IS genuinely locked
forever, in a verified `LpHolder` contract (`ERC721Holder` + `Ownable`,
source confirms it exposes fee-collection and an owner-only ERC20 `sweep()`
only — no function anywhere can move the NFT out). Two other large historical
positions were fully withdrawn and closed. The old blanket "NFT position, can't
tell" message would have reported all of this as one undifferentiated
shrug — the traced answer is neither "locked" nor "unlocked," it's specific and
checkable per position.

**Ranking caveat (documented in the API's own `note` field, not hidden):** the
top-5-by-size positions traced are ranked by liquidity **at mint time**, not
netted against later Burns — directional ("which positions mattered most
historically"), not a live TVL split. Bounded to 5 positions and two chains
(Base, Robinhood) for now; an unsupported chain degrades to the pre-existing
generic "NFT position, custody unconfirmed" behavior rather than a wrong
answer — see `src/threat/tokenomics.ts`'s `nft-locked` / `nft-unlocked` /
`nft-position` statuses.

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
