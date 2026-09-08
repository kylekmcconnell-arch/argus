# Enigma reliability follow-ups

Issue #386 follows the approved production release in PR #385. These changes address the remaining review findings without changing the report methodology.

## Changes

- Ownership automation uses `pull_request_review` submitted/dismissed events. The evaluator still loads from the protected base commit and reads current reviews from GitHub; actor ownership and approval requirements are unchanged. GitHub event reference: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_review.
- Arkham outcomes are per address. A successful basic fallback plus completed risk read is usable even when enrichment failed. Unavailable siblings cannot erase or prevent caching successful addresses. Accounting retains every physical call and its success state. Client labels survive partial batch coverage, with an unavailable notice.
- Basic Facts explicitly returns `collectionCompleted`, independent of its verified-fact count and partial presentation state. Completed discovery and source reads can support bounded evaluation of the collected record even when no fact passes verification. Failed/partial discovery or failed source reads cannot. Broad empty discovery still does not invent question-specific empty attestations.
- Etherscan `No data found` is recognized only for contract-creation lookup. The result is a completed but unresolved deployer; the same envelope is not accepted for wallet history, and throttling remains unavailable.
- The additive data migration restores exact base58 report keys from preserved payload addresses. Existing canonical rows win collisions; old rows are retained under `*-legacy-case` kinds. It operates within organization/kind boundaries. It never guesses lost capitalization. Historical holder edges or other payloads whose identifiers were themselves irreversibly lower-cased need fresh collection; they cannot be safely reconstructed from lowercase strings alone.
- The threat cron selects up to 120 oldest due receipts across workspaces. Each item's writes and alerts execute in that item's organization context. Fresh receipts and retries deferred for ten minutes are excluded by the database query. Failed provider reads preserve prior measured outcomes, report failure, and move to the back of the queue. New batches stop at an 80-second budget within a 120-second function ceiling. Manual owner calls retain their organization scope.
- The legacy global webhook is restricted to `ARGUS_THREAT_ORGANIZATION_ID`; all other workspaces receive stored tenant-scoped alerts. This avoids sending another workspace's data to a shared external webhook. The variable no longer restricts which workspaces are rechecked.

## Verification

Targeted regressions cover sibling provider failure, fallback success and cost counts, basic-facts empty/failure states, Etherscan no-data semantics, cross-organization cron writes/alerts and retry behavior, and client display of partial label batches. Existing report ownership policy tests remain in place.

The case migration test embeds the exact migration into legacy/collision fixtures and rolls back the transaction. It checks restoration, collision preservation, organization boundaries, no guessed capitalization, and idempotence. A separate local PostgREST check exercised the actual due-receipt query against two workspaces and verified fresh/deferred exclusions, then removed its fixtures.

Exact final application/database gate results are recorded in the PR. No production changes are made by these tests.

## Rollout and rollback

Apply `20260908165653_restore_threat_address_case.sql` before deploying the revised cron, so duplicate legacy keys are reconciled before due-queue processing. Preserve the existing webhook organization setting. Merge/deploy through protected main after required checks. Review-trigger events can be exercised once this workflow is in the base branch; static validation is not a live event-delivery test.

Revert application and generated bundles together if needed. Do not blindly reverse recovered address capitalization. Archived collision rows preserve historical payloads for inspection; the migration does not delete them. Deferred provider failures retain their previous measured results.
