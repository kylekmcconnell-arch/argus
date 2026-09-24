# Holder enrichment, observation alerts and live collection

Issue #525. Continued from main f2191a77 after the evidence repairs.

## Delivered behavior

Fresh token and server project holder investigations collect Arkham labels for every captured holder, up to 25, in one bounded batch. Chain/address identity is checked before joining a label. Responses preserve Solana case. Missing rows are incomplete coverage; provider labels are historical attribution, not a beneficial-ownership or coordination claim. Nothing is fetched when opening a saved report. Shared and private reports cannot open workspace history.

The workspace history disclosure now includes observation alerts over adjacent compatible frozen snapshots. An indexed wallet entering/leaving a captured rank is not described as buying/exiting. Changed supply share is not called a trade. Incomplete observations cannot be skipped to manufacture continuity. These are read-only history comparisons, not predictive alerts or external notifications.

A new read-only database view supplies the original snapshots, accessible only through the service role; both history routes enforce organization and exact-token filters. Database tests cover the view and privileges. Viewer users can read their workspace history without analyst quota; enrichment remains analyst-only and within existing supplemental admission controls.

The live collector uses 25 or fewer fixed free public requests, saves original raw responses privately with hashes, and resumes without refetching. Its first run recovered 47 recent Bankr launches across Base/Robinhood and 18 reported fee/revenue series across six platforms. It does not pretend a recent-launch sample is full history. LONG lacked a source record and BONK's returned identity did not bind. No raw provider transcripts are committed to Git.

Fomo preparation now enforces finite explicit caps for all live modes, keeps Solana case and chain identity, stops on provider failure/throttling, checks returned wallet identity and reserves the potential hit cost on uncertain results. No paid bulk sweep ran. The current registry has 148 wallet subjects; worst-case wallet resolution is 7.4 million CU.

## Still blocked or unfinished

A numerical paid-backfill budget is not recorded. The user was asked for it while independent work continued. Production provider keys exist, but this change does not export them or purchase credits. Full launch histories across all eight platforms need suitable indexed feeds and longer collection runs. The documented Bankr endpoint only returns 50 recent launches.

Receipt-level creator fee/swap attribution, reliable 7d/30d ranked coverage, historical CEX and stock-pair outcomes, Fomo identity ingestion into frozen reports, and predictive behavioral validation remain unfinished. Provider-reported revenue categories do not establish audited creator cash receipts. Observational alerts must not be marketed as a validated trading strategy.

## Validation and rollback

Offline regressions exercise rank 25, sparse/failing provider responses, Solana case, chain mismatch, tenant isolation, incomplete snapshots, immutable joins, receipt tampering, namesake revenue sources and request budgets. Full quality/build plus required protected CI gate deployment. The new database view is read-only and can be dropped independently; no saved report evidence is rewritten. Disabling Arkham enrichment leaves the existing holder index intact.
