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
- **o1 Launchpad (first read as "RWAERC20LaunchpadFactory").** $WRESTLER
  (`0xab528169…`) was created through
  `0xce9c48cfa068947f77738c81be406b53338e5b0d` (creator `0xaa8d6f5a…`),
  which Blockscout verifies under the source name `RWAERC20LaunchpadFactory`
  and which o1's own contract registry lists as the current Robinhood Launch
  Factory (identified 2026-09-16, see the o1 section below). It pools the
  full supply into a Uniswap v4 pool quoted in a tokenized stock (GLXY) with
  no bonding curve; the supply custodian `0x0310cfebe1d7a69f2414f6595bbe9d17c5342acc`
  is the o1 Launch Hook. Blockscout's `getcontractcreation` reports the
  one-shot Launch Token Deployer (`0xf86dfdb6…`) as `contractFactory` for it,
  so the server matches both the factory and the token deployer. Launch read:
  first buy at +183, 5 buyers in the first hour, pool still 94% full after an
  hour; the volume came with the Altcoinist calls from Sep 7. Organic.

o1 is now in the `VENUES` table (`o1`) with server-side factory detection
on Robinhood; the LaunchLocker factory still waits for a second token before
it gets a venue entry. Both launches stay recorded in `src/data/cabals.ts`
(`altcoinist-ring`).

## o1 Launchpad (o1.exchange), read 2026-09-16 via $BRAINARM on Base

One `launchpad-v4-minimal` suite on Base, Robinhood Chain, Monad and Arc, run
by Jerry Pan (@stambouli_o1, @o1_exchange). Same model everywhere: no
bonding curve, the creation tx mints the full supply and pools all of it into
a Uniswap v4 pool under the o1 Launch Hook, quoted in ETH, USDC/USDG or a
tokenized stock. Liquidity is documented as permanent; creator rights are fee
claims only. Every swap pays 1%: creator 50 bps, platform 30 bps, referrer
20 bps. Launch fee 0.001 ETH, anti-snipe window 20 seconds, optional atomic
Dev Buy through the Launch-Buy Adapter.

- **Contracts.** Machine-readable registry:
  `https://docs.o1.exchange/launchpad/reference/launch-contract-suites.json`
  (current and four historical suites per chain; o1 asks indexers to keep
  every suite). Robinhood current: Launch Factory `0xce9c48cf…`, Hook
  `0x0310cfeb…`, Fee Escrow `0xc5444b41…`, Launch Token Deployer
  `0xf86dfdb6…`. Base current: Launch Factory
  `0x1176122eb77ad6a2339322cda7c4d7ea9bfa63dc`, Hook `0x1f91c998…`, Fee
  Escrow `0xb3f11a3fb06a88059b7f7f423ec0dda506356866`, Announcement
  Registry `0xab1243c9…`. Platform fee receiver `0x1caa1962…`.
- **Base tokens are native B20 assets.** The o1 factory calls Base's genesis
  B20 Factory `0xb20f0000…0000`; the token lands at a system address
  `0xb2000000…` with `eth_getCode` = `0xef` (one byte) and no creator or
  creation tx on Blockscout (Basescan: "System Contract"). There is no custom
  token code, no owner and no sell-path surface, so honeypot reads do not
  apply; judge the launch on flows. The `0xb2` prefix marks the B20 standard,
  which other apps also use, so it is not an o1 fingerprint. Recognise a Base
  o1 launch by the creation tx calling the o1 Launch Factory (selector
  `0x3feab1d8`) or by Fee Escrow `claimFor` activity for the token.
- **Fee-farm read ($BRAINARM, `0xb2000000000000000000005a0c125da6cf531d01`).**
  Launched 2026-09-14 22:14:45 UTC by thefear.base.eth (`0x010f94ba…`, a
  Uniswap-wallet EIP-7702 account), whose launch tweet carried a referral
  link to its own address, so it takes 70 of the 100 bps on every trade. Ten
  `claimFor` calls between 09-15 02:30 and 09-16 04:10 UTC pulled 1.68 ETH
  (about $4,000 against a $340k cap); the claims arrive as v4 ERC-6909 burns
  paid out as internal ETH transfers, so Blockscout's tx list misses them.
  Proceeds left through relayed 7702 executions (Multicall3 to the account's
  execute) into two fresh wallets that swapped to USDC and hold 1,436.9 and
  966.6 USDC plus 0.417 ETH. First buy landed at block +10 (20 s, the
  anti-snipe boundary), 2.7x supply turnover in the first hour. Detection
  recipe: creator address == referrer in the launch link, Fee Escrow claim
  cadence of a few hours, proceeds to fresh wallets. Same shape as the Pons
  PRISM farm, with the fee taken from the pool instead of a sell tax.
- **Insider check.** jesse.base.eth (`0x2211d1d0…`, Jesse Pollak's Coinbase
  Smart Wallet, paymaster-sponsored user operations) bought 0.0112% of
  BRAINARM for 0.0102 ETH on 2026-09-15 16:40 UTC between three other small
  memecoin buys. A Base insider buying pocket change through Base App is
  their routine, not a team signal, and no Base or Coinbase staff account
  posted about the token.

## PumpSwap drained-pool factory behind a pump.fun launch ($PARK, Solana, read 2026-09-16)

$PARK / STONKS PARK (`7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5`, a Token-2022
pump.fun mint created 2026-09-15 14:41:13 UTC, graduated to PumpSwap after 22
hours with the LP burned) looked like a content project: daily animated
episodes, a website, $598 of DexScreener ads. The wallet trail says otherwise.
Curated in `src/data/cabals.ts` (`sol-park-pumpswap-pool-factory`).

- **The creator wallet is a fee sink for other people's pools.** On PumpSwap,
  `create_pool` takes a `coin_creator` account (account index 21 in the
  current instruction layout) that receives the creator share of every swap
  fee. Ten throwaway wallets (each alive for under an hour) opened pools
  between 14:50 and 21:32 UTC on launch day depositing 191 to 451 SOL each
  (3,781 SOL in total), all naming the PARK creator `CBbRS6xr…` as
  `coin_creator`. Each pool drew 61 to 345 trades in 2 to 26 minutes and was
  then drained to 0.00 SOL. The base tokens carry fake launchpad address
  suffixes (`…pump`, `…bonk`, `…moon`, `…BAGS`) and generated names, and
  DexScreener still quotes multi-million market caps for them on zero
  liquidity. Ten further pools traded on 09-16 paying fees to the same vault.
  Nobody routes creator fees to a stranger: the factory and the "dev" are one
  operator.
- **Detection recipe.** Pull `getSignaturesForAddress` for the token creator
  and decode every transaction that touches the PumpSwap program
  (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) but was not signed by the
  creator. A creator that appears as an account in `create_pool` or swap
  transactions for other mints is a coin-creator fee sink; check those pools'
  WSOL vaults (`getTokenAccountsByOwner(pool, WSOL)`) for the drained-to-zero
  signature. The pump.fun API returns 404 for these mints because they never
  had a curve.
- **Launch bundle.** The bonding-curve account
  (`7fQP9eZk6xPVULLETYEfcHFQYSA1sbYQnd3BxJWMeD6C`) is the cheap history
  source (3,880 txs versus 40,000+ on the mint after graduation). 43 buys in
  the first 20 slots took 44.65% of supply. Eight fresh wallets (5 to 9 txs
  each) were funded about 1.05 SOL apiece from five high-throughput hubs
  between 09:42 and 10:01 UTC, five hours before the 14:41 launch; five of
  them bought an identical 0.811% in slot +13 and all but one exited by slot
  +20. Fresh-from-hub funding plus identical sizing in one slot is the bundle
  fingerprint; the hubs themselves (300 to 54,000 SOL, seeding wallets every
  minute) read as exchange or bot-service hot wallets and do not identify the
  operator on their own.
- **Recycled X handle.** GMGN's rename history for @stonkspark lists 13
  renames: twelve 2024 Solana memecoin handles and 3 deleted tweets, on an
  account that joined May 2024 with 331 followers. A project account whose
  previous names were all dead memecoins is a serial-launch tell independent
  of the chain read.
- **Tape.** 35,298 transactions in the first hour after graduation on about
  920 holders and $26k of liquidity is bot volume; 24-hour volume of $690k
  against a $110k market cap is the same signal in DexScreener terms.

Public Solana RPCs reject `getTokenLargestAccounts` for Token-2022 mints and
cap `getSignaturesForAddress` pagination in practice; use the bonding-curve
account for the launch window and Solscan's holder page for the snapshot.

## Pons V2 self-launch with a dividend pivot ($IDX9000, Robinhood Chain, read 2026-09-16)

$IDX / IDX9000 (`0xcd4e70bfd73952123449e453f08c12e44ab89e58`) is the LEBRON shape
with two new moves. Curated in `src/data/cabals.ts` (`rh-farm-idx9000`).

- **Rehearsal launch.** The deployer (`0x5cfdc3ee…`, an EIP-7702 account funded
  0.5 ETH from a 5,845 ETH hot wallet 73 minutes earlier) launched an
  identical IDX (`0x8db9cbfa…`) at 04:52 UTC with a 36.4% dev buy, sold it
  all by 04:57, claimed the tax and bridged, then launched the live token at
  05:02:50 with a 30.11% dev buy paid in tokenized SPY. A dead twin with the
  same name and symbol a few minutes before the live token is a deployer
  fingerprint worth checking on every Pons scan: read the deployer's token
  transfers for a second PonsV2LauncherToken.
- **Dump into the curve, not the pool.** 20.1% went back into the curve inside
  three minutes of launch (blocks +767 to +1706) and 7.5% more before
  graduation; the last 2.5% hit the graduated pool. Each dev sell was met
  within four blocks by a cluster of buys from wallets funded hours earlier
  from Robinhood-scale hot wallets, so the curve absorbed the dump. Recipe:
  align deployer sells with buy clusters in the following four blocks.
- **Creator-fee redirect.** At 16:37 UTC, three minutes before the last bridge
  exit, the deployer called `PonsV2LaunchFactory.transferCreatorFeeRecipient`
  and pointed the fee stream at an escrow created through Pons's own
  `EscrowProxy` (`0x70e95cc5…`, deployed by the same address as
  PonsV2LaunchLocker, 68k txs). That escrow pays the 5% sell tax to holders
  in SPY every 90 minutes. A "fees go to holders" claim on a Pons token is
  therefore checkable: look for that call and for `Claimed` events on the
  recipient escrow. Here the claim became true only after the operator had
  taken its 2.59 ETH.
- **Brand after exit.** index9000.xyz was registered 66 minutes after the
  deployer's last transaction, the X account posts lore every two hours and
  follows only the Pons team and Robinhood, and a paid caller (@YusufGemz)
  pushed the token from a $227k to a $435k cap the next day. The BNB Chain
  address that received the bridged proceeds also exists on Robinhood Chain,
  is a serial Pons sniper since July, and bought back 0.39% nine minutes
  before the domain was registered. Same key on two chains is the one hard
  link between the exit and the marketing phase.
- **Who buys now.** 18.5% of supply in 24 hours through RobinHoodSettler, the
  Robinhood app's swap router, into fresh 7702 app wallets; sells come from
  aggregator and MEV contracts and the July sniper farm. When the settler is
  the only buyer, the bid is retail from a call channel.

## KOL call backtest: @YusufGemz (read 2026-09-17)

Method: 57 posts scraped from the profile (2026-08-31 to 2026-09-16), every
post naming a ticker with a bullish claim counted as a call at its post
time, ticker resolved to the deepest DexScreener pool, price taken from
GeckoTerminal hourly candles (close of the candle containing the post),
returns measured at +24 h close, the +24 h high, +72 h close and the last
candle on 2026-09-17. Repeat calls on the same token count separately
because each one asks followers to buy again. 28 of 31 calls priced;
$PAPERGIRL had no pool and two posts were commentary without a ticker.

| Call (UTC) | Token | +24h | +24h high | +72h | Now |
| --- | --- | --- | --- | --- | --- |
| 2026-08-31 09:40 | SIRIUS | -75% | +17% | -38% | -80% |
| 2026-08-31 16:12 | CASHCAT | -2% | +19% | +36% | -1% |
| 2026-09-01 15:30 | UPTOBER | -5% | +26% | -2% | -32% |
| 2026-09-02 14:53 | UBIK | -18% | +27% | +16% | +151% |
| 2026-09-02 18:14 | OPTIMUS | +30% | +87% | +58% | -22% |
| 2026-09-03 13:08 | DOGE-1 | -37% | +22% | -21% | -97% |
| 2026-09-03 16:20 | PONS | +24% | +34% | +36% | +11% |
| 2026-09-04 10:51 | OPTIMUS | -27% | +52% | -55% | -62% |
| 2026-09-05 12:50 | PONS | +3% | +8% | -17% | -27% |
| 2026-09-05 18:55 | UBIK | +15% | +30% | +46% | +28% |
| 2026-09-05 20:14 | PONSAN | -92% | +4% | -90% | -99% |
| 2026-09-06 14:57 | ZOLANA | -18% | +728% | -20% | -48% |
| 2026-09-07 12:50 | UBIK | -10% | +7% | -23% | -2% |
| 2026-09-08 08:24 | 4AI | -75% | +3% | -85% | -90% |
| 2026-09-08 21:07 | UBIK | -13% | +24% | +2% | -16% |
| 2026-09-11 10:37 | UBIK | +25% | +34% | -12% | -19% |
| 2026-09-11 15:23 | OPTIMUS | -6% | +32% | -8% | +96% |
| 2026-09-12 11:05 | UBIK | -17% | +25% | -38% | -34% |
| 2026-09-12 11:52 | DOGE-1 | -18% | +40% | -83% | -91% |
| 2026-09-12 12:09 | CASHCAT | -9% | +3% | -7% | +17% |
| 2026-09-13 14:32 | INDEX | +0% | +15% | -10% | +1% |
| 2026-09-13 16:28 | UBIK | -24% | +0% | -37% | -29% |
| 2026-09-14 14:56 | BEM | -23% | +6% | -30% | -30% |
| 2026-09-14 20:12 | IDX | +201% | +346% | +429% | +429% |
| 2026-09-16 01:34 | LONG | -66% | +56% | -65% | -65% |
| 2026-09-16 11:11 | IDX | +16% | +75% | +16% | +16% |
| 2026-09-16 12:50 | LIFT | -69% | +60% | -69% | -69% |
| 2026-09-16 17:09 | IDX | -21% | +9% | -21% | -21% |

Medians: +24 h -15%, +72 h -18%, now -25%. 20 of 28 calls were under water
at +72 h and still are. Seven calls printed a +50% high inside 24 h, which is
the window a caller's own exit needs; the only call that held was the first
$IDX mention on 2026-09-14 20:12 UTC, posted when the token was a $80k cap
four hours after its domain was registered, and his source for it was "my
$SPX friend" and "Quant told me". Tokens he says he "called early in the YG
cabal" (his private Telegram) read worst in public: $PONSAN -99%, $4AI -90%,
$DOGE-1 -97%, $SIRIUS -80%. The "no paid deal" disclaimer appears once, on
$4AI, the day after its launch.

Reading for ARGUS: a call from this account is a distribution event, not a
discovery. Score it as K2 exit-liquidity behaviour with the private-group
front-run pattern (public post after the private call, "already up Nx"),
and treat any token he touches in its first day as one being sold to his
audience.

Wallet search: for seven of his Robinhood calls (UBIK, OPTIMUS, PONSAN, 4AI,
IDX, CASHCAT, INDEX) every wallet that received the token in the eight hours
before the public post was collected and intersected. After removing
contracts, routers and bots with more than 5,000 transactions, no wallet
bought a meaningful size (0.05% of supply or more) ahead of three or more of
his calls, and only two drained EIP-7702 wallets did so ahead of two
(0x52a5e2e0… on OPTIMUS and PONSAN, 0x40efc800… on UBIK and PONSAN). The
intersection missed him because the threshold was set at three calls: the
FomoScan read below gives him a wallet, and that wallet sits in the IDX and
PONSAN pre-call sets, not in the others.

Wallet found (2026-09-17, via FomoScan): FOMO account "YusufGemz" (bio
"$500-$10K challenge", no X link stored) verified EVM wallet 0xde42eaab… and
Solana wallet EkeSXXNq…. From the IDX Transfer logs already collected:

| UTC | Direction | IDX | Counterparty |
| --- | --- | --- | --- |
| 09-14 16:35 | in | 7,952,438 | RelayRouterV3 0xb92fe925 (bridged buy) |
| 09-14 16:55 | in | 3,036,553 | RelayRouterV3 |
| 09-14 17:17 | out | 10,988,991 | 0xff218593 (his second wallet) |
| 09-14 17:22 to 17:42 | in | 5,524,642 | RelayRouterV3, three buys |
| 09-14 19:19 | out | 5,524,643 | 0xff218593 |
| 09-14 19:58 | in | 6,294,052 | RelayRouterV3 |
| 09-14 20:12 | | | first public $IDX call |
| 09-15 18:46 to 09-16 13:15 | out | 6,089,100 | 0xff218593, five moves |

The second wallet 0xff218593… is an EIP-7702 account (delegate 0xe8b12077…,
57 txs, 0.47 ETH) that received IDX only from him and from router
0x8366a39c…, and sold 23.8M IDX in round 1,000,000-token lots to contract
0x36dc95f1… from 2026-09-15 14:32 UTC, eighteen hours after the first call,
through the second (09-16 11:11) and third (09-16 17:09) calls. He therefore
held about 22.8M IDX (2.3% of supply) at the moment of the call he framed as
a tip from "my $SPX friend", and the position was liquidated into the demand
the three calls created. This is the K2 pattern with the wallet attached.
The PONSAN pre-call receipt (555K tokens) is small and the other five calls
do not show this wallet, so the Robinhood-app fresh-wallet reading may still
hold for those.

## FomoScan cross-comparison of the registry (run 2026-09-17)

FomoScan (api.fomoscan.sh) indexes FOMO (fomo.family) trader accounts: the
wallet each account verified for itself, the X account it links, cash-flow
numbers and posted "theses". PR #462 wires it in as provider `fomoscan`
(server/adapters/fomoscan.ts) and adds scripts/fomoscan-sweep.ts. First
sweep, results in eval/fomoscan/:

- Handles (13 registry accounts, 13,750 CU): three are FOMO traders with
  verified wallets: Altcoinist (Solana DVFYHVKF…, EVM 0xccdeb774…),
  lowcap_hunter (Solana 4CH1wgHq…, EVM 0x517b826b…, X link stored) and
  YusufGemz (Solana EkeSXXNq…, EVM 0xde42eaab…). The ten project and
  cofounder handles are not on FOMO. All three traders are net cash-out on
  FOMO (Altcoinist -$7.6k all time, lowcap_hunter -$32.7k on $1.4M volume,
  YusufGemz -$985 on $94k), which is FomoScan's sold-minus-bought figure,
  not realized profit.
- Wallets (84 registry wallets plus 216 traced wallets, 74,750 CU): zero
  resolve to a FOMO trader. Deployers, snipers, hubs, fee sinks and the
  IDX launch-bundle buyers are not FOMO identities. One registry address is
  a stored prefix (0x252e7031, rh-farm-prism) and could not be queried.
- Theses (28 registry launches, 7,000 CU): 13 launches carry FOMO posts.
  Altcoinist wrote 8 of the FIH and WRESTLER theses himself. $IDX collected
  25 theses in five hours on 2026-09-17 (08:40 to 13:42 UTC) in English,
  Chinese and Hebrew with the same "imaginary benchmark" framing, from
  accounts with no other thesis on our launches: a paid or scripted wave
  three days after the operator's exit. $PRISM theses turn from "dev is
  shipping" to "smells like a rug pull" on 2026-09-16 and tag @ogle and
  @unipcs as hoped-for backers. $DOGEGPT's four theses are all "can't sell".

Method notes: FOMO handles are not X handles, so a record binds to a
subject only when FOMO's stored X link (a username or a full x.com URL)
names the audited handle; name-only matches are recorded as such. Wallets
from FomoScan enter the registry as `kol-wallet` with FomoScan named in the
evidence, and as InvestigatorAttributed in audits, never SelfDoxxed.
FomoScan's own unit accounting ran about fifteen percent above the
documented prices (132,000 units left after 103,000 by list price), so
budgets should carry that margin.

## Base serial deployer: fees without a dump (BaseCat creator, read 2026-09-17)

A question about who sold the apple-emoji token 0xb200...36601 on Base turned
into a full read of the wallet behind it, 0x48c7ab8f. The wallet is indexed as
`base-b20-basecat-creator`. Three things are worth keeping.

**The identity link is a string, not just a sender.** The same wallet sent the
createLaunch for the apple token (o1 Launchpad, 2026-09-08) and for BASECAT
(B20 launchpad, 2026-08-15). Both calldatas carry the same embedded tag,
`bc_4raffiaj`, and so does every one of the 169 fee-claim calls, where it sits
in the third argument. A shared sender can be a relayer; a shared creator tag
that also keys the fee claims is the operator.

**Fee income, no supply.** The wallet took no allocation at any launch, never
held BASECAT at all, and sold nothing into any of its own pools. Its income is
creator fees: 233.234 ETH from BASECAT across 169 claims, measured by balance
delta at each claim block because the Blockscout internal-transaction index
returns only 19 of them. The gap is large enough to matter. The indexed view
showed 28 ETH of income against 266 ETH of outflow, which is how the shortfall
was noticed at all. On the apple token the fees accrue in AAPLc, the tokenized
Apple stock the pool is paired against, and 16.87 of the 17.62 AAPLc collected
went back into buying the token and burning it: 39,119,746 tokens, 3.91 percent
of supply, still at the burn address. Proceeds leave through a sweep wallet
0x60578f65 and the Relay depository.

**Two attribution traps, both worth remembering.**

- *ERC-4337 bundlers look like whales.* Resolving each sale to its transaction
  sender produced a tidy cluster of 48 wallets with a 0x4337 vanity prefix
  holding 48 percent of sells. They are bundler operators submitting `handleOps`
  to the EntryPoint at 0x4337084d, so they appear as the sender of other
  people's trades. Walking the token graph instead, hop by hop through the
  routers inside each transaction, gives 1,415 sellers with the top ten at 11
  percent.
- *Bridge solvers look like a common funder.* Twenty-one of the forty largest
  sellers, together 75 percent of supply sold, were funded by the same wallet
  that had also sent the creator 5.5 ETH. That wallet, 0xf70da978, made 640 ETH
  payouts to 285 distinct addresses in a three-hour window while calling the
  Relay router and deposit contracts. It is a bridge filler paying out everyone
  who bridges into Base, and it carries no attribution weight. This is the same
  rule the Robinhood hot wallets taught: a shared funder is not an operator
  link.

The series itself reads as volume with one hit: ten tokens deployed through an
unverified deployer between 2026-07-21 and 2026-08-12 and abandoned at the mint
with no pool and no transfers, two launchpad launches that never traded, the
apple token down 97.6 percent from a high set five hours after launch, and
BASECAT alive a month later at about 615,000 USD of liquidity and 487,000 USD
of daily volume.
