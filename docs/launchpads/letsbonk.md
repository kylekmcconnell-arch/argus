# letsbonk.fun / BONK.fun — platform report (read 2026-09-23)

Chain: **Solana**. Launched 25 Apr 2025 by BONK core contributors with Raydium; a thin frontend over Raydium **LaunchLab** (program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj; graduated pools on Raydium CPMM CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C). X @bonk_fun. Named people: Tom ("Solport Tom", founder/COO), Nom (Mitchell Rudy, BONK core contributor, Bonk Inc. board). Entities: Graphite Protocol (JV/tech partner, receives GP Reserve/Hiring/Dev lines); **Bonk, Inc. (Nasdaq: BNKK)** acquired a **51% revenue interest** (~$30M implied) on 2025-12-03. Operating legal entity UNVERIFIED.

## On-chain platform configs (Raydium API)
| PlatformConfig PDA | Mode | Platform fee | Curve creator fee | LP split | Notes |
|---|---|---|---|---|---|
| FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1 | Memes (primary) | 1.25% | 0 | ≈100% burned | claim wallet YvWXoyyRpD5fPVZHZV6SY8NS1nuTFmyewxudD3mwuE3; post-grad CPMM config idx 15 (0.50% LP + 0.75% CPMM creator fee) |
| BuM6KDpWiTcxvrpXywWFiw45R2RNH8WURdvqoTDV1BW4 | Memes (secondary) | 1.25% | 0 | ≈100% burned | same |
| 82NMHVCKwehXgbXMyzL41mvv3sdkypaMCtTxvJ4CtTzm | Bonkers/Tech | 1.00% | 0.05% | ≈100% burned | CPMM creator wallet F8b4Rd7dNzCKW7vJL1GjVNCnTNKUv3un5mmUYUUDcKuP |
| 8pCtbn9iatQ8493mDQax4xfEUjhoVBpUWYVQoRU18333 | test-like (UNVERIFIED) | 1.00% | 0 | 100% platform-locked | |
Platform NFT/CPMM creator-of-record wallet (Memes): 5jFLVBsJ6uVdFd89pqfG9eytCLjtqjwcGwTuwYu5ZKQu. Revenue wallets (revenue.letsbonk.fun): Burn 6QyD4vG1GNdZWyFBtSUNxvLszm2kxqgH1DtYTE8WZgs1, SBR kF1wgCvviUHFZro6DP9UUnER2eP2J2c2DkQbrbiKsWL, Rewards 562XLd1SScHSyEKZDYomi3NtZk6pcv3DrV5ZXG9fFJuA, BNKK 3rqUcRh7nSaxgKgFb4jzwEfoCgyjoKxA8Dn2zxGDCTeF. DefiLlama-tracked: platform 56XVRVAsgWv6ADaxzoNnbL38LMoWKM5WiSAhrAWUbd2p, creator 9sHpTfmVpCfP2zexRNK6j38NBchMv1RWpdXPK5NEcZan. Raydium global config 6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX (0.25% protocol fee).

## Token
**No native token.** Uses BONK (DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263): $0.00000395, mcap $348.4M, 24h vol $171.9M. Fee-split history: launch Buy/Burn 35% + BONKsol 30% …; 2025-06-10 Buy/Burn 50%; 2025-08-11 Buy/Burn 40% + Bonk Inc 10%; 2025-09-10 Buy/Burn 35%; **2025-12-03 Buy/Burn removed → "Buy for BNKK" 51%** (BONK bought for the BNKK corporate treasury rather than burned). Current: BNKK 51%, BONKsol 10%, Community Marketing 10%, GP Reserve 7.67%, Hiring 7.67%, Dev 7.67%, Marketing 4%, BonkRewards 2%. ~300B BONK burned from fees by Aug 2025 (141,869 SOL of 283,736 SOL cumulative revenue then); official cumulative burn UNVERIFIED.

## Launch mechanics
1B supply, 6 dp, **classic SPL (not Token-2022)**; constant-product curve; 793.1M (older) / 732.5M (recent) sold on curve; graduation **85 SOL** (≈$8.8K) for SOL quotes (other quotes: USD1, BONK, QQQx, USELESS…); migrates to Raydium CPMM; **≈100% of LP burned** (dust Fee Key NFT to platform). Curve fee: Memes 0.25% Raydium + 1.25% platform = 1.5%; Bonkers 1.30% incl. 0.05% creator. Post-grad (Memes): 0.50% LP + 0.75% CPMM creator fee collected by the platform wallet and redistributed off-chain. Referral: per-trade shareFeeRate up to 1%. **No on-chain anti-snipe**; UI caps the creator's first buy; internal review with Raydium for manipulation.

## Creator reward model
Paid in the **quote token (SOL etc.), never the launched token**. Aug 2025 "Dual Creator Rewards" up to 0.10% of swap volume; **Jan 2026 "BONK Classic": 0% creator fee on Memes mode**, Bonkers mode keeps creator fees. Fees auto-sent to deployer unless the coin was community-taken-over. Cumulative paid: no official figure; DefiLlama supply-side $30.6M all time (not separable, contaminated after 2026-09-06).

## Platform revenue (official API, SOL) 
2025-05 29,006 · 06 13,765 · **07 186,286 ($33.4M)** · 08 48,424 · 09 16,398 · 10 5,207 · 11 4,096 · 12 18,331 · 2026-01 35,081 · 02 10,626 · 03 16,953 · 04 4,288 · 05 2,400 · 06 1,531 · 07 2,340 · 08 1,058 · 09 (to 23rd) **191 SOL**. Cumulative **395,981 SOL**. Today: 24h volume $762.8K, 24h fees $1.08K. The July 2025 flip: on 2025-07-06/07 letsbonk overtook pump.fun in daily launches (17,585 vs 9,783) and volume (~54% share, $535M/day), led 14 of 15 days, ~78% share at peak, ~$30M July revenue; pump.fun regained ~90% by August. **Platform is now near-dormant** (Sept 2026 revenue ≈ $16K).
**⚠ Data-quality finding:** DefiLlama's bonk.fun series jumped from ~$3–20K/day to ~$250K/day on **2026-09-06**, the day StonkFun went live on LaunchLab; inflows to the tracked wallet 56XVRV… are signed by StonkFun's platform wallet 5CEbueQn…. DefiLlama's "BONK.fun" figures since then are largely StonkFun. Whether they share operators/infra (e.g. via Graphite) is UNVERIFIED.

## Promotions / incentives
Bonk Points leaderboard; June 2025 hackathon ($200K with Raydium); trading competitions / Torque rewards; ecosystem buybacks (1% of revenue to top BONK-eco pairs, weekly top-11 buys from Jul 2025); Magic Eden $ME integration; referral field; Memes vs Bonkers vs Turbo modes.

## Differentiators / abuse
Built on Raydium's audited LaunchLab; ~100% LP burn; itemised public revenue dashboard with named wallets; multi-quote launches incl. xStocks (QQQx, NVDAx, AAPLx, AMZNx, SPYx, GLDx, SPCXx, DFDVx) though stock-paired volume is tiny (<$10K lifetime each); majority revenue interest held by a listed company. Abuse: mass launches at the July peak (17K+/day), openly sold bundle/sniper bots, copy-cat relaunches (multiple BEPE/Hosico), contentious creator-fee model reset in Jan 2026, buy/burn replaced by corporate treasury accumulation.

## Top projects
GeckoTerminal's `raydium-launchlab` dex aggregates every LaunchLab platform: of the top 160 pools by volume, **153 are StonkFun, zero are bonk.fun**. bonk.fun's most active current curves: CHAD/DFDVx $110K lifetime, BEPE/PEPE $68K, HONK/BONK $44K, Pemp/BONK $31K. **Graduates on the requested CEXs: only USELESS** (Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk, mcap $319M, on Gate, Kraken, MEXC, Upbit, Crypto.com, Binance US). Others: KORI $3.7M, SCAM $4.1M, HOSICO $2.1M, FREYA, AOL, 1COIN, ANI, IKUN, MEMECOIN (none on the target CEXs). Peak-era: USELESS ~$400M, Hosico ~$69M, IKUN ~$25M, MEMECOIN ~$60M.
