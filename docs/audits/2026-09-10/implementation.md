# Report reliability repairs — issue #393

Route: canonical ARGUS repository. Baseline: 720f016 (PR #392). Production and Developer retain one shared report implementation.

## Changed behavior

1. Subject research leads stay in the dedicated, explicitly unverified section; their allegation text cannot populate the headline concerns collection. No blanket all-clear is added.
2. Website numeric claims remain unverified questions. Automatic financial-promise penalties ignore negated, conditional and attributed examples. Affirmative promises remain detectable. Website methodology becomes v2.
3. Newly collected token axes retain references to their frozen measurement fields. Standalone and embedded reports share a composition mapper; older missing counts read as unrecorded. Unassessed axes stay excluded.
4. Investigation payloads and the common report expose separate token, project and supplemental outcomes. Core token completion and a usable score are preserved when project diligence is unavailable.
5. An absent bio contract may bind through the account-linked official domain only when the fetched page reciprocates the exact account and publishes an exact-chain explorer contract link. Conflicting contracts are not overridden. Public-web transport retains pinned DNS and redirect checks. The saved proof includes URL, contract URL, hash and collection time. This is publication/identity evidence, not proof of legitimacy. Unsupported chains/routes stay unresolved.
6. API, copied text and visible market facts use measured availability: circulating market cap, FDV, liquidity and token age are distinct. A fallback value is not presented as a measurement.
7. Share minting requires an explicit immutable version ID. Summary copying uses the same eligibility gate as the Share button.
8. Typed chain/address identity covers persistence, case lookup, rescan routing, scan/cache keys and watchlist entries. The database indexes unambiguous existing histories without changing case IDs, canonical aliases or immutable payloads. Mixed-chain or duplicate histories are flagged; no automatic merge occurs. Bare-address lookups can return ambiguity; qualified identities resolve exact cases. Solana case is preserved.
9. Source counts no longer confer the word verified on the strongest axis. Generic founder-audit questions route to identity rather than security. Governing-role coverage is displayed separately from required-check completion.
10. Organization accounts are excluded from people-verification progress counts. First-party identity records are not described as verified employment. Organization subjects no longer receive a person disclosure bonus; human bonus and thresholds are unchanged. Person methodology becomes v6.

Source-verification attempts now retain rejection/fetch/deferred outcomes and reasons. The planner selects retrieval retry, deferred fetch or alternate-source research rather than recommending an unchanged full rescan for every failure. These are recommended targeted actions, not an unattended spending loop. Accepted attempts are explicitly not counted as unique verified facts. Score comparisons explain methodology, governing-role and coverage changes, with source-availability limits.

## Rollout and rollback

Apply `20260910091456_report_subject_identity.sql` before deploying the new report writers. The migration adds a service-only identity helper and persistence/lookup wrappers; all existing activation, tenant, provenance, idempotency and routing-failure guards remain in the call chain. New case identity writes are serialized by workspace/kind/identity and protected by a unique index.

Before promotion, run the exact migration fixture, database guard suite, TypeScript, application tests, truth contract, calibration, offline canary and build. Inspect quarantined case counts. Do not rewrite old report payloads or mass-rescan the corpus.

Rollback application code to the prior immutable deployment while leaving the additive migration in place: the database wrapper accepts both old address-only callers and new qualified references. Do not drop the identity index or restore the old wrapper while new chain-qualified cases exist. Any database rollback must reconcile those cases explicitly.

Validation results and the final deployment status are recorded in the PR. Original diagnostic fixtures in this directory describe the pre-repair baseline and are not CI tests; desired-behavior regressions now live under src/server.

## Local validation

- 418 application test files: 4,397 passed, one expected failure.
- Fresh isolated Supabase database built from repository migrations: 90 assertions passed (70 existing guards, 10 existing threat migration checks, 10 report identity migration checks).
- Typecheck and production build passed.
- Truth contract passed; calibration 20/20 without verdict drift; offline canary 7/7 with zero unexpected URLs.
- Production read-only preflight found 31 token/investigation cases, with no missing or mixed chain histories. This is a migration preflight, not a claim that every report has complete evidence.

The shared developer database was left on its original migration history; validation used a separate temporary Supabase project. The organization-bonus change increments the person methodology identifier so old and new results are not silently treated as equivalent.
