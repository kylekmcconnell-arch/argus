# Bags (bags.fm) — platform report (read 2026-09-23)
Note: bags.fun does not resolve; bags.app is parked. The product is **bags.fm**.

Chains: **Solana** (~99% of lifetime fees) and **Robinhood Chain** since 2026-07-11. "Launch a coin and earn royalties from every trade." Entity **Bags Holdings, Inc.** (App Store seller; Google Play address 13 W Main St, Felton, DE). Founder/CEO **Finn Bags @finnbags** (BusinessWire-confirmed); co-founder Hunter Isaacson (ngl.link; LinkedIn only). Funding undisclosed. X @BagsApp, t.me/bags_dev, github.com/bagsfm.

## Infrastructure
Solana: Meteora Dynamic Bonding Curve dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN → Meteora DAMM v2 cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG; Bags Fee Share V2 FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK (V1 FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi); token-creation authority / DBC leftover receiver BAGSB9TpGrZxQbEsrEznv5jXXdwyP6AXerN8aVRiAmcv; migration creator FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM. Platform treasury wallet on Solana not published (UNVERIFIED). Public API public-api-v2.bags.fm (v1 since 2025-08-02), SDK @bagsfm/bags-sdk, agent skill.
Robinhood Chain: BagsFactory (proxy) 0xe8Cc4431adF8b5A847C113EF0c6af9043219Cb37; BagsLens 0xC82Db941dAf90B754aecb5F7D14c683dc608d595; BagsV4Hook 0x2380aBf72C17aABAb76480244759AC7E2932EEcC; **BagsVault treasury 0x4861446aa7fFd9e67a83cBbAcb1A4B70540B83Aa**; modified UniversalRouter 0x8876789976dEcBfCbBbe364623C63652db8C0904; BagsFeeShareBeacon 0xdFf07d39C5332C602e06FA64f0A97C92fd8537e0.

## Native token
**None as of 2026-09-23.** No CoinGecko coin, DefiLlama gecko_id null, no tokenomics page; every "BAGS"-ticker pair is an unaffiliated micro-cap (largest ≈$6K FDV; the $5.6K token my snapshot matched is one of these). 2024-era community posts promised a $BAGS airdrop: never observed on chain. CEX listings: N/A.

## Launch mechanics (Solana, decoded from live DBC configs)
1B supply (9 dp), 830M sold on curve, 170M migrated; start ≈29 SOL FDV (~$3.4K), graduation at **85 SOL** raised (≈500 SOL FDV, ~$59K) → auto-migrate to DAMM v2. **100% of migrated LP held as a locked position by the platform (partner); creators get no LP.** Default fee **2% flat** both phases, collected in the quote token only; seven fee modes (0.25/1, 1/0.25, 10/10, 2% with 85% supply locked, 2% with 96% locked and decaying post-grad fee…). Post-migration 25–50% of fees compound back into liquidity. Split: pre-grad 50% platform / 50% claimers; post-grad 37.5/37.5/25 compounding; since Sept 2026 **25% of the claimers pool reserved for the "deployer"** (config payer). Partner share 25% of the platform pool. **Fee-share model:** up to **100 claimers identified by social identity** (X, Kick, GitHub, TikTok) or address, bps summing to 10,000; the API resolves a handle to a Privy wallet so **anyone can launch a coin and route royalties to a person who has not signed up**; admin can update claimers/BPS after launch. Bags app trading router charges an extra 1% on every trade. No creation fee via API.

## Creator reward model
The claimers' half of trading fees for life, **paid in SOL (quote asset), never the launched token**; non-SOL direct launches (xStocks/Ondo quotes) pay in the quote; on RH in ETH. Claim in-app after social login or via API/SDK; public claim feed. Optional "dividends" to top-100 holders every 24h (UNVERIFIED in docs). Cumulative: company says **>$40M creator payouts on >$5B volume** (Mar 2026); DefiLlama supply-side **$32.09M** all time.

## Platform revenue (DefiLlama, USD fees / protocol revenue)
All-time fees **$64.16M**, protocol revenue **$32.07M**, creator $32.09M; Solana $63.42M, RH $0.74M. Monthly fees: 2025-08 **$25.7M** (BTH/"hat" wave), 2025-09 $3.4M, … 2026-01 **$20.1M** (Gas Town/RALPH wave), 02 $3.1M, 03 $0.7M, 04 $1.5M, 05 $0.65M, 06 $0.53M, 07 $0.71M, 08 $1.77M, 09 (to 22nd) $0.24M. **Current run-rate tiny: 7d fees $50.7K, 24h $5.9K.** Peaks 2025-08-09 $2.81M/day and 2026-01-16 $4.80M/day.

## Promotions / incentives
Social-handle fee routing is the growth engine ("Get Bagged": Nyan Cat creator via $NYAN; Steve Yegge $GAS ≈$300K; Geoffrey Huntley $RALPH). Partner keys (25% of platform pool per launch through a partner). Deployer share (Sept 2026). Aug 2025: founder bought the original dogwifhat hat for 6.8 BTC (~$800K) with $BTH platform revenue and offered $250K to the first Bags coin holding $10M mcap for 24h. Mar 2026: Bags Hackathon up to $4M + Bags App Store. Free launches on RH.

## Differentiators / controversies
Fee-share to social identities with claim-later semantics; partner/deployer layers; fees in SOL; auto-compounding locked LP; multiple fee/supply-lock modes; non-SOL quote launches into DAMM v2 (xStocks/Ondo); RH "index tokens / dividend coins" whose creator fees auto-buy baskets of tokenized stocks and pay holders. **Controversies:** consent-free tokenization of real people ("psychological recruiting"); "claim and disappear" (Yegge claimed ~$300K then stepped back, $GAS −90%; Bags' launchpad share fell from ~42.6% on 16 Jan 2026 to single digits); founder "picking winners" with platform revenue; admin-updatable fee splits as a structural dispute vector; **vanity-suffix spoofing** (pump.fun tokens ending "BAGS", e.g. ICECOMP "$48M mcap" on $0.04 liquidity).

## Top projects (Solana, 476 Bags-launched tokens with pools; aggregate 24h volume ≈$277K, total liquidity ≈$2.18M, only 2 tokens >$1M mcap; none on the requested CEXs)
By volume: SALVOR $53K ($370K mcap), LORIA $38K ($1.05M), SLOP, ASTEROID $15K ($749K), MOUSE, SAN, MUSEBOT, FINNPUTER, VIBECODOOR, SHIBU, JEANTONIC, PRIMIS, ZHC, FROG, NYAN, ZKSNARK, EGG, AUC, CATPAY, TMTRD, SGL, BOT, LEON, TRK, TEAMSKEET. By liquidity: LORIA $91K, ASTEROID $77K, SALVOR $56K, RECAP $51K, COIN $50K, MILKERS $45K, CLKN $43K, 1B $41K, CALVIN $39K, SGL $36K, SAN $35K, LIFE, AGENTLAYER, HOLD, YZY, SEED, RAI, TRK, NRL, BTH $25K, NYAN $25K … GAS now $41K mcap, RALPH $44K, BTH ~$90K (was $5M Aug 2025).

## Tokenized-stock pairing
Supported: Solana direct launches quoted in xStocks/Ondo equities into DAMM v2 (no curve, flat 2% fee in the quote, liquidity locked); RH index/dividend coins whose fees buy 1–10 tokenized stocks for holders. RH pairing itself is against WETH.
