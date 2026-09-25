# Data acquisition and reuse record — 25 September 2026

Related issues #525 and #537. This is a source and implementation inventory, not a declaration that the historical programme is complete.

## Collection policy

The owner authorized research collection without a hard spending cap on 25 September. Notify above $100 per Europe/Lisbon calendar day; optimize duplicate calls, cached receipts, batching and narrow historical ranges. Do not treat the threshold as a stop. Customer supplemental quotas remain separate. Fomo CLI jobs accept `--no-spend-cap`; provider balance checks still apply. Compute units, included credits, subscription allocations, estimates and actual cash charges must remain distinguishable. The new daily report-ledger read is partial accounting, not a complete provider bill or an automatic notification service.

## Existing stack: what is actually established

Production configuration contains keys for xAI, Anthropic, OpenRouter, Serper, twitterapi.io, Helius, Etherscan, Arkham, People Data Labs, Monid, CoinGecko, CryptoRank, GMGN, FomoScan, GitHub and Bitquery. This is configuration evidence, not evidence of plan entitlement or working history endpoints. Current health checks leave Companies House and OpenCorporates unconfigured. Safe Browsing has a deployment entry but health reports it unavailable: investigate the value/runtime contract, not simply add another variable. No TweetScraper or Dune account was established from this inventory.

The signed-in application showed historical provider receipts and a recent Arkham holder-identity failure. A successful PDL request with `no_match` and a successful Fomo request with a CU miss are successful transports, not identity findings. CoinGecko's recent success does not prove that the separate CEX ticker call succeeded for every token.

Vercel sensitive values were unavailable through environment download. Supabase dashboard required sign-in. Therefore this record does **not** claim a full live database inspection. The new owner-only application inventory exposes public-table metadata and exact authenticated-workspace counts/date ranges, plus saved report field frequencies and holder snapshot coverage. Shared tables return schema only. It does not expose customer payloads or bypass tenant isolation.

Reuse candidates, subject to actual stored coverage:

| Existing storage | Reuse | What must be checked |
| --- | --- | --- |
| `report_versions`, `evidence_items`, `check_runs` | Frozen project/person identities, career sources, market observations and source outcomes | Exact subject, source capture dates, server attestation, original evidence versus model leads |
| `entity_facts`, `graph_contributions`, `investor_records` | Prior companies, relationships and financing observations | Exact identity/domain joins, attribution and original source; names never establish common control |
| `person_research_runs` | Reuse public-source research rather than rebuying search | Completed state; snippet discovery versus full page read; dated employment versus undated claims |
| `deep_launch_runs` | Creation, launch and creator conduct evidence | Coverage of contracts/blocks and chain identity; current output is not a population census |
| `holder_snapshot_history`, `holder_observations` | Historical top-holder cohorts and prospective signal registration | At least two comparable complete snapshots; timestamp, provider and rank eligibility; no inferred sales from missing ranks |
| `fomo_wallet_observations` | Reusable wallet labels without live lookups on reports | Production row count, exact chain, age and provider-bound address |
| `provider_usage_events`, `scan_run_receipts` | Unit economics and collection reliability | Failed/aborted work, missing costs, duplicate accounting, bulk jobs outside report ledger |
| `provider_cache` | Avoid duplicate retrieval | Expiry, provenance, sharing rules; cache presence alone does not establish durable historical evidence |

## External datasets checked against primary documentation

| Source | Data useful to Argus | Access/cost position | Integration decision and limits |
| --- | --- | --- | --- |
| [Common Crawl](https://commoncrawl.org/get-started) | Historical project/team pages and official announcements | Public crawl files and HTTP downloads are free; own compute/storage remain | Query URL indexes for exact domains and use byte-range WARC reads. Archived claim supports what a page said at capture, not independent truth. |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | Company submissions, officer/director and transaction disclosures, financial outcomes | Public APIs and bulk data | Bind issuer CIK and person role, record filing/event/capture dates separately. Public US issuers only; no result is not a clean background. |
| [Companies House](https://www.gov.uk/guidance/companies-house-data-products) | UK company register and historical filed accounts | Free basic company and electronic accounts bulk products; API requires account/key | Company-number joins and dated filings. Basic bulk data does not supply a complete career/LinkedIn graph. Company status is not an individual outcome. |
| [GH Archive](https://github.com/igrigorik/gharchive.org/blob/master/bigquery/README.md) | Public GitHub events and dated project participation | Public dataset; BigQuery query charges depend on account/scans | Query bound accounts/repos and partitioned dates. Event activity is not code quality, sole authorship or commercial success. |
| [Binance public data](https://github.com/binance/binance-public-data) | Historical spot/futures trades and candles | Public daily/monthly archive downloads | Use checksums and timestamp-unit rules. First observed trade is not necessarily official listing date. Exact exchange instrument must bind to the token. |
| [CoinGecko pool history](https://www.coingecko.com/learn/how-to-pull-crypto-prices-from-dexs) | DEX pool OHLCV for outcome studies | Demo access exists; older history and limits are plan dependent | Reuse existing account first. Pool tracking inception limits history. Keep delisted/dead tokens and absent-price cases in the denominator. |
| [CoinGecko tickers](https://docs.coingecko.com/reference/coins-id-tickers) | Current CEX venue/instrument observations | Existing configured account; entitlement unverified | Snapshot exact contract-bound assets, whitelist the owner's eleven venues. Current tickers do not backfill listing/delisting dates. |
| [DefiLlama](https://docs.llama.fi/pro-api) | TVL, fees and revenue time series | Open data available; Pro and paid API are distinct products | Existing free collector already covers selected platforms. Fees, protocol revenue and creator payouts must remain distinct; API subscription is not assumed from Pro. |
| [xStocks issuer API](https://docs.xstocks.fi/developers) | Exact chain deployment/wrapper addresses, security metadata, multipliers/corporate actions | Public endpoints require no authentication | New keyless paginated collector saves original page hashes. Join actual pool quote address to issuer deployment; stock-like ticker alone is insufficient. Issuer registry is not proof of a launchpad's pairing success. |
| [Bitquery Solana history](https://docs.bitquery.io/docs/blockchain/Solana/historical-aggregate-data/) | Launch instructions, migrations, DEX trades and historical aggregates | Existing key; archive entitlement and price not yet verified | Prefer existing plan over a new provider. Test earliest/latest coverage, decode each actual program version and reconcile counts. Recent/realtime data cannot stand in for full archive. |
| [SQD](https://sqd.dev/chains/solana/) | Historical chain indexing inputs | Public Solana Portal is free for development; production needs entitlement review | Candidate low-cost backfill source. Verify block coverage, decoding and commercial conditions before relying on it operationally. |
| [Google Blockchain Analytics](https://docs.cloud.google.com/blockchain-analytics/docs/overview) | Indexed EVM blocks, transactions, logs and traces | Dataset storage free; queries billed under BigQuery | Dry-run bytes, partition filters and factory-topic restrictions. Do not assume every requested chain or Solana is in this specific product. |
| [Dune API](https://docs.dune.com/api-reference/overview/billing) | Curated chain data and reproducible launch/trade queries | Active trial or paid plan required for API; execution/export consume credits | Not a permanently free bulk API. Prefer raw program evidence and exact queries over unverified public dashboard totals. |
| [TweetScraper](https://tweetscraper.io/) | Follower/following lists, tweet engagement audiences, community members and profile CSV enrichment | User reports existing credits; exact account/service not confirmed | Public site advertises these exports and charges credits for verified emails. No public API/full tweet archive established. Import public account IDs/handles/profile URLs and dated relationships; discard unnecessary contact fields. |

This catalogue records primary-source research as of 25 September, not negotiated prices or verified licences for every downstream commercial redistribution. Prefer source links and attributed facts in reports over redistribution of entire third-party datasets.

## Completion criteria for the wider programme

1. **Career outcomes:** bind exact public accounts and company identifiers; retain source passages, role dates, contemporaneous event dates and capture dates. Separate person's attributable contribution from company's outcome. Conflicts and unknown end dates remain explicit. Existing role-aware report presentation is not a completed verified historical data collection.
2. **Launch population:** enumerate creation events per verified factory/program version and chain from inception through a stated block/slot, including failed, dead and ungraduated launches. Persist checkpoints and reconcile totals. Address suffixes and recent API listings are insufficient.
3. **Rankings:** freeze a common observation window; keep raw reported volume separate from corroborated volume; reconcile pool IDs/migrations; circulating market cap is not FDV. Report top-25 eligibility and missing measurements per metric.
4. **CEX and stock pairs:** preserve dated venue observations, official announcements and listing/delisting status. Persist exact base/quote/chain/pool identity and stock issuer binding. Measure liquidity, trading continuity and outcomes of those pairs, not just their presence.
5. **Fomo:** obtain runtime collection access, inspect zero-CU plan endpoint, collect exact-chain subjects, import immutable receipts into the workspace and verify report retrieval. The archived 2026-09-17 sweep has unscoped EVM rows and no positive wallet labels; it cannot be mass-imported as verified identity.
6. **Empirical validation:** register cohorts before forward outcomes, preserve failed/dead/no-price assets, compare against age/liquidity/venue-matched controls, hold out time periods, account for fees/slippage/capacity, and report false positives and coverage. The existing shadow evaluator is research-only; it has not established predictive value.

No spending-cap clarification remains outstanding. Runtime access, production evidence and empirical observation are real dependencies; they must not be disguised as completed work.
