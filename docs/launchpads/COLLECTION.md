# Reproducible study collection

Issue #525. This is the collection foundation, not a completed backfill or a live product dashboard.

Run `node --import tsx scripts/launchpad-study.ts init /tmp/study-v1.json` to create an empty ledger. Import a normalized `StudyPage` using `append <previous-ledger> <page.json> <new-ledger>`. Inspect it with `status <ledger>`. Output files use exclusive creation so an old ledger cannot be overwritten. The commands make no network requests and spend no provider credits.

The page contract is in `server/launchpads/study.ts`. It records platform, exact chain, fixed observation time, collection source, collection time, current/next cursor and population scope. Every token has a source-backed origin assertion, named metric bases and timestamped permitted-exchange listing evidence. A research lead cannot claim confirmed attribution. Source assertions still require independent verification before stronger product conclusions.

Checksums protect normalized imported pages against changes; they are not hashes of original provider responses. Raw provider response archiving and automated source adapters remain outstanding. Imports resume only the next cursor, reject changed sources/scopes and overlapping token pages, and preserve old ledger versions. A failed fetch supplies no page and must not advance the cursor.

Rankings cover current market cap, identified-pool liquidity, and 24h/7d/30d volume at a fixed observation time. FDV cannot substitute for market cap. Unverified aggregate liquidity and unreviewed/suspected volume do not enter the corresponding ranked lists. Partial populations remain partial even with 25 rows. Terminal full-population collection is labelled only source-reported complete; it is not proof that the provider indexed every launch. Candidate origins and missing measurements remain visible in coverage counts. No claimed current CEX listing arises from an empty listing list.

No historical documents were bulk-imported as verified facts. The original study lacks sufficient structured receipts and contains conflicting claims. Outstanding work includes live adapters and scheduling, raw receipt retention, complete chain/platform populations, source verification, authenticated product presentation, paid wallet identity enrichment, and outcome-calibrated alerts. This tool does not alter scores or saved reports.

Validation covers idempotence, cursor order, tamper detection, overlapping pages, candidate origins, observation-date separation and incomplete/invalid rankings. Rollback removes the offline tool; no database migration is involved.

## Live collection and holder integration (24 September)

`node --import tsx scripts/launchpad-live.ts <private-output-directory>` now performs at most 25 fixed public GET requests: Bankr's documented recent-launch feed and three DeFiLlama categories for each platform. No credentials or paid endpoints are used. Original response bodies, status, retrieval time and SHA-256 hashes remain in private local receipt files. Re-run with `--resume` to reuse and verify those receipts without refetching; a fresh directory is required for a fresh observation. A directory lock prevents concurrent writers.

Bankr collection is explicitly limited to the recent feed on Base and Robinhood. Other chain rows remain archived and counted as excluded. It is not an all-time backfill. DeFiLlama series require an exact returned platform website, preserve missing days as unknown, and keep fees, protocol revenue and supply-side revenue separate. Supply-side revenue is not automatically creator payouts; known shared-wallet attribution concerns still need review. Slug candidates that return no record or lack a binding website are not silently accepted.

The first run retained 47 Base/Robinhood launches and 18 reported historical series across Bankr, pump.fun, Pons, StonkBrokers, StonkFun and Bags. LONG returned no fee record at the requested endpoint. BONK returned a parent record without a website, so its attribution was withheld. Three Bankr feed entries were on another chain. These are source snapshots, not claims of completed eight-platform population coverage or independently audited revenue.

Fresh token and project holder snapshots now query Arkham for up to all 25 captured addresses in one bounded subscription-backed batch. Exact-address provider labels and their observation time are frozen with the report. Partial responses and absent keys remain explicit; labels do not change scores, prove common control or identify exchange customers. Solana case is preserved.

Saved workspace history also exposes conservative observation alerts, based only on adjacent comparable complete ranked snapshots. Partial snapshots are not skipped to manufacture a continuous trend. Changes in supply share and appearance/disappearance from captured ranks do not establish buys, sales or exits. These observation alerts are not calibrated opportunity signals or push notifications.

Fomo sweeps now require an explicit finite CU cap in every live mode, preserve chain/address identity, stop on unavailable/rate-limited responses and avoid overwriting output files. A wallet resolution must return the exact queried wallet before it can bind an identity. Unknown responses reserve possible hit cost. Bulk Fomo execution still requires the numerical budget and usable account entitlement; no bulk paid collection was run in this change.
