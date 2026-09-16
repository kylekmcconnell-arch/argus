# Implementation note: API spend, receipts and tenancy (group F)

Tracks the 2026-09-14 deep-dive review (`docs/audits/2026-09-14/deep-dive-review.md`,
lanes `findings-api.md` 1-13 and `findings-orchestrate.md` 2, 3, 4, 6, 7, 8, 9).
Branch `fix/api-spend-tenancy-2026-09-14`, based on `042a271`. The audit stays
an immutable description of the reviewed baseline; this note describes what the
repaired system does. No migration was added.

## Credit reservation contract (API-1, P1)

The debit (`consume_investigation_credit`, idempotent on the key) and the
receipt claim (`scan_run_receipts`, insert-only on `(organization_id, run_key)`)
remain two calls, but the key is now the whole unit of work and no path between
them can orphan a credit:

- `POST /api/investigation-credit` validates everything the receipt write would
  refuse (run key shape, non-empty refs, parseable `startedAt`) BEFORE the debit
  (`api/_scanReceipts.ts` `scanReceiptClaimInputValid`). A malformed start time
  used to debit and then fail the claim.
- Same analyst, same key, claim `duplicate` (lost HTTP response, browser
  reload): the debit replayed without a second charge and the route answers
  **200** `{ allowed, replayed: true, receiptStatus, reportVersionId }` instead
  of 409. The paid reservation is usable again.
- Another analyst's run owns the key: this user's debit can never be spent
  under it, so it is reversed with one idempotent `refund` ledger row
  (`api/_auth.ts` `refundInvestigationCredit`, key
  `refund:investigation:<user>:<key>`) and the route answers 409
  `scan_run_already_claimed` with `creditState: "refunded" | "held"`.
- Claim store `unavailable` after a successful debit: **no refund**. The credit
  is held on the key and the route says so (503 `scan_run_claim_unavailable`,
  `creditState: "held"`, message "retrying it will not charge again"). A refund
  here would let a same-key retry run for free, because the debit RPC replays
  on the key; holding it means the retry with the same key claims the receipt
  without a second charge.
- Only a ledger failure (`credit_ledger_unavailable`, `creditState: "none"`)
  carries the "no credit was taken" sentence.

**Client contract (owned by the client group):** persist `creditKey` on the
run and reuse it on every retry of the reservation; only show "no credit was
taken" when the server says `creditState: "none"`; treat `replayed: true` as a
successful reservation. The server is tolerant of a client that still mints a
new key per retry: that client is charged for the new run as before, and the
earlier key's credit stays held (it is no longer refundable by design, and the
receipt surfaces as stalled in `/api/scan-operations`).

`/api/v1/token` follows the same rules; `/api/audit` keeps 409 on duplicate
because the SSE run cannot be handed back, and its same-key debit is already
idempotent.

Tests: `api/investigation-credit.test.ts`, `api/_scanReceipts.test.ts`,
`api/_auth.quota.test.ts` (refund row), `api/v1/token.test.ts`.

## Supplemental budget after validation (API-2, API-10, API-11)

- `middleware.ts` no longer reserves the daily supplemental unit for
  `/api/ask` and `/api/reclassify` (`HANDLER_METERED_SUPPLEMENTAL_PATHS`). Those
  handlers call `reserveSupplementalBudget` (`api/_auth.ts`, same RPC and limit
  as the middleware) after every validation step and immediately before the
  model call. 409 malformed ids, 404 missing versions, clarification-only turns
  and empty subject lists now cost nothing. `ARGUS_SUPPLEMENTAL_DAILY_LIMIT`
  empty is treated as unset (100).
- Provider failures still consume the unit (there is no release RPC and
  `usage_events.units` is `>= 0`, so a release needs a migration); they now
  answer **503** `analyst_provider_unavailable` (and 502 `ask_failed` /
  `reclassify_failed`) instead of 200. The Argus Eye client reads `note` from
  the body regardless of status; the admin reclassify client reads `error`.
- Other supplemental routes (x-find, arkham, ...) keep the middleware
  reservation; they belong to other groups and can adopt the helper the same
  way. The middleware test that encoded the pre-reservation for `/api/ask` was
  changed to assert the handler-metered path and now exercises `/api/x-find`.
- API-11 (one-shot scan-supplement claim burned by a transient 503) is
  **skipped**: allowing a re-claim while the receipt is `running` changes
  `claim_scan_supplement` (migration) or moves the claim into
  `/api/social-activity` and `/api/x-authenticity`, which this group does not
  own.

Tests: `middleware.test.ts`, `api/ask.test.ts`, `api/reclassify.test.ts`,
`api/_auth.quota.test.ts`.

## Argus Eye coverage answers (API-4)

`coverage_record` is now validated structurally like the URL allowlist
(`api/ask.ts` `validateCoverageRecord`): the packet must actually hold a
coverage record (readiness not `ready` or at least one gap), the answer must be
pinned to a frozen gap through `coverageCheckIds` (prompted for; each must be a
`readiness.gaps` checkId) or by naming a gap checkId/label in the text, and
verdict/clearance language ("verified safe", "all checks succeeded", "no risk",
"is cleared" ...) is refused. The response carries `coverageCheckIds` and
`receiptCompleteness.citations` is true for a coverage answer only when it is
pinned. The two existing coverage tests that answered without any gap reference
now pass `coverageCheckIds`; they encoded the unpinned behaviour.

## Legacy identity and stable error codes (API-3, API-13/#383)

`api/report.ts` maps the RPC's `legacy token identity needs reconciliation`
to **409** `legacy_identity_reconciliation_required` with `retryable: false`
(the client retries only 502), and the generic catch returns
`report_store_failed` with a fixed message instead of `String(error)` with
PostgREST body slices. The reconciliation RPC and owner UI the lane proposes
are a product decision and a migration; **skipped** and left for the lead.
`api/graph.ts` and `api/auditlog.ts` (#383) are not owned by this group.

## `/api/v1/token` replay scope (API-5)

The idempotent replay lookup adds `initiated_by=eq.<userId>`; another analyst
presenting the same key gets no free result, falls through to their own
debit, collides on the claim, is refunded and gets 409.

## Members directory (API-6)

`api/members.ts` pages `auth.admin.listUsers` until the directory ends (cap 50
pages of 1000) for the roster, finds an invitee by paging until matched, and
edits a member by `auth.admin.getUserById`. Members past the first 1000 auth
users have their email, can be re-invited and can be edited.

## Shared report privacy (API-7)

`api/shared-report.ts` `sanitizeSharedReport` sets `contributor: "shared"` and
`query` to the canonical ref; the analyst's display name (email local-part by
default) and raw search text no longer reach anonymous recipients.
`SharedReportView` reads neither field.

## Reclassify hardening (API-8)

`api/reclassify.ts` verifies owner access in the handler, parses the body
inside a guard (400 `invalid_json_body`), reserves the supplemental unit after
validation, and returns stable codes. The other identity-less panel routes the
lane lists are owned by other groups.

## List truncation flags (API-9)

`GET /api/report?list`, `?list&status=archived` and `?watches` return
`truncated: true` when the page is full (200/200/100). `graph`, `auditlog` and
`alerts` are not owned by this group. One report test that asserted the exact
body was updated to include `truncated: false`.

## Migration hygiene (API-12)

**Skipped.** The idempotency of an already-applied migration and the
`consume_usage_quota` day-boundary timezone are migration changes.

## Private runs leave no shared trace (OR-2)

`RunAuditOptions.privateRun` (also in `api/_collector.d.ts`); `api/audit.ts`
passes the request flag; the knowledge-base write-back is extracted to
`writeVerifiedEntityFacts` and skips private runs. `readPriorOutcome` still
runs (read-only, no trace). The embedded project-account audit inside token
investigations is private by request flag and is therefore excluded too, as the
lane suggested.

## Watchlist sweep (OR-3)

`server/sweep.ts` reads `SUPABASE_SECRET_KEY` first and omits `Bearer` for
`sb_secret_*` keys (same order and header rule as `api/_auth.ts`), reports
`unavailable: true` when no backend is configured (the route answers 503
`sweep_backend_unavailable` instead of a 200 clean sweep), accepts a
`deadlineAt` from the route (120 s ceiling minus a 15 s finalization reserve),
defers token checks once fewer than 20 s remain (ring checks still run for
every watch) and reports `deferred`, passes a bounded `deadlineAt` to each
`auditToken`, and runs inside its own `withCostLedger`, returning `cost` in the
result. Attributing that ledger to a `provider_usage_events` row is not done:
`recordProviderUsageBatch` requires a report version id and a sweep has none.
The route returns `sweep_failed` instead of `String(e)`.

## Scoped gap runs skip the unscoped intake (OR-4)

`coldIntakeAuthorized(scope)` gates `coldIntake(ctx, true)` in the intake
region: a scope authorizing none of `COLD_INTAKE_CAPABILITIES`
(role/identity resolution, people and control, project fundamentals,
portfolio and outcomes, network connections, counter-evidence) resolves the
profile and goes straight to the authorized adapters, emitting a
"Discovery intake skipped" step. Untouched evidence carries forward through
the existing scoped-follow-up merge (#407). Scopes that authorize any discovery
capability run the intake unchanged; gating the sub-waves individually lives in
`coldIntake` itself, which other groups own.

## Provider deadline tail writes (OR-6)

`withProviderDeadline` aborts only from its timer; a detached `void cacheSet`
started as the adapter's last act now completes (it carries its own timeout).

## Ledger status semantics (OR-7)

`aggregateStatus` (now exported) counts cached attempts as successes: a line
mixing live and cached reads is `succeeded`, only an all-cached line is
`cached`. `api/audit.ts` marks a receipt `degraded/provider_incomplete` only on
a terminal failure (`status: "failed"` with `failed > 0`), the same rule as
`providerFailureLines`. The Grok spend-ceiling phantom call lives in
`server/adapters/x.ts` (other group).

## Incident dedup (OR-8)

`recordProtocolSecurityIncidentFindings` dedups on the finding claim, which is
built from the incident row (date, amount, classification, technique,
recovery), so two undated or same-day incidents are two findings and a re-run
is still idempotent.

## Scoped Arkham (OR-9)

`ADAPTER_DELEGATES` (exported) gains `arkham: ["wallet-graph", "arkham"]`; a
structural test asserts every registered adapter has a delegate mapping. The
server-side token deployer legs (injecting deployer-risk/resolve-deployer
implementations into the gap route) are **skipped**: medium confidence and
they depend on the forensic panel routes other groups own.

## Regression tests

Every fix above has a test next to the file that fails on `042a271`:
`api/investigation-credit.test.ts`, `api/_scanReceipts.test.ts`,
`api/_auth.quota.test.ts`, `api/v1/token.test.ts`, `middleware.test.ts`,
`api/ask.test.ts`, `api/reclassify.test.ts`, `api/report.test.ts`,
`api/members.test.ts`, `api/shared-report.test.ts`, `api/audit.test.ts`,
`api/sweep.test.ts`, `server/sweep.test.ts`, `server/cost.test.ts`,
`server/providerDeadline.test.ts`, `server/orchestrate.incident.test.ts`,
`server/orchestrate.scope-gates.test.ts`.

Existing tests changed because they encoded the old behaviour: the two
`/api/ask` middleware pre-reservation cases (now `/api/x-find`), the two
coverage-record Eye answers (now pinned to a gap), the archived-report exact
body (`truncated: false`), the members PUT/POST mocks (now `getUserById` and
paged `listUsers`), and the sweep route organization assertion (now also the
deadline).

## Shared-file edits other groups should know about

- `api/_collector.d.ts`: `privateRun?: boolean` on `runAudit` options.
- `server/orchestrate.ts`: only the four regions this group owns (options
  type plus the two exported gates next to it, intake gate, incident dedup,
  entity-facts write); `ADAPTER_DELEGATES`, `COLD_INTAKE_CAPABILITIES`,
  `coldIntakeAuthorized` and `writeVerifiedEntityFacts` are new exports.
- `server/cost.ts`: `aggregateStatus` exported.
- Generated bundles `api/_collector.js` and `api/_sweep.js` regenerated.

## Rollout and rollback

No migration. Revert the PR to roll back; bundles regenerate from source. The
credit contract is backward compatible with the current client.
