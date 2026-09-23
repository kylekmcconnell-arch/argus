# Reproducible study collection

Issue #525. This is the collection foundation, not a completed backfill or a live product dashboard.

Run `node --import tsx scripts/launchpad-study.ts init /tmp/study-v1.json` to create an empty ledger. Import a normalized `StudyPage` using `append <previous-ledger> <page.json> <new-ledger>`. Inspect it with `status <ledger>`. Output files use exclusive creation so an old ledger cannot be overwritten. The commands make no network requests and spend no provider credits.

The page contract is in `server/launchpads/study.ts`. It records platform, exact chain, fixed observation time, collection source, collection time, current/next cursor and population scope. Every token has a source-backed origin assertion, named metric bases and timestamped permitted-exchange listing evidence. A research lead cannot claim confirmed attribution. Source assertions still require independent verification before stronger product conclusions.

Checksums protect normalized imported pages against changes; they are not hashes of original provider responses. Raw provider response archiving and automated source adapters remain outstanding. Imports resume only the next cursor, reject changed sources/scopes and overlapping token pages, and preserve old ledger versions. A failed fetch supplies no page and must not advance the cursor.

Rankings cover current market cap, identified-pool liquidity, and 24h/7d/30d volume at a fixed observation time. FDV cannot substitute for market cap. Unverified aggregate liquidity and unreviewed/suspected volume do not enter the corresponding ranked lists. Partial populations remain partial even with 25 rows. Terminal full-population collection is labelled only source-reported complete; it is not proof that the provider indexed every launch. Candidate origins and missing measurements remain visible in coverage counts. No claimed current CEX listing arises from an empty listing list.

No historical documents were bulk-imported as verified facts. The original study lacks sufficient structured receipts and contains conflicting claims. Outstanding work includes live adapters and scheduling, raw receipt retention, complete chain/platform populations, source verification, authenticated product presentation, paid wallet identity enrichment, and outcome-calibrated alerts. This tool does not alter scores or saved reports.

Validation covers idempotence, cursor order, tamper detection, overlapping pages, candidate origins, observation-date separation and incomplete/invalid rankings. Rollback removes the offline tool; no database migration is involved.
