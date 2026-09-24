# Evidence and scoring repairs — 24 September 2026

Follow-up to issue #525 and the audit of the 23 September handoffs. The original handoff was checked against main 4018d312; this change fixes reproduced defects rather than treating prior shipment as acceptance.

## Changed

- Creator transfer reads now distinguish explicit empty results, API failures and capped histories. Earlier recipient activity is excluded, failed/capped recipients stay untraced, and raw transfers never become fee claims, buys, sales or favorable holding verdicts. Full receipt-level claim/swap and inventory attribution remains unfinished; conduct is explicitly unknown in this transfer-only path.
- The pure conduct classifier no longer says “none sold” after a partial sale, calls a burn a buyback, or ignores larger balancing purchases. It is gated from transfer-only API observations.
- Extreme volume versus current depth is an investigation anomaly, not proof of manufactured trading. Missing depth differs from zero depth. The manufactured-volume score override is removed; ordinary liquidity/activity heuristics remain.
- Confirmed Base B20 system assets receive the same per-token source-verification treatment in the token score and deep scan. Exact chain/address matching is required; authority checks remain active.
- Base o1 attribution requires the expected CreatorRegistered signature, registry, token and valid creator topic. Unrelated and removed logs cannot confirm a venue.
- The runtime turnover cohort initially contained 13 token and eight wallet records. The archived study supplied 32 direct-deployment records (not the reported 31); all 32 tokens and 33 reported deployer/funder wallets are now indexed with archived-source limitations and unestablished intent. The archive also corrects BET/JEV: 0x1df7… is BET, while JEV is 0x675279fe3259dcd20b1520399d2977dad042bf3f. Fresh Robinhood metadata requests returned HTTP 403 and the public RPC returned HTTP 429, so this is explicitly an archive correction, not live verification.
- Free public explorer queries recovered Catalyst's six registry events and their successful launch transactions. All six token addresses, the common sender and four receipt-linked infrastructure contracts are in the shared runtime index. Selected raw receipt logs are retained under docs/launchpads/receipts. A marketing name was not required to index the suite.

## Still incomplete

Reconciliation of the reported 31-token membership against the 32 archived direct deployments, verified manipulation evidence, Catalyst escrow/payout identities and custody analysis have not been established. Complete launch histories, reliable cross-chain rankings, Arkham/Fomo enrichment, historical revenue/CEX/stock-pair data and validated behavioral alerts remain the broader issue #525 work. This patch does not claim to complete those data programs or to implement swap-aware creator conduct.

No paid collection was run. The free explorer's creation-address lookup returned an empty success for Catalyst; the token mint log located the actual launch transaction. This is why a missing creation response must not be presented as absence of a launch.

## Validation and rollout

Regression coverage includes provider throttling, capped intermediary history, pre-forwarding market transfers, mixed sale/buyback/burn behavior, unknown depth, wrong B20 subjects, retained pause powers, unrelated announcement logs and shared-index lookup of all six Catalyst registrations. Required CI and production deployment remain the rollout gates; frozen saved reports are not rewritten.
