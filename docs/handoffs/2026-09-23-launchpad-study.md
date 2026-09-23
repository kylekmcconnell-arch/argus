# Launchpad study: what was done, what was not, and what it changes

Written 2026-09-23 after PRs #510 and #511 merged into Argus main. A record of decisions already taken; the study itself is in [`docs/launchpads/`](../launchpads/README.md).

## 1. What was done

**Eight platforms investigated end to end.** pump.fun, letsbonk, Bags and StonkFun on Solana; Pons, LONG, StonkBrokers and Bankr on Robinhood Chain (Bankr also on Base). For each: chain, launch mechanics decoded from contracts or on-chain calldata rather than marketing copy, every contract and treasury address with its role, native-token economics, the creator reward model and the asset it pays in, platform revenue over time, current promotions, team and entity to the extent it is public, differentiators, known abuse patterns, tokenized-stock pairing and how it performed, and top-project lists by 24-hour volume and by liquidity. Each report names its source per claim and marks anything unverified.

**A cross-chain synthesis** answering the study's questions directly: which platforms create creator-driven sell pressure, which allow stock pairing and whether it worked, which are the most manipulated, which carry the biggest red flags, where retail value is extracted, where the rugs are, which chain each lives on, and six early-runner signals worth encoding.

**Robinhood Chain mapped from the chain side, not the marketing side.** The top pools were pulled from GeckoTerminal, every non-infrastructure token was traced back to the factory that minted it, and every factory was resolved to a platform. That resolved a question the registry had carried since September 17: the "unknown factory 0x22e99278" behind TAIWAN and MEME is the verified LongLauncher, and both LONG and Bankr run on Whetstone's Doppler Airlock. Tokens can now be attributed at mint from their address suffix alone.

**A wash-volume ring found and indexed.** Thirty-one tokens deployed from disposable wallets in three days, reporting millions in daily volume on near-zero liquidity, sharing three bytecode templates, with two funding links traced. It is in the registry as nefarious, so any scan of those tokens now fails with a named reason.

**Holder and identity work.** Top-15 holder scans on PONS, AI, CASHCAT, STONKBROKER, PUMP and STONK; recurring wallets across tokens profiled; five Robinhood whale wallets run through FomoScan.

**Three prior claims corrected in the record**, all of the same type: something was asserted absent because a getter returned nothing. The "no maximum supply" on ACU, the "no creator allocation" on TAIWAN, and the "87.6% streamed to the deployer" on STONKBROKER were each wrong, and each is now fixed in the registry or the research notes with the correct reading.

**Shipped into Argus.** Registry corrections and the ring entry (#510). The full study under [`docs/launchpads/`](../launchpads/README.md) with the raw sweep data (#511). The venue fingerprint table and the fee-model rule in `src/threat/RESEARCH.md`.

## 2. What was not done

- **The full index the brief asked for.** Twenty-five projects by market cap, liquidity, and volume across 24-hour, 7-day and 30-day windows, per platform, is up to 1,800 tokens, and a 15-holder identity scan on each is tens of thousands of wallet lookups. This session built the landscape and swept the leaders; it did not scan 1,800 tokens. The 7-day and 30-day volume windows were not pulled at all.
- **Arkham identity checks.** Not run. The Arkham address endpoint returned HTTP 400 in an earlier session and the shape of the working call was never established.
- **FomoScan at scale.** Five wallet lookups were run, all misses. Wallet resolution costs 50,000 credits on a hit and the plan had 827,350 left, so spending it on hundreds of unlabeled addresses without a prior was not a good trade.
- **Hop-two funder tracing** of the wash ring, to name its single operator.
- **Some platform internals.** The noxa.fun operator behind the CASHCAT factory; where StonkBrokers' treasury sweeps its proceeds; LONG's burn and lock contracts and the controller of its leveraged wrappers; Bags' Solana treasury wallet; whether StonkFun's migrated liquidity is actually locked.
- **First-party docs for LONG and Bags**, which are Cloudflare-gated. LONG's mechanics were reconstructed entirely from on-chain calldata and hook getters, which is more reliable than its docs would have been, but its promotions and team remain third-party claims.
- **CEX listings beyond the platforms' own graduates.** Checked for pump.fun, letsbonk, StonkFun, Bankr and Bags; not for every top-25 token on every platform.
- **Anything in the Argus scanner itself.** No code path was changed. The fingerprints and the fee-model rule live in the research notes, not in detection logic.

## 3. Where the constraints were and why

**Scale versus session.** The brief describes weeks of analyst work. The choice made was to verify mechanics and contracts deeply for all eight rather than run shallow scans on thousands of tokens, because the mechanics are what let future scans be automated and the shallow numbers go stale in a day.

**Public infrastructure rate limits.** Solana's public RPC blocks the largest-accounts call outright and throttled batched transaction reads to an 84% failure rate. Robinhood Chain's RPC returned 429s under three concurrent scans and caps log queries at 10,000 entries. GeckoTerminal rate-limits at roughly 30 requests a minute and returned empty bodies on some windows. Blockscout is Cloudflare-blocked for scripted fetches and had to be driven through the browser pane, one origin at a time. Every one of these was worked around, but each workaround cost time that would otherwise have gone to breadth.

**Sites built to resist reading.** app.long.xyz, docs.long.xyz and bags.fm all refuse scripted requests, and LONG's app is wallet-gated even in a real browser. That is why LONG's report is on-chain first.

**Data that is polluted by design.** Both GeckoTerminal's Robinhood volume ranking and PumpSwap's are dominated by fake volume, pump.fun's own market-cap API is inflated by custom-pair coins, DefiLlama's letsbonk series has been counting StonkFun's wallet since September 6, and Blockscout labels MEME's symbol as AMC. A meaningful share of the work was establishing which public numbers could be trusted before using any.

**Anonymity.** Four of the eight teams are pseudonymous or undisclosed. StonkFun's terms do not even name a governing law. This is not a failure of the search; it is a finding.

**My own error pattern.** Three times I concluded a feature was absent because a standard getter returned nothing, and three times the fact was in storage, in a later transfer, or behind a different baseline. Each was caught and corrected, but the pattern is now written into the research notes as a rule, because it is exactly the mistake the product must not make on a user's behalf.

## 4. The ongoing value

**Every scan on Robinhood Chain now knows more.** The registry entries are live in the scan path. A token from the wash ring fails with a named cluster. TAIWAN and MEME name their real venue. The corrections mean three wrong facts are no longer being served.

**Attribution at mint.** An address ending in `…1e18` is a LONG launch, `…ba3` is Bankr, `…pump`, `…bonk` and `…BAGS` are their Solana platforms, selector `0x686399cb` is Pons v1, and the Pons v2 factory and router addresses are recorded. This is the single most reusable output: it turns "unknown factory" into a platform name in one lookup, and the platform name predicts the fee model.

**One rule that predicts creator dumping.** LONG, Bankr by default, and Pons v1 pay creators in the launched token. Every in-token fee farm the registry has found sits on one of those three. The other five platforms pay in the quote asset. This can be checked before a token has traded.

**A contract and treasury map.** Some 120 addresses with roles: pool managers, routers, bridges, hooks, initializers, lockers, escrows, platform treasuries, multisig signers, Robinhood hot wallets, the stock-token issuer. These are the addresses that must never be mistaken for whales, and the ones whose movements are worth alerting on.

**A fake-volume filter.** Any pool with volume more than 100 times its liquidity, or under $5,000 of liquidity, is treated as wash until shown otherwise. Applied to the sweep, this removed every entry in the chain's top-volume list that was not a stock token.

**Baselines for the alpha scanner.** Where this quarter's runners came from (stock-quoted launches on LONG, Pons v2 and Bankr), what their holder shape looked like on day three, how snipe taxes make block-zero volume meaningless on four platforms, and what a creator exit looks like in the fee-claim stream.

**A record of what is unverified**, so nobody repeats the work or trusts a number that was never confirmed.

## 5. How this appears in reports today, and what it would take to show more

**What a report shows now.** The registry is consumed by `src/threat/scan.ts`. When a scanned token or its deployer matches a registry entry, the report renders it in one of two ways depending on the cluster's intent:

- A **nefarious** match adds 30 to the risk score, forces the grade to `fail`, and prints a red flag in the form "This contract is an indexed launch by the Robinhood Chain wash-volume ring of 2026-09-22 - 23.17M USD reported 24h volume on 170,098 USD liquidity, 136 times its depth." A nefarious deployer prints "The deployer is a known PGREM deployer, template A wallet of the … (nefarious cluster, 13 indexed launches; last seen 2026-09-23)". Known farm, hub or sniper wallets among the top sellers add 20 and a further flag.
- A **benign or unestablished** match prints a warning rather than a flag and does not touch the grade: "Indexed as a token pushed by Machi Big Brother's $TAIWAN launch (launch farm, read as unestablished) - Paired against tokenized TSM…". MEME and TAIWAN now carry the LONG venue text inside that warning.

Holder analysis separately tags any top holder whose address is a registry hub, farm or sniper wallet as a "launch farm wallet".

**What a report does not show.** There is no venue chip, no fee-model indicator, and no fake-volume filter in the report today. A LONG token that is not in the registry looks the same as any other token. The fingerprints exist in the research notes, not in code.

**What it would take.** Three small, separable changes, none of which I made:

1. A venue resolver: match the token's address suffix, minting factory and launch selector against the fingerprint table and render a "Launched on LONG (Doppler)" line, with the fee model beside it ("creator paid in-token").
2. A creator-fee-asset warning derived from the venue: for LONG, Bankr and Pons v1 launches, a standing note that creator rewards arrive in the token and the deployer's claim stream should be watched.
3. The volume-to-liquidity guard on any ranking or "volume" figure the report prints, with the ratio shown when it trips.

Until those exist, the visual footprint of this study is exactly the registry hits above, which is real and already live, and the documentation, which is for analysts rather than end users.
