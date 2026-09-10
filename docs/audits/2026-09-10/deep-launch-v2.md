# Deep launch analysis v2

Issue: #399. Builds on #397 and #398.

## Changed behavior

The saved Robinhood launch action now verifies supported PONS v1/v2 launches by matching both the token's immutable factory reference and the factory's exact token record. PONS v2 reports expose pinned curve reserves, lifecycle phase, combined fee inputs, a deterministic raw-unit sell quote, and bounded settled `CurveSell` events. A pool-created launch is checked against the locker selected by its factory before ARGUS describes the position as locked.

Exact-address Robinhood market pairs add source-attributed liquidity and recent sell activity. For the deepest retained pool, ARGUS also retains bounded GeckoTerminal rows where the target token was the input asset and corroborates the latest row against a successful on-chain transaction receipt. This establishes observed settled exits, not universal future sellability. These records never stand in for locker custody or an execution simulation. Creation tracing tries `debug_traceTransaction` first and then the parity-style `trace_transaction` method when available.

Completed results with gaps expose an explicit missing-evidence retry. The retry is a fresh bounded snapshot, does not rescan the ARGUS report, consumes one supplemental request, and has a two-minute cooldown. Production and Developer render the same saved panel. The ARGUS score remains unchanged.

## Truth boundaries

- A pinned curve quote is deterministic protocol math, not a wallet execution guarantee.
- A settled sell event proves only that the retained transaction succeeded.
- Indexed recent sells are attributed to DexScreener and are not on-chain simulation evidence.
- A locker record proves custody at the pinned block, not current dollar depth.
- Unsupported protocols, tracing methods, missing history, and exhausted request budgets remain explicit gaps.
- No private key, transaction signing, transaction submission, arbitrary browser target, or browser-selected provider endpoint exists.

## Limits

The default and hard request ceiling is 32 requests; the default time limit is 40 seconds and the hard time ceiling is 50 seconds. Responses are capped at 1 MB. It does not perform arbitrary-wallet state-override simulation, complete holder reconstruction, complete fee-recipient flow tracing, every Robinhood launchpad, or tokenized-equity rights analysis.

## Rollout

Apply `20260910194000_deep_launch_v2_retry.sql` before deploying the application. Verify the five-argument claim function is service-only, v1 claims fail, v2 claims deduplicate active work, and explicit retries respect the cooldown. Then run one authenticated saved report and verify persistence after reload in Production and Developer.

Rollback the application to the prior production deployment if live checks fail. The additive v2 runs and retry function can remain; v1 saved results remain retained in storage.
