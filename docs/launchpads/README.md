# Launchpad landscape study — working document
Started 2026-09-23. All figures are point-in-time reads with the source named. Anything not verified is marked UNVERIFIED.

> **Audit correction (2026-09-24):** This is a historical research record, not proof of completed collection or current product behavior. The required holder target is **25**. Address suffixes are candidate venue clues, not proof of origin; generic platform mechanics do not prove a particular pool is locked or immune to withdrawal. Creator fee denomination is a note, never a demerit: adverse conduct requires observed claims and sales. Volume/depth ratios are screening signals, not proof of manipulation. Comparative rug/extraction rankings require a defined population, period and outcome methodology, which this study did not supply. See `docs/launchpads/COLLECTION.md` and issue #525 for remaining collection work. Historical claims below must be corroborated before reuse.


## 0. Scope and honesty note
Eight platforms across three chains. A full index of every launched project with 15-holder identity scans on 25×3×3 tokens per platform is ~2,000 token scans and tens of thousands of wallet lookups; this document builds the landscape, verifies mechanics and contracts, assesses native tokens, sweeps the leading projects and runs identity checks on a sample. It is structured to be extended.

## 1. Native tokens at a glance (DexScreener, read 2026-09-23)
| Token | Chain | Price | FDV | Liquidity (all pairs) | 24h vol | First pair | Address |
|---|---|---|---|---|---|---|---|
| PONS | Robinhood | $0.6976 | $477.4M | $32.4M | $76.1M | 2026-07-13 | 0x39dBED3a2bd333467115dE45665cC57F813C4571 |
| PUMP | Solana | $0.0042 | $3.50B | $34.9M | $30.1M | 2025-07-14 | pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn |
| BONK | Solana | $0.00000387 | $344.3M | $1.44M | $4.6M | 2022-12-20 | DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 |
| BAGS | Solana | UNVERIFIED (search matched a $5.6K namesake; real token pending) | | | | | |
| BNKR | Base | $0.000394 | $38.0M | $3.13M | $2.62M | 2024-12-03 | 0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b |
| STONKBROKER | Robinhood | $0.01204 | $28.6M | $5.38M | $1.23M | 2026-07-18 | 0xe934e36A439C94017B64a3FecE66AF12099aBF50 |
| LONG | Robinhood | $0.01017 | $10.2M | $5.10M | $253 | 2026-07-21 | 0xe04E93829Be841bA6B8361e136C8dD3eC2e1f944 (UNVERIFIED as the app.long.xyz token; no site/social on the listing) |
| STONK | Solana | $0.3296 | $329.7M | $188.5M* | $44.0M | 2026-07-23 | 6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx |
*STONK liquidity is summed across 22 pairs including pairs where STONK is the quote asset, so it overstates STONK's own depth.

## 2. Robinhood Chain cross-cut (chain id 4663)
Source: GeckoTerminal top pools by 24h volume and by tx count (106 pools, 70 distinct non-infra tokens), each token attributed to its minting factory from the first Transfer-from-zero log (RPC), read 2026-09-23. Files: data/pools.json, data/attribution.json.

### 2.1 Factory → launchpad map (established)
- **Pons**: selector `0x686399cb` across factories 0x0c37a24f5d23a486fa692d1500881d698b1f77a4 (PONS's own launch, 2026-07-13), 0x2ba793fd…, 0x7ed598bc… (V2 LaunchFactory), 0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb (current PonsLaunchFactory, verified name on Blockscout), locker 0x736d76699c26d0d966744cae304c000d471f7f35 (PonsLaunchLocker, holds 266,221 LP positions). **Consequence: the in-token creator-fee farms already in Argus (wire bot, LEMON) are Pons launches.** Pons pays creator fees in the launched token via the locker; MOTION's deployer received 85 such payments.
- **Factory 0x22e99278308b393ea1260859b181ad7e78f5eeed + hook 0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862** (can also be called directly): TAIWAN, MEME, AI (Artificial Inu, $264M FDV), MONITOR, musebook ($31M), Agrippa, museic. Shared fee contract DopplerHookInitializer 0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544 (inventory in ~21,000 tokens; pays creators in-token via selector 0x817db73b). Platform identity: PENDING (LONG or StonkBrokers agent reports).
- **Factory 0xd9ec2db5…**: CASHCAT ($164M FDV), JUGGERNAUT, FIH, POOCH. Platform identity: PENDING.
- **Factory 0xe33e9e47…**: ORBIO ($75M), PARE, ZEAL, NOSH, GIT. PENDING.
- **Factory 0xce9c48cf…**: o1 launchpad (WRESTLER).
- **Robinhood Stock Tokens**: NVDA, META, SPY, AAPL, PLTR, GOOGL, GME, GLD, USO, CRCL, SPCX all deployed 2026-06-23 by issuer 0x2b94105f… (each a proxy at its own address). These are the assets launchpads pair against.
- Infra, not launchpad: USDB/ATC (factory 0x896cb155…), bridged BTC, WETH, USDG.

### 2.2 Leading launchpad-origin tokens on the chain (by 24h volume, wash ring excluded)
| Token | Factory family | FDV | Liquidity | 24h vol | Launched |
|---|---|---|---|---|---|
| PONS | Pons (0x0c37a24f) | $474M | $8.8M (largest pair) | $71.9M | 2026-07-13 |
| AI (Artificial Inu) | 0x22e99278 | $264M | $3.7M | $13.4M | 2026-07-14 |
| CASHCAT | 0xd9ec2db5 | $164M | $2.5M | $9.6M | 2026-06-18 |
| GOOSE | direct deploy | $118M | $12.6M | $9.6M | 2026-08-26 |
| ORBIO | 0xe33e9e47 | $75.5M | $762K | $2.1M | 2026-08-31 |
| MEME | 0x22e99278 | $38.2M | $1.6M | $4.6M | 2026-09-03 |
| astro | direct deploy | $32.1M | $545K | $9.1M | 2026-09-08 |
| musebook | hook 0xeb7c0347 | $31.0M | $8.2M | $53.3M | 2026-09-16 |
| U | 0x59f94ade | $30.0M | $3.0M | $2.1M | 2026-09-07 |
| DELTA | Pons (0xa5aab3f0) | $26.9M | $1.6M | $3.2M | 2026-07-31 |
| SHROOM | 0xad5bc794 | $19.8M | $1.4M | $2.1M | 2026-09-01 |
| STANDARD | 0x5977b254 | $17.9M | $13.1M | $2.2M | 2026-09-14 |
| Agrippa | hook 0xeb7c0347 | $7.0M | $2.1M | $21.8M | 2026-09-17 |
| museic | hook 0xeb7c0347 | $6.7M | $173K | $1.3M | 2026-09-18 |
| MONITOR | 0x22e99278 | $6.6M | $878K | $7.1M | 2026-09-02 |

### 2.3 FINDING: a wash-volume ring is polluting the chain's volume rankings (read 2026-09-23)
31 tokens deployed directly (no factory) on 2026-09-21/22/23 from 32 distinct fresh deployers (nonces 5–18, most drained to 0 ETH after use) report $1.9M–$23M of 24h volume on $0–$300K of liquidity; volume/liquidity ratios of 100× to 5,000×, and four (a fake BTC, GREEN, FCAT, SHIB) show millions of volume on zero liquidity. Three bytecode templates cover 21 of the 31: template A (1,764 bytes): PGREM, CRAIL, HITBUY, PKRT, PROUTE, CAPYTL, PURRF×2, ShinyHunters, Tweenix; template B (4,655 bytes): NODIUM, RIG, BOBCOIN, SI, BET, JEV, GTC; template C (3,554 bytes): Euler, NOSH, HOOD6900, GROK. Several are name-clones of real tokens (musebook, Agrippa, HOOD6900, BTC, SHIB). Funding links found at hop 1: 0x361bcf4b707695494db2b71f541af33776280876 funded both CRAIL and PROUTE; JEV's deployer 0xc96aa6ad793bc744beb11a9afd1813470ca194dc funded RIG's deployer with 16.09 ETH and NODIUM's was funded 12.85 ETH, so template B is chain-funded from one pot. **Any "top by volume" list on Robinhood Chain must exclude these; none belongs to the eight launchpads.** Candidate Argus entry: `rh-volume-ring-2026-09-22` (infra / nefarious). Hop-2 funder trace still to do.

## 3. Per-platform sections
(populated from the platform investigations as they complete)

### 2.4 Top-15 holder scans, Robinhood launchpad tokens (Blockscout, read 2026-09-23)
- **PONS**: 101,359 holders, 10.22M transfers. 31.57% burned at 0x…dEaD. Largest live holders: 0xC882b111A75C0c657fC507C04FbFcD2cC984F071 4.95% (≈$23.6M; only 17 txs, 174 token transfers, 0.01 ETH: a passive wallet holding a nine-figure-adjacent position; also 1.11% of CASHCAT), 0x091D1C972cb1648537a2Ba78eaBa371b1cE18336 2.59% (20 txs), 0xB995B918… 1.92%, 0xa64723bF… 1.63%, 0x2dBAf98620aC5Bbe3441f756fEfF82702D095b1a 1.12%. PoolManager 0.96%.
- **AI (Artificial Inu)**: 52,499 holders, 7.22M transfers, top holder 2.96% (contract 0x8F62A085…), PoolManager 2.92%, a TimelockController at 0.88%; no holder above 3%. Flattest large token on the chain.
- **CASHCAT**: 112,087 holders, 11.35M transfers. Top holder 0x841ed663F2636863D40be4EE76243377dff13a34 at **14.49%** (≈$23.7M) with 3,312 ETH on hand and only 346 txs: the single largest identified whale in this sweep. Second 0x65B01414… 4.46%.
- **STONKBROKER**: 43,913 holders, 3.57M transfers. **50.94% sits in TokenEscrowReserve 0x799AE26fA515ceF145e8bC8636F7fFF87B05Cf62** (verified contract, 3,812 token transfers): the streamed/escrowed supply mechanism. PoolManager 5.82%; largest EOA 1.21%.
- **LONG (0xe04E9382…)**: 14 holders, 24 transfers, 50% in one contract, 10% in vitalik.eth (0xd8dA6BF2…), 10% another EOA, 5% "LBPStrategy". **This is not a live market and is UNVERIFIED as the app.long.xyz token; the $10.2M FDV on $253 volume is meaningless.** Pending the LONG platform report.
- Recurring wallets across tops: 0xDE52C75041371b5E08d8a50b82C63734850628C1 (PONS 0.90%, AI 1.21%, CASHCAT 1.16%; 379 txs, 17,326 token transfers: an active multi-token holder, candidate for FomoScan), 0x2dBAf98620aC5Bbe3441f756fEfF82702D095b1a (PONS, STONKBROKER; 74,392 txs, 221,211 token transfers: bot or market-maker), 0x88D25C861938a91AF4ad57aD964a8fCc6c6351d3 (PONS, CASHCAT; 70,194 txs, 446 ETH: Robinhood-scale hot wallet, exchange custody, not a whale), 0x1890E719822bc704C4f117AA4109401C2BAb6f79 (AI 1.86%, LONG 10.8%; Simple7702Account = Robinhood app user wallet, 4,508 token transfers).
- Identity pass queue (FomoScan wallet lookup, 50,000 CU each, run selectively): 0xC882b111…, 0x841ed663…, 0xDE52C750…, 0x2dBAf986…, 0x091D1C97….

### 2.5 FomoScan identity pass on Robinhood whales (2026-09-23)
All five queued wallets (0xC882b111, 0x841ed663, 0xDE52C750, 0x2dBAf986, 0x091D1C97) returned **miss** at 250 CU each (plan legacy-starter, 827,350 CU remaining after). None of the largest launchpad-token holders on Robinhood Chain is a FomoScan/FOMO trader. The chain's whales are exchange custody, app-native 7702 wallets or private capital, not social-trading accounts.

## 2b. Solana native-token holder structure (Solscan, read 2026-09-23)
- **PUMP**: 259,976 holders; top 10 own **59.69%**: Pump.fun Token Custodian 27.54% ($964M), pump.fun Squads Vault "Coin 2 SOL5" 9.61%, five further Squads vaults 4.2% / 3% / 3% / 2.88% / 2.3%, one unlabeled 2.55%, Binance 3 at 2.5%. About 52% of supply is in pump.fun-controlled custody and multisigs, consistent with the 20% team + 13% investor + 24% ecosystem allocations being largely unvested.
- **STONK**: 92,422 holders; top 10 own **18.44%**: 4.77% tagged High Frequency Trader ($12.9M), 2.53%, 2.19%, 1.73%, 1.63%, Gate 1.3%, "J777Crypto on Pump.fun" 1.2%, then ≤1.13%. Unusually flat for a two-month-old $270M token; the largest holder is a market-making bot, not a founder wallet.

### 2.1b Factory → launchpad map, RESOLVED (2026-09-23, after the platform reports)
| Factory / contract | Platform | Evidence |
|---|---|---|
| 0x0c37a24F5D23A486FA692d1500881d698B1F77a4 (legacy v1), 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB (active v1, launching now disabled), 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e (v2 LaunchFactory) | **Pons** | docs + factory getters; selector 0x686399cb on v1 |
| **0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB** | **noxa.fun launch factory** (Pons v1 derives from this codebase per a frontend constant; CASHCAT, JUGGERNAUT, FIH, POOCH) | Pons frontend `NOXA_FUN_LAUNCH_FACTORY`; identity of noxa.fun operator UNVERIFIED |
| **0x22e99278308b393ea1260859b181ad7e78f5eeed** = verified **`LongLauncher`** (AIRLOCK, TRUSTED_TOKEN_FACTORY, ticker reservation; 31,982 txs; creator 0x1Ae51740cE21CAEbB8C92C457Ad7fc1bdAAe5305) | **LONG (app.long.xyz)**, a Doppler integrator; tokens carry vanity suffix `…1e18` | Blockscout verification; Bankr's API rejects these; AI, MEME, TAIWAN, MONITOR, BONER |
| 0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862 = **Doppler Airlock** (RH); 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544 = **DopplerHookInitializer**; fee hook 0x9982538f41f2ae29ddb9d3d9307010052984fdbb | **Shared Doppler infrastructure** used by both Bankr and LONG on Robinhood Chain | Bankr launch calldata decode |
| Bankr integrator 0xF60633D02690e2A15A54AB919925F3d038Df163e; tokens with suffix `…ba3` (musebook, Agrippa, museic, Nautilo, Euler, GME 0xc2362aff…) | **Bankr** on RH | Bankr API confirmation |
| 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948 | **Pons v2 LaunchAndBuy router** (ORBIO, PARE, ZEAL, NOSH, GIT launched atomically through it) | Pons docs |
| 0xFCd61B25BbF3AbD6cf0070D6328E351cc30EEC9f (WETH pad), 0x8f6782c5Aa37804d08a9b7bf3984Ff3245Fd6cD4 (STONK pad), 0x4B9Dcd6CCFAeF0f6D23065Dd78E79d5E20ec8cFD (GME pad), 0x80a77001456bc986083678F9a112B1EC2Aa07281 (factory) | **StonkBrokers** Smart Launch V2 pads | StonkBrokers docs |
| 0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37 (BagsFactory), hook 0x2380aBf72C17aABAb76480244759AC7E2932EEcC, vault 0x4861446aa7fFd9e67a83cBbAcb1A4B70540B83Aa | **Bags** on RH | Bags docs |
| 0xce9c48cf… | **o1 launchpad** (WRESTLER) | prior session |
| 0x2b94105f… (deployer of NVDA, META, SPY, AAPL, PLTR, GOOGL, GME, GLD, USO, CRCL, SPCX on 2026-06-23) | **Robinhood Stock Token issuer** | attribution sweep |
**Consequences for the Argus registry:** `rh-machi-taiwan` and `rh-meme-amc` record venue "unknown factory 0x22e99278"; both should read "LONG (app.long.xyz), LongLauncher over Doppler Airlock". The creator-fee payments both entries attribute to "the shared launchpad fee contract 0x4e346895" are Doppler's initializer paying LONG creators. Doppler-based launches (Bankr and LONG) pay creators by default in a **mix of the launched token and the quote**, which is the structural source of the in-token creator sell pressure seen on MEME/TAIWAN; Pons v2, pump.fun, letsbonk, Bags, StonkFun and StonkBrokers all pay creators in the quote asset only.

## 3. Per-platform reports
See `pumpfun.md`, `letsbonk.md`, `bags.md`, `stonkfun.md`, `bankr.md`, `pons.md`, `long.md`, `stonkbrokers.md` in this folder. Raw sweep data in `data/`.

## 4. Synthesis (2026-09-23)

### 4.1 Comparative table
| Platform | Chain | Native token (FDV) | Curve → venue | LP after launch | Creator paid in | Creator share | Platform take | Lifetime platform revenue | Lifetime creator payouts | Team |
|---|---|---|---|---|---|---|---|---|---|---|
| pump.fun | Solana | PUMP $3.50B | curve → PumpSwap | LP burnt | quote (SOL/USDC) | 0.30% curve; up to 0.95% post-grad | 0.95% curve; 0.05% post-grad | fees $1.235B, revenue $1.131B | $104M | doxxed (Baton Corp; RICO suit live) |
| letsbonk | Solana | none (uses BONK) | LaunchLab → Raydium CPMM | ~100% burnt | quote (SOL) | 0% Memes mode; 0.05% Bonkers | 1.25% curve | 395,981 SOL (~$67M); now ~$16K/mo | n/a | BONK contributors; 51% owned by Nasdaq BNKK |
| Bags | Solana (+RH) | none | Meteora DBC → DAMM v2 | 100% platform-locked | quote (SOL) | 50% of 2% = 1% | 1% (+1% app router) | fees $64.2M, revenue $32.1M; now ~$6K/day | $32–40M | Finn Bags (Bags Holdings Inc) |
| StonkFun | Solana | STONK $270–330M | LaunchLab → CPMM | 100% to platform (lock UNVERIFIED) | quote asset incl. the stock token | ~0.5% (standard); 0 in reward mode | ~0.5–1% (60% bought back) | $22.8M since 07-25 | "$77.5M" (marked to current prices) | anonymous |
| Bankr | RH + Base | BNKR $38–40M | none → v4 immediately | protocol-held, LP leg compounds | **mix of launched token + quote** (quote-only optional) | 0.665% | 0.475% + 0.2375% BNKR buyback | $17.19M on $5.45B volume | $23.45M | pseudonymous (@0xDeployer) |
| Pons | RH | PONS $477M | v2 curve → v4 pool (v1 straight to V3) | permanently locked | v2 quote only; **v1 half in-token** | 70% of 1% (v2); 70/90% of V3 fees (v1) | 30% of 1% | $29.5M protocol; 80% → PONS burn | $125M | Pons Labs LLC; Ozzy @MEADGod |
| LONG | RH | none ($AI $265M is the flagship) | none → v4 immediately | permanently locked (book-entry) | **both pool tokens, half in-token** | 95% of a 0.1–0.2% LP fee | **~100% of the 1.12% hook fee** | $13.23M USDG realised since 07-14 | 6.46 ETH + in-token across 31,295 claims | pseudonymous (@Natan_benish) |
| StonkBrokers | RH | STONKBROKER $28.6M | curve → V3/Slipstream | permanent fee-only lock | quote asset | 16.5% of tax + 80% of LP fees | 16.5% + 16.5% to NFT holders | 1,042.75 ETH tax (~$2.85M), 99% in five days | ≈60 ETH + WALL 56 ETH | doxxed (Admir Zlatic; self-audited) |

### 4.2 Which reward models create downward pressure from creator fees (Q7)
- **In-token creator fees (structural sell pressure):** **LONG** (both pool tokens, half in-token, and the platform's own "buyback" leg dumps the launched token for USDG), **Bankr** (default mix unless `quoteOnlyFees`), **Pons v1** (retired; the wire bot, Lemon.fun and MOTION streams). These are the three sources of every in-token fee farm found on Robinhood Chain.
- **Quote-asset only (no direct creator sell pressure):** pump.fun, letsbonk, Bags, StonkFun, Pons v2, StonkBrokers. StonkFun's reward mode adds a 1–3% transfer tax that rewards churn instead.
- **Platform-side pressure:** LONG's hook routes 71–100% of fees to an EOA that liquidates into USDG ($13.2M realised); Pons v2 converts launch-token fees back into the pool (bounded ≤3% impact); pump.fun and StonkFun run net buybacks of their own tokens (50% and ~60% of revenue) which is upward pressure on PUMP/STONK, not on launched tokens.

### 4.3 Tokenized-stock pairing (Q9)
Supported on: **LONG** (the pioneer; 56K launches, ~40% stock/wrapper-quoted; AI/NVDA $26.6M pool, BONER/HIMS $53.6M, MONITOR/PLTR, INU/AAPL, MOO/MU, SCHIFFY/GLD…), **Bankr** (16,327 stock-paired launches, $230M volume; musebook/META $30M, GME/GME), **Pons v2** (224 of 928 graduates equity-paired: ORBIO/NVDA $76M, UBIK/GLD $21.5M, SHROOM/MU $20.3M, BOW/SPY, OPTIMUS/TSLA), **StonkFun** (55,777 stock-paired launches = 48%; graduate at 3.0% vs 1.1% for SOL pairs; GP/GLDX $16.1M, ALLINU/DKNG $10M; PreStocks/Tessera have never produced a >$1.3M token), **StonkBrokers** (169 stock-lane launches, 24 bonded, **only 3 with >$1K liquidity**), **letsbonk** (xStocks quotes exist, <$10K lifetime each), **Bags** (xStocks/Ondo direct launches on Solana; RH "dividend coins" buy stock baskets). Not pump.fun.
Verdict: stock pairing works where the platform makes the stock the whole lifecycle's numeraire and has depth (LONG, Bankr, Pons v2, StonkFun) and fails where it is bolted on with thin stock/USDG pools (StonkBrokers, letsbonk). On StonkFun the stock quote roughly triples graduation odds vs SOL.

### 4.4 Rankings against the stated goals
- **Most successful projects (sustainability, price, holders, community):** Robinhood Chain via Pons and LONG has produced the most large, widely-held tokens this quarter (PONS 101K holders, AI 52K, CASHCAT 112K, MEME 4.7K, ORBIO, BONER, GOOSE), with unusually flat distributions (AI top holder 2.96%). pump.fun still owns the CEX pipeline (11 graduates on the requested exchanges). letsbonk's one durable win is USELESS ($319M). Bags, StonkBrokers and StonkFun's non-STONK output have produced almost nothing above $1M that lasted.
- **Most caballed / manipulated:** (1) **StonkBrokers**: a curve-scalping bot cluster, an insider-adjacent allowlisted launch paying its deployer 48.7 ETH, 85.8% blended buyer tax on WALL, serial creators making 277 of 1,310 launches. (2) **Robinhood Chain generally**: a 31-token wash-volume ring polluting volume rankings (§2.3), Blockscout symbol spoofing, ticker squats. (3) **StonkFun**: 9,300 launches/day, homoglyph tickers, tax-farming churn, dev-buy-first up to 50%. (4) **pump.fun**: 98.6% rug/pump characteristics (Solidus), wash pools dominating GeckoTerminal, custom-pair mcap inflation. (5) **LONG**: 15K launches/week, creator dumps structural.
- **Biggest red flags:** LONG (platform keeps ~100% of hook fees to an EOA, no token, anonymous, "buyback" is a sell); StonkBrokers (self-certified audits, admin keys on pads, treasury EOA, extreme snipe taxes); StonkFun (anonymous, undesignated law, 100% of migrated LP platform-held with lock unverified, tax withhold authority); Bags (consent-free tokenization of real people, admin-updatable fee splits, near-zero current revenue); pump.fun (live RICO claims). Pons is the most transparent RH platform but is unaudited and control sits with a 2-of-3 Safe plus an operator EOA.
- **Most value extraction from retail on average:** StonkBrokers in its Aug 17–20 window (buyers paid 85.8% tax on WALL; 361 ETH tax in five days on 796 ETH of buys); LONG (hook fee to platform, creators' half-in-token dumps); pump.fun by sheer scale ($1.235B fees on a base where <2% of launches graduate). StonkFun and Pons return the most to their own token holders via buybacks, which is extraction from launched-token traders redirected to native-token holders.
- **Most rugs and scams:** by count, pump.fun (7M+ launches, 98.6% flagged) and StonkFun (116K launches, 3% graduate); by mechanism, none of the eight allows an LP pull post-launch (all lock or burn), so "rugs" here are creator dumps, snipe-tax extraction, fake-volume and impersonation rather than liquidity removal. Bankr's 756K deploys in Mar 2026 was farming, not scamming.
- **Chain map:** Solana = pump.fun, letsbonk, Bags, StonkFun. Robinhood Chain = Pons, LONG, StonkBrokers, Bankr (primary), Bags (secondary). Base = Bankr (secondary). Ethereum = none of the eight (StonkBrokers has Anvil/locker deployments there).

### 4.5 Wallet infrastructure ("who's who in the zoo")
- **Robinhood Chain infra to never mistake for whales:** Uniswap v4 PoolManager 0x8366a39c… (holds pool inventory of every v4 token), UniversalRouter 0x88767899…, RelayRouterV3 0xb92fe925… (bridge; carries insiders' exits), RobinHoodSettler 0x6aa80dbb… (app swaps), 0x AllowanceHolder 0x0000000000001ff3…, Doppler Airlock 0xeb7c0347…, DopplerHookInitializer 0x4e346895… (pays creators; inventory in ~21,000 tokens), Rehype hooks 0x6f02324d… (LONG) / 0x9982538f… (Bankr), PonsLaunchLocker 0x736d7669…, Pons v2 LaunchLocker 0x267444d0…, StonkBrokers Anvil Escrow 0x799ae26f…, Robinhood hot wallets (0x88D25C86… 70K txs, 446 ETH; 0x53091256…; 0xabb2aCD3…; 0x370A7E2d…; 0xadA5bb90…; 0xa67D7Eb4…; 0x56c26202…), Simple7702Account delegates = app users, trading-terminal relays (e.g. F7p3dFrj… on Solana at 436K tx/day).
- **Platform treasuries:** Pons Safe 0x263ed295… (fee recipient + owner), Pons treasury Safe 0x29b7f877… (742 ETH), Pons splitter 0x5795d227… (480 ETH), Pons operator EOA 0xda4bcee7…; LONG EOA 0x92d435c9… (12.86M USDG); LONG launcher owner 0x9b7f0d4d…; Bankr protocol Safe 0x5f8da8f8…, buyback 0x042455f9…, integrator 0xF60633D0…; StonkBrokers treasury EOA 0xb668382c…, pad owner 0x3914e01a…; Bags RH vault 0x4861446a…; StonkFun fee wallet 5CEbueQn…, treasury 458aGtmE…; pump.fun 24 fee recipients + custodian Cfq1ts1i…; letsbonk platform 56XVRVAs…, BNKK 3rqUcRh7….
- **Identified large holders:** CASHCAT 14.49% at 0x841ed663… (3,312 ETH, 346 txs, FomoScan miss); PONS 4.95% at 0xC882b111… (passive, FomoScan miss); STONK top holder is an HFT bot (4.77%); PUMP is 52% pump.fun custody/multisigs. Cross-token active holder 0xDE52C750… (PONS/AI/CASHCAT; FomoScan miss). None of the RH whales are FomoScan traders.
- **Known bad-actor clusters to index:** the RH wash-volume ring (§2.3; funders 0x361bcf4b…, 0xc96aa6ad…); StonkBrokers scalper cluster (0xac98…da41, 0x3fb0…2f0b, 0xa1bf…c726, 0x18a7…ef97, 0x6fe1…1634); RH snipe infra already in Argus (0xca330263…, bundlers 0x1e43ce00…/0x14b9a544…, executor 0xb06983db…).

### 4.6 Early-runner signals worth encoding (for the alpha scanner)
1. **Venue fingerprint at mint**: suffix `…1e18` (LONG), `…ba3` (Bankr Doppler), `…b07` (Bankr Clanker), `…pump`, `…bonk`, `…BAGS`, selector 0x686399cb (Pons v1), Pons v2 LaunchAndBuy router 0xe33E9E47…, StonkBrokers pads. Venue predicts fee model and therefore creator sell pressure.
2. **Quote asset**: stock-quoted launches on LONG/Pons v2/Bankr are where this quarter's runners came from (AI/NVDA, BONER/HIMS, ORBIO/NVDA, musebook/META, MONITOR/PLTR); on StonkFun stock quotes triple graduation odds.
3. **Launch-block behaviour**: Pons v2 and LONG/Bankr snipe taxes make block-0 buyers pay 80–99%, so an early buyer surviving that is either the creator's exempt wallet (Pons) or paying to be first; StonkBrokers' 99% taxes mean early volume is extraction, not demand.
4. **Creator claim cadence**: on LONG/Bankr, watch the initializer `collectFees` (0x817db73b) and Pons v1 locker claims; a creator forwarding claims one hop to fresh wallets that hit RelayRouterV3 or the PoolManager is the exit signature (MEME, TAIWAN, wire, LEMON).
5. **Holder shape at day 3**: the runners had top-10 non-pool concentration under ~20% (AI 15%, MEME 15%, STONK 18%) and 4K+ holders; the failures had a single wallet >14% or a treasury >50%.
6. **Fake-volume filter**: exclude any pool with volume/liquidity >100× or liquidity < $5K; both GeckoTerminal RH and PumpSwap volume ranks are currently dominated by wash pools.

### 4.7 Left undone (explicit)
- Top-25 lists by 7-day and 30-day volume per platform (only 24h and liquidity/mcap were pulled); 15-holder scans were run on 7 tokens, not 600; Arkham identity checks not run (the API returned 400 in a prior session); FomoScan wallet lookups run on 5 wallets (all misses).
- Hop-2 funder trace of the RH wash ring; the noxa.fun operator identity; StonkBrokers treasury sweep destination; LONG's burn/lock contracts and LongX controller; Bags' Solana treasury wallet; whether StonkFun's migrated LP is locked.
- Registry follow-ups: correct `rh-machi-taiwan` and `rh-meme-amc` venue to LONG; add `rh-volume-ring-2026-09-22`; consider `rh-stonkbrokers-scalper-cluster`; add venue fingerprints to RESEARCH.md.
