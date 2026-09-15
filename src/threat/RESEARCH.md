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

## Launch provenance (verified 2026-08-10)

DexScreener `labels` are AMM-type only (v2/v3/v4/CLMM/DLMM/wp) - NEVER launchpad
names. Venue fingerprints that actually work:

**Solana** - suffix `pump` = pump.fun (curve prog `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`,
AMM PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`; coins API
`frontend-api-v3.pump.fun/coins/<mint>` → `.complete`, `real_sol_reserves` (85 SOL
curve), `creator`; graduated keeps the old pumpfun pair ALONGSIDE pumpswap;
migration LP burned; creator fees tiered, claimed via `collect_creator_fee` /
`collect_coin_creator_fee`). Suffix `bonk` = LetsBonk but NOT guaranteed; curve
dexId is shared `launchlab` (Raydium LaunchLab `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`) -
disambiguate platform via `launch-mint-v1.raydium.io/main/platforms` +
`/get/list?platformId=` (LetsBonk `FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1` /
`BuM6KDpWiTcxvrpXywWFiw45R2RNH8WURdvqoTDV1BW4`, Bankr `kNDdb5HKMBFTH9yqRuHMJdhgFvum3A3C7LW5FgAyrFe`
- Bankr pays creator 50% of 1% fee; current LetsBonk creator fee = 0, LP ~100%
burned at 85 SOL → Raydium CPMM). Suffix `BAGS` / dexId `bags` = Bags (deployer
`BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv`, Meteora DBC
`dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` → DAMM v2
`cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` locked; fee-share prog V2
`FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK`). dexId `moonit` = Moonit
(`MoonCVVNZFSYkqNXP6bxHLPL6QQJiMagDL3qcqUQTrG`). dexId `meteoradbc` = Believe et
al (Believe DBC authority `5qWya6UjwWnGVhdSBL3hyZ7B45jbk6Byt1hwd7ohEGXE`, 50/50
fee split via `claim_creator_trading_fee`). Suffix `boop` = Boop (dormant).
RugCheck report exposes `launchpad.platform` (pump_fun / raydium_launchlab /
meteora_dbc / moonshot) but is null on many older graduates - best-effort only.

**EVM** - quote `VIRTUAL` on uniswap-v2 (base/robinhood) = graduated Virtuals
(bonding-phase invisible on DexScreener; LP staked 10yr in "Staked <sym> by
Virtuals"; api.virtuals.io keyless). Quote `flETH` on v4 = Flaunch (LP hook-
managed/burned; creator fee 0-100% BY DESIGN). Address suffix `b07` = Clanker v4
(clanker.world/api keyless; Bankr EVM deploys are Clanker under the hood). Pons
(robinhood) has NO client fingerprint - reads as plain uniswap v3/WETH; detect
via token creator == PonsLaunchFactory `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB`
(active, Blockscout-verified; legacy `0x0c37a24F5D23A486FA692d1500881d698B1F77a4`);
locker = PonsLaunchLocker `0x736D76699C26D0d966744cAe304C000d471f7F35`, position
NFT permanent custody; graduation = 4.2 WETH pairedPrincipal (`graduationStatus(token)`
on factory); fees 1% split 70/30 creator/protocol, `FeeRedirectUpdated` events
show fee-wallet changes. dexId `fourmeme` (BSC) = Four.meme → PancakeSwap v2 LP
burned. dexId `flapsh` (BSC+robinhood) = Flap.sh (tax tokens by design).
Stonkbrokers (robinhood, Clutch Markets): launches Aug 11 2026 - no contracts
yet; graduation 4 units of pair asset (ETH/$STONKBROKER/tokenized stocks) into
Uniswap V3, fee splitter → per-token staking vault. Revisit for factory address.

**Off-DEX debuts:** ≥3 CEX listings without a launchpad fingerprint → likely
exchange/ICO-era debut; vesting + unlock schedules require official project disclosures /
CoinGecko/CMC token pages (full unlock-schedule integration = follow-up; needs a
keyed source).

## Bankr on Base/Robinhood = Doppler protocol (verified live 2026-08-11, $KUPO)

Bankr migrated off Clanker: tokens are DERC20s minted by Doppler TokenFactory
(0xf0B5141dD9096254B2ca624dff26024f46087229, callable only by Airlock
0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12), deployed via per-user 4337 smart
wallets (no fixed deployer EOA, no vanity suffix). Full supply pools into a
Uniswap V4 multicurve position held BOOK-ENTRY inside DopplerHookInitializer
0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544 - no position NFT, no Clanker
locker. exitLiquidity() requires PoolStatus.Initialized but pools lock at
creation -> structurally unreachable; graduate() only decays the fee schedule
(80%->0.5%). Beneficiaries (95% creator EOA / 5% Doppler Safe, on-chain Lock
event) can only collectFees. Detection: keyless
GET api.bankr.bot/public/doppler/token-fees/{token} (404 = not Bankr); also
/token-launches, /claimable-fees, /creator-fees. clanker.world by-address
lookup is now key-gated. Scanner verdict: lpDisposition locked/permanent;
extraction vectors = creator dumping claimed fees + optional 15% premint
(1yr vest, 30d cliff).

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

**NFPM addresses are chain-specific, not a shared constant** — resolved per
chain by finding a real V3 pool's Mint-log owner and cross-checking the
explorer's contract name (see api/nftlock.ts for the resolved table). The
live tracing of this custody chain ships as api/nftlock.ts + the LpCustody
panel; this note records the mechanism so the next reader doesn't re-derive it.

## Pons V2 launch farms on Robinhood Chain (traced 2026-09-12 to 2026-09-14)

Four tokens traced end to end from RPC transfer logs, Blockscout internal
transactions and the verified Pons V2 contracts. Each is a different shape;
together they set the detection recipes below. Chain id 4663, block time
~0.101 s. Explorer `robinhoodchain.blockscout.com` is Cloudflare-gated for
curl but serves `/api/v2` to a browser session; the RPC
`rpc.mainnet.chain.robinhood.com` is non-archive (state reads only at head)
and rate-limits after ~100 fast calls.

**Pons V2 mechanics (verified on-chain, not from docs).** The curve contract
mints 100% to itself and gives the deployer 1% (`launchAndBuy` on
PonsV2LaunchAndBuy `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948`). The curve
sells 71.4% of supply and graduates at ~8,090 USDG (or the ETH equivalent);
PonsV2GraduationExecutor `0xc7819b64a1DaEcd7ec19856D026CB14efbD89046` moves
20.4% of supply plus the curve proceeds into a Uniswap v4 pool and 8.16% to
PonsV2LaunchLocker `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952`. The pool
hook is PonsV2MemeHook `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`: 5% on
normal sells, **100% on sells by wallets that bought in the launch block**,
and the confiscated proceeds accrue as *creator tax* claimable by the deployer
from PonsV2FeeEscrow `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`. Factory is
PonsV2LaunchFactory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`, deployer
contract PonsV2LaunchDeployer `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42`
(already in `api/launch.ts`). Uniswap v4 PoolManager
`0x8366a39CC670B4001A1121B8F6A443A643e40951`, UniversalRouter
`0x8876789976decbfcbbbe364623c63652db8c0904`. USDG
`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` has **6 decimals**.

**The anti-snipe tax is an extraction primitive when the sniper is the
deployer.** LEBRON (`0xd553996e73a50501a940EA771B328998a7ac2478`, launched
2026-09-12 18:31 UTC): one wallet funded the deployer and the sniper in the
same GasliteDrop batch; the sniper bought the whole curve plus 17% more from
the fresh pool (88.5% of supply for 68,136 USDG) and dumped it within 5 s.
The hook took 72,843 USDG of sell proceeds as creator tax; 11 minutes later
the deployer claimed 127,763 USDG from FeeEscrow. Net +64k USDG paid by
organic buyers, then bridged Robinhood -> Base via Relay and swept into
Binance deposit addresses. A punitive tax routed to the creator is a wash
for a self-sniper and a drain on everyone else.

**Curve-phase rotation evades the tax entirely.** SYNAPSE
(`0xE96184C99B3A3B89C907ea0753C5fDE9E3C572Ab`, 2026-09-14 03:38 UTC): the
sniper bought 20% at block +1 through a bundler, pushed it to a sell
executor whose every sell re-issued the tokens from the curve to a fresh
farm wallet inside the same transaction, and the ten farm wallets sold back
to the curve at +32 s, before graduation, where no hook exists. 0.44 ETH in,
0.82 ETH out. The launch-block wallet ends the day with zero balance and
zero pool interaction, so a post-graduation snipe read misses it. The read
that catches it: launch-block buyer -> transfers to a contract -> curve
re-issues to N wallets -> all N sell to the curve before graduation.

**Fee farming with a real front end.** PRISM
(`0x71D389c48e29996BD8e20778f87fb915c1FFDcc2`, 2026-09-02): deployer and a
block-2 buyer (22%, sold back into the curve in 8 s) funded from one hub;
the deployer then claimed creator fees 82 times in 11 days (~24 ETH),
swapped 15 ETH to USDG, and routed the rest through a wallet that bridges to
Solana via Relay. No team wallet ever held or sold the token after launch
day; the extraction is the fee stream. Holder base was organic.

**Not a farm, still a disclosure.** QUANT
(`0x41af7e794dee45eefab49b6c387eac9368d69c4d`, 2026-07-17, custom OpenZeppelin
ERC-20 on Uniswap v2, not Pons): 20% of supply held by the contract as a
"clog" and sold into launch buys at a 25% launch tax with proceeds to a
project wallet (8.4 ETH in 6 minutes), then a 4% tax to a verified
StockPayDistributor that buys tokenized stocks for holders (117 ETH so far,
80% to holders). Owner never renounced (`setExempt`, `removeLimits`,
`lowerTaxes`, distributor cycler controls 0x calldata). Revenue decayed from
95 ETH launch week to 0.07 ETH by week nine. A fair-looking distribution can
still hide an undisclosed team sale in the first minutes.

**Shared infrastructure across operators.** Buy bundlers
`0x1e43ce0055b35373cb108e67586fd3b19ee32618` and
`0x14b9A544e8c179Fc2040D3089dCC73bAF25aa8F9`, and sell executor
`0xb06983db4fad9cd94efbf9088c364ebcacde1214`, are all by
`0xCa33026341691F48A3067e22febcbd54f0cB5dE2` (6k+ txs, self-funded through
GasliteDrop) and were used on LEBRON, SYNAPSE, and stock-token-paired Pons
launches (AAPL, RBLX, PLTR, NFLX, NVDA, QQQ, SPY). GasliteDrop
`0xE68d0bbc023de3fEBdA04f413db23cE9C5EA1934` `airdropETH` is the funding
primitive for every farm seen; the sender of the batch that funded a
deployer is the operator's hub. Hubs seen: `0xcCfb5e8F8Db1B50FFA37Ab9527D25f78e3E10Ae7`
(LEBRON, off-ramp `0xE0BCad36FD0C2F0af1796f18AA291e232102d46C` -> Relay ->
Base -> Binance 73 `0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A`),
`0x45f4A022Dd3758bDF8421e3293fc04F7F775Fd2F` (PRISM, off-ramp
`0x9787CE5701F98F83a669642dE5b5dF42A6D50085` -> Relay -> Solana),
`0xafB1D47ce1aF439C5833bB4f6Eb4978722DF2fCa` (SYNAPSE, 36 batches since
Jul 25, daily since Sep 7, refilled by one-off wallets). Curated in
`src/data/cabals.ts`.

**Bridge attribution.** RelayDepository
`0x4cD00E387622C35bDDB9b4c962C136462338BC31` `depositNative`; destination
resolves keyless via `GET api.relay.link/requests/v2?hash=<deposit tx>`
(chainId, recipient, outTx). Relay "open deposit addresses" look like fresh
EOAs on Robinhood Chain; the real sender is `depositAddress.depositor`.
Relay solver `0xf70da97812CB96acDF810712Aa562db8dfA3dbEF`. On Base, addresses
that forward to Binance 73 (or to Binance Dep `0x487cab40f6D11a278fa7C442C6741Eabe44eAb5d`)
on :x0:03 sweep ticks are Binance deposit addresses.

**Detection recipes (what the scanner should measure, not conclude).**
1. Deployer and any launch-block or block+1 buyer received ETH from the same
   GasliteDrop `airdropETH` transaction, or from the same EOA within 2 hours
   of launch. Measurement: shared funder tx hash. This was true on every farm
   launch and on no organic launch checked.
2. A launch-block buyer's tokens leave through a contract and the curve
   re-issues tokens to >= 5 wallets inside those transactions; those wallets
   sell to the curve before graduation. Measurement: pre-graduation sells
   attributable to the launch-block bag as a share of supply.
3. Creator-fee claim cadence on Pons: `PonsV2FeeEscrow.claim` count per day
   by the deployer, and the share of claimed ETH/USDG that leaves via
   Relay/GasliteDrop within 24 h. PRISM: 82 claims in 11 days, ~90% routed
   out. A project treasury claiming weekly and holding reads differently.
4. Advertised fee recipient vs the recipient set in the creation
   transaction. SYNAPSE's docs name a treasury; the creation tx names the
   farm deployer. Measurement: address mismatch, reported as a mismatch.
5. On custom-contract launches, supply retained by the token contract at
   mint and sold on buys before "graduation" (QUANT `clogAmount`), with
   swap-back ETH going to a project wallet rather than holders.
6. Same-second first activity: deployer and sniper first transactions in the
   same block or second, both against SwapRouter02 / UniversalRouter, is the
   cheapest early tell (LEBRON: both at 17:30:28).

## Daily honeypot factory on Robinhood Chain (traced 2026-09-14, $DOGEGPT)

Not a launchpad token: EOA `0x8fc191daa5ac8eb3b30066ffa554d999fe35885e`
deploys an unverified custom ERC-20 (3.3 KB, `owner()` reads zero, has
`renounceOwnership`) straight to a Uniswap v2 WETH pair, keeps every LP unit
in its own wallet, and calls a custom `actionPair(...)` on the token right
after. Result on `0x26becab467bf74a3e09c095c30427acbd6544608`: 101 buys and
0 sells in six hours, +24,800% on the chart, ~$79k "liquidity". `eth_call`
of `transfer(pair, amount)` from three holders: succeeds only from the
deployer-funded wallet `0x10d28597…`, reverts from the others; transfers to
a plain EOA succeed for everyone, so it is a sell-path whitelist, not a
transfer lock. Cadence: JUGGERNAUT 09-11, EMBERCAT 09-12, STONKINU 09-13,
ZZZCAT 09-13, DOGEGPT 09-14, each preceded by
`removeLiquidityETHSupportingFeeOnTransferTokens` on the previous one and
followed by a LiFi/Across bridge out. GoPlus for chain 4663 returned an
empty holder set and `lp_holder_count: 1` with the zero address "locked",
which is wrong: LP `balanceOf(deployer)` is 100%. Do not trust the keyless
LP read on this chain; read the pair contract. Cheapest tells, in order:
zero sells against dozens of buys on a pair younger than a day; LP token
supply held by the deployer; a deployer whose prior creations all show
`removeLiquidity` in their last hours; `eth_call` sell-path simulation from
a non-deployer holder. All curated in `src/data/cabals.ts`
(`rh-honeypot-factory-8fc191`).

## Two more Robinhood Chain launch venues (read 2026-09-14, $FIH and $WRESTLER)

Neither is Pons, and both read as plain "uniswap" on DexScreener.

- **LaunchLocker factory.** $FIH (`0x4b3a3ff4…`) was created by
  `0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb` (unverified, ~93k txs by
  September) which mints 100% of supply, seeds a Uniswap v3 WETH pool, and
  moves the position NFT (Uniswap V3 Positions NFT-V1
  `0x73991a25c818bf1f1128deaab1492d45638de0d3`) to a verified `LaunchLocker`
  `0x7f03effbd7ceb22a3f80dd468f67ef27826acd85`, all in the creation tx.
  Factory and locker share creator `0x7e035fb048a31e0481b88074557415b1c187242b`.
  Detection: token creator == that factory; LP custody == `ownerOf(tokenId)`
  on the NFPM resolving to the LaunchLocker. Launch read for FIH: first buy
  at block +38, no same-block cluster, 72 buyers in the first hour, deployer
  bought 2% at +3.5 min and later sold. Organic.
- **RWAERC20LaunchpadFactory.** $WRESTLER (`0xab528169…`) was created through
  verified `RWAERC20LaunchpadFactory`
  `0xce9c48cfa068947f77738c81be406b53338e5b0d` (creator `0xaa8d6f5a…`),
  which pools the full supply into a Uniswap v4 pool quoted in a tokenized
  stock (GLXY) with no bonding curve; supply custodian
  `0x0310cfebe1d7a69f2414f6595bbe9d17c5342acc`. Blockscout's
  `getcontractcreation` reports a one-shot `contractFactory`
  (`0xf86dfdb6…`) for it, so match on the creation tx `to` address, not the
  reported factory. Launch read: first buy at +183, 5 buyers in the first
  hour, pool still 94% full after an hour; the volume came with the
  Altcoinist calls from Sep 7. Organic.

Both belong in the `VENUES` table once a second token per venue confirms
the fingerprint; recorded in `src/data/cabals.ts` (`altcoinist-ring`) for now.
