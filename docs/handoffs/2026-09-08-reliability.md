# ARGUS reliability restart, 2026-09-08

## Issue and route

- Issue: https://github.com/kylekmcconnell-arch/argus/issues/360
- Route: this repository, server token identity collection.
- Risk: High, incomplete provider reads previously became completed negative findings.
- Baseline: main at 45689e56e2339d69d0d0adac37ccad60d1f54959.
- Working checkout: /Users/kyle/argus-reliability-20260908.
- Branch: codex/360-official-site-coverage.

## Outcome and changed behavior

Official-site resolution now distinguishes declared, empty, and failed outcomes. HTTP errors, unrecovered transport failures, batch lookup failures, and failed follow-ups for capped DEX responses leave token identity unavailable and token applicability provisional. An unread second official site cannot silently certify that a token declaration is unique. Ambiguous declarations also remain unresolved. Successful reader recovery and completed empty searches retain their supported outcomes.

The orchestrator includes site-fetch attempts in project-token provider accounting. The production collector bundle is rebuilt. The sweep build ran and produced no diff.

## Acceptance criteria

- [x] Official-site 429 with empty registries records unavailable and provisional applicability.
- [x] Batch DexScreener failure records the same outcome.
- [x] Regressions also cover 403, 404, transport failure, capped-response follow-up failure, and an unread second official site.
- [x] Successful reader recovery, exact identity binding, and completed empty searches remain covered.

## Verification

- Agent context contract passed.
- Exact npm run typecheck passed.
- node scripts/build-collector.mjs passed.
- npm run truth:check passed.
- npm run canary:offline passed: 7/7, 18 requests intercepted locally, zero unexpected URLs.
- npm run calibrate passed: 20/20.
- npm test passed: 400 files, 4,243 passed tests, one expected failure.
- git diff --check passed.
- App shell unchanged; no browser or live paid investigations performed.

## Remaining findings

These are separate work items, not fixed by this change:

1. #358: gap-investigation.ts gives runAudit a deadline of start + budget - 30 seconds; orchestrate.ts then subtracts a fixed 250 seconds. A 240-second run therefore starts with its collection deadline 40 seconds in the past.
2. #353: src/engine/audit.ts builds an incomplete role report with cap_applied null before evaluating caps. Missing evidence can hide an otherwise applicable risk cap.
3. #354: the scoring engine omits token conduct for deferred/not_applicable but does not explicitly enforce provisional treatment. This patch repairs collection and applicability; it does not claim to fix every downstream verdict surface.
4. npm audit reports 16 dependency advisories (one critical, 13 high, two moderate). These are package audit classifications, not an exploitability assessment. Several proposed fixes change major versions; review separately instead of applying npm audit fix --force.

## Durable handoff

Existing edits in /Users/kyle/Documents/ARGUS were left intact. The older handoff is context; its instruction to land presentation PR #351 was not treated as the user's release authorization.

Rollout: review this branch against issue #360, run protected CI, and use the repository's normal release workflow. Existing immutable reports will retain their original evidence; new scans are required to receive corrected coverage. No push, PR publication, merge, deployment, or paid rescan was performed.

Rollback: revert the source changes and the generated api/_collector.js together, or rebuild both collector bundles from the reverted sources.
