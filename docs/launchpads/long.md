# LONG (long.xyz / app.long.xyz) — platform report (read 2026-09-23)
First-party sites are Cloudflare-gated; docs unreadable. Everything below is on-chain (RPC) or market data unless marked third-party/UNVERIFIED. Raw event dumps in `../` (`long_create_logs.json`, `usdg_daily.txt`, `long_index.json`, `release_logs.json`).

Chain: **Robinhood Chain (4663)**. A launchpad that launches tokens **directly into a Uniswap v4 pool paired against a Robinhood Stock Token** (or ETH/USDG/$AI/LongX wrappers). **No bonding curve**: the full 1B supply goes into a locked multicurve position in the creation tx. **LONG is an integrator on Whetstone's Doppler protocol.** X @longdotxyz (also @joinlong_); co-founder @Natan_benish (followed by Adam Fern; Vlad Tenev follows @amemecoinrh, a LONG launch) — follow data from 2026-09-10, not re-verified. Entity/funding: none found. GitHub org Long-xyz has one repo, a fork of whetstoneresearch/doppler (identity link UNVERIFIED). App landing: "Live now: Launch with stock tokens on Robinhood Chain. Making tokenized markets valuable again."

## Contracts
| Role | Address |
|---|---|
| LongLauncher v1 (verified, solc 0.8.26; 31,742 creates 2026-07-13→09-10; 24h ticker reservation; **now paused**) | 0x22e99278308b393ea1260859b181ad7e78f5eeed |
| LongLauncher v2 (active) | 0x1eEF016F22a943Abc7DD11422edee9d235942104 |
| Launcher owner (EOA) | 0x9b7f0d4dcf6a4baed39b2f4f5aeae6ca082bed47 |
| Doppler Airlock (173,204 Create events chain-wide, all integrators) | 0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862 |
| DopplerHookInitializer (LP custody book-entry + FeesManager) | 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544 |
| Rehype fee hook used by all 56,211 LONG pools | 0x6f02324d20cc679d0e585290caa6b16bacbc0f77 |
| Trusted token factory (EIP-1167 clones of 0x3be8b97f…, addresses mined to end `…1e18`) | 0x1b37d3a72082029c44b35b604ea473617580b69a |
| **LONG integrator / buybackDst / treasury (EOA)** | **0x92d435c96e63c43e12d6d0ab28f6b0b04072f765** |
| Doppler protocol owner (5% beneficiary, never claimed) | 0x21e2ce70511e4fe542a97708e89520471daa7a66 |
| LongX wrappers: NVDAx3L 0xf51FB54DE60F6e16252e852A5ed0e60B8307606a, ANTHROPICx1L 0x1937CAd42B17d43BB2B347Ce16D5288887C46c33, OPENAIx1L 0xFe09FB328Be1C286b4F597ed34764b7472Ae72c5 (proxies; controller UNVERIFIED) | |
Robinhood-app 7702 wallets can also call the Airlock directly with LONG's integrator address.

## Native token
**No $LONG platform token exists on chain.** The DexScreener "LONG" 0xe04E9382… (created 2026-09-23 09:00 with 0.11 USDG one-sided, 14 holders) is a squat; "Longbow.meme" LONG is unrelated. **De-facto flagship and value-accrual token is $AI "Artificial Inu" 0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18** (LONG launch ≈2026-07-14 paired with tokenized NVDA; that pool holds $26.6M): price ≈$0.26, FDV ≈$260–265M, supply 991.3M (0.87% burned), ≈$33M liquidity across 13 pools, $18.4M 24h vol; reported ATH $325M. **9,748 LONG launches (17%) use $AI as quote** ("AI pairing mode"), the mechanism that pulls $AI into pools; LongX wrapper fees claimed to accrue to $AI (UNVERIFIED). AI/NVDA pool's 95% fee beneficiary 0x4a0Cb7EEf4b4dC31c75EAC705E03463cFC3C5cB2 (team link UNVERIFIED).

## Launch mechanics (decoded from create txs)
`Airlock.create` with initialSupply = numTokensToSell = 1e27, governance/timelock = 0xdead, NoOp migrator → pool initialised Locked in the initializer, positions book-entry, **no NFT, no unlock path, no migration: LP permanently locked by construction.** Pool: v4 dynamic fee, tickSpacing 8, LP fee 0.10–0.20%. **Anti-snipe: hook swap fee starts at 80% and decays to 1.12% over 10 seconds** (`getFeeSchedule`). **Fee distribution (`getFeeDistributionInfo`), TAIWAN-era:** launched-token-side hook fees 71.43% swapped to numeraire → `buybackDst`, 28.57% re-added as LP; numeraire-side 71.43% → `buybackDst`, 14.29% buys the launched token (output to `buybackDst`), 14.29% LP. **`buybackDst` = LONG's own EOA 0x92d435c9…** **Today's config: 100% of hook fees to LONG's wallet, nothing reinvested.** Quote assets by launch count: $AI 9,748; ETH 6,736; NVDA 3,611; SPCX 3,585; USDG 3,348; NVDAx3L 2,411; ANTHROPICx1L 2,121; OPENAIx1L 2,052; AAPL 1,300; GME 1,230; TSLA 1,211; META 1,088; GOOGL 1,015; DJT 895; SPY 882; AMC 872; MSFT 731; GLD 647; SGOV 627; COIN 599; MSTR 564; AMZN 500; PLTR 454 … TSM. Weekly launches: 380 (wk 07-13) → 13,543 (08-31), 15,243 (09-07), 12,696 (09-14). 56,242 `…1e18` tokens since 2026-07-12 plus 2,346 early non-suffixed.

## Creator reward model
Creators are FeesManager beneficiaries on the initializer: **95% creator / 5% Doppler of the Uniswap LP fee only (0.1–0.2%)**, not the 1.12% hook fee. **Paid in both pool tokens** (numeraire + the launched token), claimed via `collectFees(bytes32)` (selector 0x817db73b). Worked example TAIWAN: hook sent LONG's wallet **535.67 TSM + 12.81M TAIWAN**; the creator's claim was **6.75 TSM + 5,886,504 TAIWAN** (≈1.3% of LONG's numeraire take). Cumulative Release events (Jul 12→Sep 23): 31,295 releases on 14,589 pools to 6,215 creators; numeraire totals 2,229,321 $AI, 45,320 AMC, 20,740 USDG, 2,812 NVDA, **only 6.46 ETH** across 910 ETH-pool releases. Because half of every claim is the launched token, observed creator behaviour is to route it through fresh wallets and sell (MEME, TAIWAN).

## Platform revenue and treasury
Treasury EOA 0x92d435c9… (nonce 1,172) converts fee inventory to USDG via 0x AllowanceHolder 0x0000000000001ff3684f28c67538d4d072c22734 and RobinHoodSettler 0x6aa80dbbed9ae5ab45fbf61f9644fada3b29326e. **Cumulative USDG realised: 13,231,224 USDG** since 2026-07-14 (94,027 txns), outflows only 371,954 USDG. Milestones: 08-31 $2.70M → **09-04 $7.51M** (single day $2.74M) → 09-14 $11.5M → 09-23 $13.23M. Holdings now: 12,859,257 USDG, 4.01 ETH, plus unsold fee inventory (3,124 AI, 207.7 NVDA, 633 SPCX, 3,084 GME, 8,843 AMC, 1,133 DJT, 957 NVDAx3L…). The hook's "buyback" legs buy tokens **for LONG's EOA, which sells them**; nothing is bought back for holders. Third-party: ">$1B cumulative tokenized-stock volume" (UNVERIFIED).

## Promotions / incentives
Only X-quoted: "Community Mode burns/locks", "AI pairing mode", "auto burns" for $AI, LongX Expansion, 24h ticker reservation. **No referral, points or airdrop found**; no referrer field in create calldata.

## Differentiators
Stock-token-paired launches (with Bankr, the pioneers); instant permanent v4 liquidity; 80%→1.12%/10 s launch fee; `…1e18` vanity fingerprint; ticker reservation; $AI as in-house quote; leveraged (NVDAx3L) and pre-IPO (ANTHROPICx1L, OPENAIx1L) wrappers as quotes; launching straight from Robinhood-app 7702 wallets.

## Abuse patterns / red flags
(a) Platform captures ~100% of the hook fee; creators get a sliver, half in-token → creator dumping is structural (MEME, TAIWAN). (b) Launch spam: 13–15K/week at peak, 9,748 paired against $AI, most with no market. (c) "Farmmi" episode: a meme paired against a counterfeit stock token moved a real Nasdaq microcap 350% (AirdropAlert, UNVERIFIED). (d) Ticker squats ("LONG", "AI" namesakes). (e) Blockscout symbol confusion. No rug vector at contract level: LP cannot be withdrawn.

## Project index (…1e18 tokens in GeckoTerminal top-of-book, 141 tokens / 168 pools; 2026-09-23)
**Top by 24h volume:** AI $18.37M (FDV $265M, liq $33.3M), MONITOR/PLTR $8.59M ($7.8M FDV), MEME $7.58M ($40.1M), MOO/MU $3.20M ($16.4M), INU/AAPL $2.99M ($9.0M), BONER/HIMS $2.22M ($53.6M), CPU/INTC $903K, GIGABYTE/AMD, JIZZCOIN/META, ASTEROID/SPCX, AGRIPPA/META, SCHIFFY/GLD ($9.0M), SI/NVDAx3L, OPEN/AI, PUR/AMD, STRATEGY/MSTR ($3.7M), SPACEHOOD/SPCX, SAYLORMOON/MSTR, SIT/AI, BOXY/AMZN, ICOIN/AAPL, URANUS/SPCX, QUBIT/GOOGL, JERRY, GASOLINU/USO.
**Top by liquidity:** AI $33.3M, MEME $5.44M, BONER $4.18M, MOO $3.61M, ANTHROPIG/ANTHROPICx1L $1.36M, INU $1.29M, SPACEHOOD $1.21M, LONGCAT/NVDAx3L $1.15M, CATGPT/OPENAIx1L $1.11M, MONITOR $1.02M, ASTEROID $1.01M, SCHIFFY $924K, JEV $838K, ICOIN $716K, SIT $679K, SAYLORMOON $673K, GOYBEAM/PLTR $638K, STRATEGY $587K, AGI $542K, SI $497K, OPEN $496K, BOXY $452K, CPU $406K, CACHE/SNDK $371K, GASOLINU $370K.
**Stock-paired outcomes:** AI/NVDA (flagship, $26.6M pool); BONER/HIMS ($70M mcap within 3 days, now $53.6M); MONITOR/PLTR (+641%/24h on launch week); INU/AAPL, MOO/MU, SCHIFFY/GLD, SAYLORMOON & STRATEGY/MSTR mid-size; TAIWAN/TSM −92% from ATH, creator exited; META-paired launches most numerous among live pools but mostly sub-$200K day-old memes.
