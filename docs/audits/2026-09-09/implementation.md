# Reliability repairs and rollout

Tracks #390 and PR #391. The audit remains an immutable description of the reviewed baseline, not a description of the repaired system.

## Changes

- F01/F02: token axes carry assessed weight; missing capabilities contribute neither points nor denominator. Scores normalize over observed weight, retain hard caps, and remain provisional. Contract, tax and holder capabilities require measured fields. Unknown tax and unassessed dimensions are labeled explicitly.
- F03/F09: exact-token selection cannot substitute another base asset. DEX transport/malformed failures remain retryable failures and are not negative-cached. Known-chain Solana mints can retain contract-only assessment without inventing DEX fields. Wallet scans retain their requested chain.
- F04/F05/F06: receipt/alert/holder-edge identity includes chain under the existing workspace boundary. Rechecks distinguish missing observations from measured zero and cannot use another chain's liquidity. Client and server preserve base58 case. Additive migration preserves collision history and quarantines unresolvable legacy identity.
- F07/F12/F13: all three uncovered paid routes use the daily supplemental allowance. Two scan-internal helpers can claim one subject/user/workspace-bound admission per paid active run, with an atomic database claim. CORS admits idempotency headers; manual owner rechecks pass the middleware and remain workspace scoped.
- F08: shared report copy follows the check ledger rather than assuming empty next steps mean completion. Production and Developer still share one renderer; Developer adds its evidence inspector.
- F10/F11: server token collectors use isolated cost ledgers. Missing cost telemetry is unknown. Token cancellation propagates through provider fetches, social collection, sanctions, price history, retries and cache publication. Person/project adapter deadlines propagate through provider fetches and guarded public-web requests without global mutable fetch overrides.
- F14: chart signals require exact upstream chain/address identity; ticker and market cap alone cannot bind a reading. An upstream feed without identity fields remains visibly uncovered.
- F15/F16: token API separates FDV from measured market cap, returns provisional assessment scores, persists immutable report bundles and costs, and recovers completed idempotent requests without spending again. Recovery also handles a successful version write followed by a failed receipt update. API reports are workspace-visible, matching the existing person API.
- F17: corpus auditing uses stable pagination at a collection cutoff, includes all report kinds and attestations, preserves case/version IDs, identifies missing versions, and generates a bounded rescan plan. Historical errors do not disappear because a new release deploys.

## Operations

Threat queue runs every 15 minutes on the existing Pro plan, at most 120 receipts per run, with a 12-hour freshness target. Responses expose oldest due age, capacity saturation, deferrals and failures. Nominal capacity is 480 attempts/hour; outages can reduce it and saturation requires operator attention.

Scan receipts and operations responses carry deployment/methodology identifiers. Token methodology is `argus-token-v3-assessed-evidence`. Existing source/check failure classes remain the operational evidence ledger. This does not claim production p95 latency or recovery rates from the sparse historical sample.

PR #311 was continued against current main and merged. The newer audience-shape collector was retained. Only its obsolete About-page claim remained to remove because main already contained the substantive notable-followers removal.

## Historical evidence

The first expanded production corpus read accounted for all 86 cases and 297 versions, with no missing latest versions. It flagged 82 errors and 45 warnings in historical immutable reports. This is a corpus finding count, not a live failure rate or 82 independent incidents. The audit emits at most 12 prioritized rescan candidates, with unknown cost estimates explicitly null. It does not autonomously launch an unbounded paid backfill or rewrite old evidence.

## Rollout and rollback

Run quality, build, exact migration fixtures, database/RLS tests, and protected-branch CI. Apply `threat_chain_identity` and `bounded_scan_supplements` to production before deploying the dependent middleware. Keep generated collector and sweep bundles in the same commit as source. Merge only after all required checks pass, then verify the production SHA and protected endpoints.

The chain migration preserves payloads and history. Application rollback must retain chain-aware ledger reads/writes; reverting to an address-only writer would reintroduce collisions. Disable the affected threat entry points or deploy a forward correction if necessary. Do not delete immutable versions or undo migration history to hide a failed scan.
