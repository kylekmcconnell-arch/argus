# StonkFun (stonkfun.xyz) — platform report (read 2026-09-23)

Chain: **Solana**. "Launch coins paired with anything": tokens are quoted against an arbitrary quote mint (xStocks, PreStocks, Tessera, Sunrise/Backpack stocks, currencies, leverage tokens, collectibles, SOL, or any Jupiter-verified custom token including STONK). Non-custodial, keyless public API (300 req/min). Team: **undisclosed** (no names, no GitHub, no whitepaper; only X @LaunchOnSF and t.me/StonkFunXyz). ToS counterparty is an unnamed "corporation"; governing law "will be stated here once designated"; US, Canada and UK residents excluded; 20 countries geo-blocked (HTTP 451).

## Venues and contracts
- Current default: **Raydium LaunchLab** (program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj), ConstantCurve, migrates to Raydium CPMM at graduation. First LaunchLab launch 2026-09-05.
- Retired v3: one-sided Raydium CLMM at $5,000 start mcap, liquidity locked via Burn & Earn, creator fees via Fee Key NFT (1% tier split 0.5/0.5, or 2% tier 1.5 creator/0.5 platform). Used 2026-07-23 → ~09-15.
- Retired pump.fun-based mode with platform "backing".
- Platform config (standard) 4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7; (reward) 6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt. Decoded: fee_rate 1%, platform_scale 100% / creator 0 / burn 0 → **100% of migrated CPMM LP goes to the platform wallet** (lock status UNVERIFIED).
- Platform fee/NFT wallet **5CEbueQnq1Ym2uSSx2xXds3jQAqT1BDnkA59RZobSPAG** (430.7 SOL; signs STONK burns). Transfer-fee withheld authority 5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD. PLATFORM_TREASURY 458aGtmE9UzRhA94hz743NyRv8p7zxNbjcgxV1m8Ukre. Retired treasury = STONK creator wallet H6qoWz4hxRb9a65nMXv1ERZWHmbG3foFZoK6CEm7acRQ (Jupiter audit: 8,483 mints, 11 migrations). One LaunchLab GlobalConfig per quote mint (529/532 ready), e.g. SOL 6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX, SPYX B7ctMMdGvy46Am56myTtzfkNzt9kWZVTNGM2BWrJ9adg.
- Off-chain: Helius webhooks + Jito bundles, Jupiter data, Vercel, crons (flywheel, claim-and-burn, rewards, transfer-fee-harvest, creator-forwards).

## Native token STONK
Mint 6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx (classic SPL, 9 dp, authorities null). Created 2026-07-23 19:07 UTC paired with **SPYX** on Raydium CLMM 7a8xxAJBELDo6P9dikSYctdw6ce8F4mWr3ahcAD8Ao49, start mcap $5,081, "graduated" 16 minutes later; creator = platform treasury. Price ≈$0.327, mcap ≈$270M (= FDV), 24h vol $51–52M all venues; on-chain liquidity ≈$9.8–10.3M (SPYX CLMM $5.24M, Meteora SOL DLMM $2.91M, USDC CLMM $1.66M). 7d +90%, 30d +2,890%; ATH $0.4013 (2026-09-21), ATL $0.00175 (2026-08-05). 86,564 holders, top holder 18.0%. Supply 823.57M of 1B → **176.4M (17.6%) burned** in 17,498 txs, $14.34M at burn. Utility: buyback target; quote asset for 7,273 launches (317 graduated, 4.4%, best of any quote); no rights to revenue. **CEX (requested set): Gate (~$3.2M/24h), Crypto.com (~$5.6K).** None of Bitget/MEXC/Bybit/OKX/Binance/Binance US/Kraken/Upbit/Robinhood.

## Launch mechanics (LaunchLab path)
1B fixed supply, 6 dp, Token-2022; 793.1M sold on curve from ≈$3,260 start mcap; graduation raise sized to equal 85 SOL (≈$47,900 mcap; e.g. 12.753 SPYX); auto-migrate to CPMM, migrate fee 0. Curve fee 1% to platform (UI shows 1.25%); standard mode forwards ~0.5% to creator automatically **in the quote token**. **Reward mode** (75% of all launches): Token-2022 immutable transfer tax of 1% or 3% paid pro-rata to holders in the quote token on every transfer on any venue; creator earns nothing. **Dev buy up to 50% of supply, Jito-bundled with pool creation as the literal first trade: this is the only anti-snipe mechanism; no holder caps, cooldowns or sniper tax.** Airdrop mode: hold out up to 50% and drop on top-N holders of the quote token (set hashed pre-mint). Stock pairing: the equity is simply the quote mint (xStocks Xs… 8dp, Sunrise 6dp, PreStocks Pre… 9dp, Tessera 9dp, all Token-2022); USD price of the memecoin = quote-denominated price × the stock's price; creator fees and holder rewards paid **in the stock token**. Available quotes: 24 xStocks, 7 PreStocks, 2 Tessera, 72 Sunrise/Backpack, 5 currencies, 2 leverage, 3 Solana, 415 custom.

## Creator reward model
Standard: ~0.5% of every trade, paid in the quote asset (both tokens of the pair on v3 CLMM), auto-forwarded on LaunchLab. Reward: creator has no fee position; 1–3% tax to holders. **No creator fees paid in the launched token** → no structural creator sell pressure, but the reward-mode tax rewards churn. Cumulative "distributed to holders, valued now" **$77.5M** (31.2M payments, 28,008 distributing tokens); marked to current quote prices, so STONK-denominated rewards paid at far lower prices are overstated. Top: ZCAT/ZEC $11.42M, KNOTS/STONK $3.42M, STONKS/STONK $2.43M, PURR/HYPE $2.14M.

## Platform revenue (ledger from 2026-07-25)
Total **$22.76M**; **$13.56M (59.6%) spent buying back STONK**, $9.19M retained. Weekly: 08-03 $285K; 08-10 $402K; 08-17 $221K; 08-24 $282K; 08-31 $2.06M; 09-07 **$8.91M**; 09-14 $6.42M; 09-21 (3 days) $4.16M. Inflection coincides with the LaunchLab venue (09-05). Total volume $2.67B, $766M on RWA (stock) pairs, 55,677 pools. Ecosystem Flywheel: 5% of pool fees buys and burns the top-10 platform tokens ($721.6K spent, roster led by ZCAT 50.3%).

## Promotions / incentives
No referral, points, leaderboard or competitions. Structural only: ~60% STONK buyback-and-burn, Ecosystem Flywheel, holder transfer-tax rewards, quote-holder airdrops at launch. Live-stream feature off.

## Differentiators
Arbitrary Token-2022 equity quotes; fees and rewards paid in the stock; transparent revenue/burn/rewards ledgers; keyless API and documented build-it-yourself path with permissionless pool adoption by platform id; immutable transfer-tax reward coins; very high buyback ratio plus a second-order flywheel.

## Abuse patterns and risks (from the platform's own data)
- **Launch spam:** 116,210 launches, **9,300 in the last 24h**, 53,769 in 7 days; 3,520 (3.0%) graduated; 75% reward mode; one wallet launched 5 of the latest 100.
- **Symbol impersonation:** "SOL" ×29, "OAI" ×24, "STONK" ×8 among ~1,300 top tokens; two "GROK"s in the top-25 by volume; Cyrillic homoglyph tickers.
- **Wash / tax farming:** tokens with 24h volume 5–25× mcap; the transfer tax pays holders per trade, rewarding churn.
- **Airdrop exit liquidity:** the site itself warns airdropped supply can only be sold into buyer-paid liquidity.
- **Centralisation:** platform holds 100% of migrated LP, the tax withhold authority, and runs the crons; all mechanisms discretionary per ToS; law undesignated; anonymous team.
- Dev-buy-first design means insiders can hold up to 50% at the first trade.

## Top projects (StonkFun API, 2026-09-23)
Top 25 by 24h volume: STONK/SPYX ($269M mcap), GROK/SPCXX $2.0M vol ($3.1M mcap), SI/NVDAX $1.1M ($4.1M), ZCAT/ZEC $981K ($73.7M), GP/GLDX $979K ($16.1M), RAYCAT/RAY, KNOTS/STONK ($15.0M), APECAT/APE, BOP/Bonk, CRACKER/GP ($6.0M), PURR/HYPE ($8.2M), FEELSGOOD/PEPE ($4.6M), SOMETHING/SPX, BTC/WBTC ($3.3M), QUEEF/Fartcoin, NINJACAT/INJ, GROK/ROBOSTRATEGY ($3.3M), ALLINU/DKNG ($10.0M), NEARKAT/NEAR ($8.0M), STONK10/SOL, INU/UNI, CYPHERCAT/CYPH, GHOSTCAT/AAVE, suit/STONK, SOL/OPENAI.
Top by liquidity: STONK ~$9.8M, ZCAT $1.55M, KNOTS $1.08M, STONKS $697K, DEX $681K, PURR $548K, RAYCAT $515K, NEARKAT $417K, GP $411K, CRACKER $331K, ALLINU $330K, BTC $257K, FEELSGOOD $242K, SI $242K …
**Stock-paired vs SOL-paired:** stock-paired = 55,777 launches (48%), 3.0% graduate, top-100 mcap $342.9M (STONK is $269M of it), 14 tokens >$1M; SOL-paired = 10,180 launches, 1.2% graduate, top-100 mcap $4.3M, largest STONK10 $1.1M. Largest non-STONK stock-paired: GP/GLDX $16.1M, ALLINU/DKNG $10.0M, FEELSGOOD/PEPE $4.6M, SI/NVDAX $4.1M, DIVI/STRCX $3.4M. PreStocks/Tessera (ANTHROPIC/OPENAI/KALSHI quotes) have never produced a token above $1.3M.
