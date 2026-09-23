# Bankr (bankr.bot) — platform report (read 2026-09-23)

Chains: wallet on 11 networks; **token launching live on Robinhood Chain (default), Base, Arbitrum One**. An AI-agent runtime with a Privy embedded wallet per social account; launches via X mention (`@bankrbot deploy…`, Bankr Club required), Terminal, Telegram, Farcaster, CLI, REST, webhooks, third-party agent skills. Rate limits: 3 launch attempts/wallet/24h, ~10 successful/IP/24h. Founder **"Deployer" @0xDeployer** (pseudonymous; created $TN100x/HAM and Hamchain; references an undisclosed co-founder). Legal entity and funding UNVERIFIED (fair launch, no ICO/VC). X @bankrbot, Farcaster /bankr, github.com/BankrBot.

## Launcher eras
| Era | Dates | Venue |
|---|---|---|
| Clanker | 2024-12-03 → 2026-02-10 | Clanker v0/v3/v4 on Base from Bankr deployer EOAs 0x002F07B0D63e8ac14F8ef6B73Ccd8caF1FeF074c, 0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9; 1% pool fee, Clanker 20%, remainder 60% creator / 40% Bankr; tokens end `…b07` |
| **Doppler** (current) | 2026-02-10 → now | Doppler Airlock + Uniswap v4 multicurve + fee hook; **tokens end `…ba3`** |
| Bankr Launch v3 | rolling out (Arc first) | own contracts, UNVERIFIED |

**Doppler stack, Base:** Airlock 0x660eAaEdEBc968f8f3694354FA8EC0b4c5Ba8D12, DopplerERC20V1Factory 0x89C261C05B5F9b6BcBA07C199b8DeE7cFaD45292, DopplerHookInitializer 0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544, fee hook 0x9982538f41f2ae29ddb9d3d9307010052984fdbb, integrator 0xF60633D02690e2A15A54AB919925F3d038Df163e; launches are ERC-4337 user-ops via EntryPoint 0x0000000071727De22E5E9d8BAf0edAc6f37da032 (gas sponsored).
**Doppler stack, Robinhood Chain:** **Airlock 0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862**, token factory 0x1B37D3a72082029c44B35B604Ea473617580b69a, **DopplerHookInitializer 0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544**, fee hook 0x9982538f… (deterministic, same as Base), governance factory 0xdb036746D65DD52126b1915f1AdF555e6C5237Cf, migrator 0xba2F330EDb16cD8056f5988d8CE19BbC63475A0e, integrator 0xF60633D0…; PoolManager 0x8366a39c…, UniversalRouter 0x8876789976decbfcbbbe364623c63652db8c0904. RH launches are direct EOA txs.
**Key attribution fact:** GeckoTerminal's `bankr-robinhood` bucket also contains ~140 tokens with suffix **`…1e18`** from factory **0x22e99278308b393ea1260859b181ad7e78f5eeed** (MONITOR, AI, BONER…) which Bankr's API rejects: a **different Doppler integrator** using the same Airlock/Initializer. (TAIWAN 0xaa0b…1e18, MEME 0x385f…1e18, AI 0x2E8c…1e18 belong to that family, not to Bankr.)

**Fee/treasury wallets:** protocol-fee recipient 0x5f8da8f88ec81e27f2e22fcb9ca5d926c595e508 (Safe on Base; 0.475% of volume); BNKR buyback/POL 0x042455f9990098e11592be1fbd72e6dc68419b13 (0.2375%); Doppler protocol 0x21e2ce70511e4fe542a97708e89520471daa7a66 (~0.0875%).

## Native token BNKR
Base 0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b (100B fixed, created 2024-12-03 via Clanker v0 from the Farcaster feed); Robinhood Chain OFT 0x178E54df3D091EE4D0B2534742eF9e3692b76526 (~1.056B bridged). **Impostor on RH: 0x2Eb42E1a2341bC3B2643BacCC83faD5c3D2Af760 "BankrCoin"** with spoofed DexScreener liquidity ($27.6M shown, $5.6 real). Price $0.000398, mcap ≈$39.8M, 24h vol $7.3M, 186,496 Base holders; ATH $0.00120 (2026-02-10). Utility: Bankr Club payment ($20/mo), launch quote token, buyback target (0.2375% of all post-2026-07-29 launch volume; ~$1M bought back by then), former sBNKR staking (deprecated 2026-04-08). No burn. **CEX (requested set): Kraken, Gate, MEXC.** Not Bitget/Bybit/OKX/Binance/Binance US/Upbit/Crypto.com; no Robinhood app listing.

## Launch mechanics (Doppler era)
**No bonding curve, no graduation**: a Uniswap v4 pool is created immediately with a single large multicurve position holding 99% of supply spanning ≈$27K→$1.66B mcap (Degen mode starts at $2,500). 85% of 100B seeded to the pool, **15% preminted to the fee recipient with 1-year vest / 30-day cliff** (optional; partner launches 100% to pool). LP protocol-held via Airlock (NoOp migrator); the 0.285% LP leg compounds as permanently locked liquidity. **All-in swap fee 1.75%**: creator 0.665%, LP 0.285%, Bankr 0.475%, BNKR buyback 0.2375%, Doppler ~0.0875%. **Anti-snipe: fee starts at 80% and decays to terminal over ~10 s (kept by Bankr) + 2%-of-supply per-wallet cap for 5 minutes.** Quotes: WETH default; BNKR, ba3Pump, cbHYPE, cbZEC, TAO (Base); BNKR, musebook (RH); **~197 tokenized stocks on RH** (Robinhood Stock Tokens) and Coinbase B20 equities on Base. Glidepath: AI-paced managed sell program for creators (48h notice, liquidity-capped slices).

## Creator reward model
0.665% of volume, **by default a mix of the launched token and the quote token** (quote-only optional) → Doppler-based launches carry structural creator sell pressure in the token unless quoteOnlyFees is set. Claim in chat/web/API/CLI; beneficiary transferable; 15% vest to fee recipient. **Cumulative creator fees $23.45M** (Base $21.02M, RH $2.43M) on $5.45B volume. Top earners: BNKR $1.26M creator, DRB, MOLT, GME (RH) $727K, CLAWD, KellyClaude, musebook $452K.

## Platform revenue (dashboard)
All-time **$17.19M Bankr fees**, $23.45M creator fees, **$5.45B volume** (Clanker $3.36B / Doppler $2.09B), **1,706,016 tokens deployed** (Base 1,609,719; RH 96,297). Monthly volume: 2026-01 $784M, **02 $1,635M**, 03 $316M, 04 $130M, **05 $878M**, 06 $235M, 07 $262M (RH $192M), 08 $181M, 09 (to 23rd) $247M (RH $152.5M). Tokens deployed peaked at **756,669 in Mar 2026** (farming) vs <35K/month after. **Robinhood Chain is now the larger leg** (24h RH $20.0M vs Base $8.3M). DefiLlama "Bankr Interface" revenue $14.34M since Aug 2025.

## Promotions / incentives
Bankr Club ($20/mo, $198/yr); Max Mode pay-per-token LLM credits; weekly developer rebate on launch-pool volume (terms UNVERIFIED); leaderboard rewards (Season 2); Merkl LP incentives; BNKR Buyback Vault on RH (2026-07-21, mechanics UNVERIFIED); Bankr Earn.

## Differentiators
Social-native launch and trading with an embedded wallet per social account including for other AIs; self-funding agent loop (fees → LLM credits); skills for Claude Code/OpenClaw/Cursor; Partner API; tokenized-stock-quoted launches; auto-compounding locked LP leg; 15% creator vest; 5-minute 2% wallet cap; public chain-split fee dashboard.

## Incidents / abuse
Grok token spree (Mar 2025; DRB >$40M mcap, Grok's wallet >$500K fees). **Prompt-injection drain (May 2026)**: attacker sent a Bankr Club NFT to Grok's wallet then used a Morse-coded instruction to move ~3B DRB (~$155–180K), later returned. X/Telegram suspension 2025-10-10. Launch farming (756K deploys in one month). Impostor BNKR on RH.

## Project index (GeckoTerminal `bankr` / `bankr-robinhood`, Bankr-API-confirmed, 2026-09-23)
**Base top by volume:** Botanica $257K, JO $212K, Bots $201K ($1.45M mcap), 1F916 $198K ($1.55M), LFI $80K ($4.35M, $826K liq), BOT, Ratspeak $71K ($1.71M), LAYA, FreeCode, CCP, AIRC, 1clawAI, Duckling, SETZ, ZUCK, RRB, KOL, ZDR, ATBASH, wtr, CHIP, SMOLTING, WOON ($1.44M), HOME ($3.71M). **Base top by liquidity:** LFI $826K, Ratspeak $698K, 1F916 $627K, HOME $513K, WOON $477K, Bots $409K, BLOCKTRONICS $311K, ATBASH $288K, FreeCode $277K, SUPERGEMMA $275K, 1clawAI $213K… Clanker-era still trading: BNKR $40.6M, DRB 0x3ec2156d4c0a9cbdab4a016633b7bcf6a8d68ea2 $18.3M, MOLT, CLAWD, KellyClaude, Conway, AntiHunter, FELIX.
**Robinhood Chain (57 confirmed of 199 sampled):** **Agrippa** 0x83a49b808f8d5e02cb2931cd2352988f498e5ba3 (quote musebook) $16.7M vol, $2.13M liq; **musebook** 0x91a2dae9699f0b82540b5886b0d8759c22820ba3 (quote **META** stock) $30.1M mcap, $8.20M liq, $12.6M vol; Nautilo $1.99M mcap; Euler (quote musebook); musemrkt, musegram (quote META); JERRY66; **GME** 0xc2362aff2a2a4cc1f48cf3dab2c4e2605eb94ba3 (quote tokenized GME, $1.78M mcap, $727K lifetime fees). Full RH list needs an Airlock Create-log walk (not done).

## Tokenized-stock pairing
**Supported and heavily used on RH: 16,327 stock-paired launches, $230.1M cumulative volume, $15.7M/24h; the stock leg now exceeds the WETH leg daily.** 197 quote entries incl. NVDA 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, TSLA 0x322F0929c4625eD5bAd873c95208D54E1c003b2d, MU, SNDK, AMD…; stale-feed stocks refused when markets are closed; trading the stock leg is geo-gated (US/UK). Base analogue: Coinbase B20 equities (NVDAc, METAc, SPCXc, GOOGLc, MSTRc, MSFTc) in 24 of 200 sampled pools.
