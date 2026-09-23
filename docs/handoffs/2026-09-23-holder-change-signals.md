# Saved holder change signals — issue #525

The existing report-change mechanism now compares frozen top-25 observations. It can surface a registry-indexed wallet newly appearing in the captured ranks, a previously indexed wallet no longer appearing, or a two-percentage-point change in the same wallet's observed supply share. These changes link to the holder evidence and both saved report versions through the existing Decision discovery flow. They do not change the token score.

Comparison requires the same chain/token, same provider, complete ranked-address collections, valid non-duplicated rows, consistent supply totals and increasing capture times. Registry changes cannot create arrival/departure signals. Pool, exchange and locker movements are excluded from individual-wallet signals. Partial new-format holder coverage cannot fall back to a misleading legacy concentration alert. Solana owner samples remain ineligible until a globally ranked collection is available.

The wording never equates missing ranks with an exit, supply-share increases with purchases, or curated labels with beneficial ownership/common control. Two percentage points is a review threshold, not a backtested predictor. Token supply changes, transfers, custody and provider scope require reconciliation before a trade conclusion.

Validation: full suite passed 5,272 tests plus one expected failure before an additional malformed-supply test; the final focused model/report/server-import set passed 24 tests. Type checks, offline canary and calibration passed. Production build regenerated the collector. Regression cases include changed registry versions, changed providers, partial samples, reversed timestamps, exchange custody, malformed snapshots, duplicate wallets and impossible supply totals.

Remaining: transaction-confirmed net-flow attribution, beneficial ownership, scheduled monitoring, user alert preferences, and measured predictive performance. This is a saved-report comparison feature, not an autonomous trading or notification service.
