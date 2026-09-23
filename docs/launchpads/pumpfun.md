# pump.fun — platform report (read 2026-09-23)

Chain: **Solana**. Launched 19 Jan 2024. Entity: Baton Corporation Ltd (UK Co. 14743013, inc. 20 Mar 2023; directors Noah Tweedale CEO, Alon Cohen COO @a1lon9, Dylan Kerler CTO). Terms governed by BVI law. UK users geo-blocked since 6 Dec 2024 after an FCA warning. Active RICO litigation: *Aguilar v. Baton Corp.*, S.D.N.Y. 1:25-cv-00880; on 31 Aug 2026 Judge McMahon let RICO claims proceed against Baton, Cohen, Kerler, Tweedale; securities claims and Solana/Jito defendants dismissed.

## Programs and fee wallets (RPC-confirmed 2026-09-23)
| Role | Address |
|---|---|
| Bonding curve program | 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P |
| PumpSwap AMM | pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA |
| Pump Fees program (creator fee sharing) | pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ |
| Mayhem program | MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e |
| Mint authority PDA | TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM |
| Global config PDA | 4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf |
| Global authority / AMM admin | FFWtrEQ4B4PKQoVuHYzZq8FabGkVatYzDpEVHsK5rrhF |
24 published fee recipients (8 normal, 8 Mayhem, 8 buyback) in pump-fun/pump-public-docs FEE_RECIPIENTS.md. Normal set: 62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV, 7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ, 7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX, 9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz, AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY, CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM, FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz, G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP (+ JCRGumoE9Qi5BBgULTgdgTLjSgkCMSbF62ZZfGs84JeU on PumpSwap). Buyback set (28 Apr 2026): 5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD, 9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7, GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL, 3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR, 5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6, EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL, 5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD, A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW. Mayhem agent wallet BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s.

## Native token PUMP
Mint pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn (Token-2022, 6 dp, mint/freeze authority null). ICO 12 Jul 2025 at $0.004, sold out in ~12 min, ~$500M public + $600M private at $4B FDV; US excluded. Allocation of 1T: 15% public, 18% private, 24% ecosystem/community, 20% team, 13% existing investors, 2.6% liquidity. Price $0.00421, mcap $1.96B (CoinGecko circ. 466.9B; pump.fun says 399.5B), FDV $3.50B, 24h vol $177.5M all venues; main pool PumpSwap PUMP/USDC $22.4M liquidity. ATH $0.00882 (2025-09-14), ATL $0.001155 (2026-06-25).
**Buyback/burn:** $461.07M / 167.31B PUMP (16.73% of supply) bought and burnt to date (fees.pump.fun). ~100% of revenue to buybacks 14 Jul 2025 → 28 Apr 2026; on 28/29 Apr 2026 burned everything bought so far (~36% of circulating, ~$370M) and switched to **50% of net revenue programmatically locked to buy-and-burn for one year**. Latest daily burn 22 Sep 2026: 191.0M PUMP / $874K = 50.05% of that day's revenue. DefiLlama holders-revenue $363.7M all time, $24.3M last 30d. Disclaimer: PUMP carries no right to revenues.
**CEX listings (of the requested set):** Binance, Bybit, Gate, Kraken, Upbit, Bitget, Binance US, Crypto.com. Not OKX, not MEXC, not Robinhood (per CoinGecko tickers).

## Launch mechanics
Constant-product curve: initial virtual 1.073B tokens / 30 SOL, 793.1M real tokens sold, completes at 85.005 SOL real (≈410.9 SOL mcap, ≈$47.9K at $116.68 SOL). At graduation 206.9M tokens (20.69%) + ~85 SOL migrate to canonical PumpSwap pool; **LP tokens are burnt** (pool owned by protocol). Graduation fee 0.015 SOL; creation free. Token-2022 mints. Fees (docs 20 May 2026): curve 1.25% (creator 0.30 / protocol 0.95); PumpSwap dynamic by mcap: 0–420 SOL creator 0.30/protocol 0.93/LP 0.02; 420–1,470 SOL **creator 0.95** / protocol 0.05 / LP 0.20; creator steps down to 0.05% at ≥98,240 SOL. Non-canonical pools 0.30% total. USDC and custom quote pairs since May 2026. Modes: Mayhem (AI agent mints extra 1B and trades for 24h then burns), Holder Rewards (12 Sep 2026, creator fee paid to holders hourly, replaces deprecated Cashback), Tokenized Agent (hourly buy-and-burn), Charity, Community Takeover of creator-fee rights. **No protocol-level anti-snipe**; same-block create+buy bundling is openly tooled.

## Creator reward model
Paid in the **quote asset (SOL/USDC), never in the launched token** → no structural creator sell pressure on the token itself. Live since 12 May 2025; dynamic mcap schedule since 1 Sep 2025 ("Project Ascend"). Accrues in creator_vault PDAs; claimed via collect_creator_fee_v2 / collect_coin_creator_fee; multi-recipient sharing via Pump Fees program. Historic total paid to creators (DefiLlama supply-side revenue): **$104.25M all time**, $95.5M last 12 months, $12.8M last 30d.

## Platform revenue
DefiLlama fees all-time **$1.235B**, revenue $1.131B; 2025 gross ~$971M; peak month Jan 2025 $149.8M; Sep 2026 to date $30.2M; 90-day annualized $493M (fees.pump.fun). Monthly 2026: Jan 41.9M, Feb 33.7M, Mar 32.7M, Apr 24.7M, May 30.9M, Jun 23.6M, Jul 28.4M, Aug 48.0M.

## Promotions / incentives (current)
50% revenue buy-and-burn to 28 Apr 2027; Holder Rewards coins; referral fees (rates unpublished); Build in Public Hackathon / Pump Fund ($3M, 12×$250K at $10M valuation, teams keep ≥10% supply); Go.fun bounties; livestreaming; Mayhem beta; Tokenized Agent; charity routing.

## Differentiators
Fully integrated curve→AMM→fee program→Terminal (Padre acquisition, multi-chain)→mobile; zero creation fee, no presale, no team allocation; highest creator share post-grad (0.95%); token-level modes; largest revenue base.

## Abuse patterns (published)
Solidus Labs May 2025: 98.6% of pump.fun tokens showed rug/pump-and-dump characteristics; of >7M launches only ~97K kept ≥$1K liquidity. <2% ever graduate. Deployer-funded same-block sniping (Pine Analytics via Solidus). **GeckoTerminal's PumpSwap volume ranking is 100% wash pools** ($50–100M "volume" on <$1 liquidity, e.g. JEANPHIL/SOL C3QYke…). pump.fun's own market-cap API is inflated by custom-pair coins quoted in illiquid pump tokens (day-old "$2.17B" coins). 

## Top projects (DexScreener-derived, SOL/USDC-quoted pools only, 2026-09-23)
Top by 24h volume: JEANPHIL $8.4M (mcap $6.8M), CATE $4.9M ($91.9M), fomopay $4.3M, Fartcoin $4.1M ($196.5M), OTC $3.8M, PAID $2.3M, ANSEM $2.1M ($168.6M), TROLL $1.7M ($51.5M), neet $1.6M ($36.7M), ARCHIBROWN, YES, biketyson, FWOG, GOAT, Buttcoin, MOODENG, BOBO, fone, ELON, aura, ALCH, MANIFEST, Bert, Tilcayo, pippin.
Top by liquidity: arc $11.6M (mcap $80.5M), Fartcoin $9.2M, jellyjelly $5.4M, pippin $4.4M, Pnut $3.8M, CATE $3.6M, TROLL $3.6M, ALCH $3.5M, ZEREBRO $3.4M, Ban $3.1M, MOODENG $3.0M, ANSEM $2.6M, GRIFFAIN $2.1M, neet $2.0M, FWOG, GOAT, VINE, CHILLGUY, swarms, ACT, aura, AVA, UFD, Bert, WOULD.
Top by mcap (ex-PUMP): Fartcoin $196.5M, ANSEM $168.6M, CATE $91.9M, arc $80.5M, Ban $65.5M, jellyjelly $57.3M, Pnut $56.7M, TROLL $51.5M, ALCH $49.3M, MOODENG $46.7M, neet $36.7M, ZEREBRO $34.5M, WOULD $32.5M, GOAT $20.5M, pippin $19.6M, GRIFFAIN $16.0M, CIGR, Bert, CHILLGUY, SAI, MANIFEST, NTDA, Buttcoin, WOTF, CODEC …
**Graduates on the requested CEXs (CoinGecko tickers):** FARTCOIN (Kraken, Gate, Bitget, MEXC, Crypto.com, Binance US), PNUT (Binance, OKX, Bybit, MEXC, Gate, Bitget, Kraken, Crypto.com, Binance US), MOODENG (Upbit, OKX, Gate, Kraken, Bitget, MEXC, Crypto.com), ALCH (Bybit, Gate, MEXC, Kraken), GOAT (OKX, Bybit, Gate, MEXC, Bitget, Kraken, Crypto.com), PIPPIN (Gate, MEXC), CHILLGUY (Bybit, Gate, MEXC, Bitget, Crypto.com), ACT (Binance, OKX, MEXC, Gate, Bitget, Kraken, Crypto.com), AVAAI (Gate, MEXC, Kraken), SWARMS (MEXC, Gate, Kraken), UFD (Kraken). No Robinhood tickers for any.

Tokenized-stock pairing: not a feature (custom quote pairs exist but are pump-token-quoted, not equities).
