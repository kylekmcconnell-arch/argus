# Implementation note: client runtime group (2026-09-14 deep-dive review)

Group E of the 2026-09-14 deep-dive review (`docs/audits/2026-09-14/deep-dive-review.md`,
client lane plus INT-4 from the intelligence lane). Branch
`fix/client-runtime-2026-09-14`, based on `origin/main` at `042a271`.

Scope: the client run state machine, auth gate, persistence and presentation.
No `server/` or `api/` file was edited. `node scripts/build-collector.mjs` was
run after the changes; `api/_collector.js` and `api/_sweep.js` are byte-identical
to the versions on `042a271` (no collector import touches the changed modules).

Every fix below has a regression test that fails on `042a271` and passes on
this branch. Tests that encoded the old behaviour and were changed are listed
per finding.

## F-C1 (P1) Model-suggested site laundered into "the project site"

**Changed**

- `src/lib/investigation.ts`: `Investigation` gains `siteUrlOrigin`
  (`"token-sources" | "model_lead"`) and `siteBinding`
  (`{ origin, status: "bound" | "unbound", via?, note }`). A Grok-suggested
  `website` is recorded as `model_lead`. `resolveSiteBinding` binds a
  model-suggested site only when (a) the rendered page content or the on-chain
  pivot's resolved contract publishes the exact scanned address
  (`contract-on-page`), or (b) the verified project account's
  `official-domain` proof (`/api/x-authenticity` `proof.sourceUrl`) lives on
  that host (`official-account-domain`). `isProjectSiteBound(inv)` is the one
  gate: token-sources sites and frozen investigations without the field read
  as bound; a `model_lead` site is bound only with a recorded binding.
  `deriveFounders` receives `recon` only when bound; `founderNote` for an
  unbound lead says "A model-suggested site (host, unverified) names ...,
  but it does not publish this contract, so those names are leads about an
  unverified site, not the project's claims." The Step 2 milestone is
  labelled "Recon a model-suggested site (unverified)" and Step 2b (deep team
  search) is "Not scheduled" for an unbound lead.
- `src/components/InvestigationReport.tsx` (team-claim provenance only):
  `publishedTeamClaims` skips `source: "site"` founders when the site is not
  bound; `projectDomain` no longer takes `siteUrl` or the site's socials from
  an unbound lead (so Monid basic facts and `domainBoundLeadershipFacts` are
  not scoped to a namesake's domain); the team card falls back to
  `founderNote` instead of the unbound site's `identityLine`.
- `src/App.tsx`: the paid `fetchReconWebTeam` supplement requires
  `isProjectSiteBound(inv)`.

**Tests** `src/lib/investigation.fallback.test.ts` ("model-suggested site
provenance": unbound lead yields no founders / no scheduling; contract-on-page
binds; listing site is `token-sources`), `src/components/InvestigationReport.leadership.test.tsx`
("site-named team provenance"), `src/App.routing.test.tsx` ("never pays for
team discovery against a model-suggested site that did not bind").

**Not changed** the `$SYM site` link in the report header still renders an
unbound lead's URL (presentation outside team-claim provenance); the
`api/token-identity` response is unchanged.

## F-C2 (P2) AuthGate unmounts the App on every token refresh

**Changed** `src/auth.tsx`: `loadProfile` throws `SessionValidationError`
carrying the HTTP status; `sessionAccessRevoked(error)` is true only for
401/403. `validate` keeps the App mounted (no `setProfile(null)` /
`setLoading(true)`) when a member profile is already loaded for the same
`session.user.id`, re-validates in the background, and on failure tears down
only for an explicit 401/403; an outage (timeout, 5xx) keeps the verified
session and the next auth event re-validates. A different user id or a
sign-out still re-gates. `shouldRevalidateSession` is unchanged (a refreshed
token is still re-validated, just not destructively).

**Tests** `src/auth.test.tsx` (new): same-user `TOKEN_REFRESHED` keeps
`APP-MOUNTED` with one mount; outage keeps the session; 403 withdraws access;
another user re-gates; sign-out unmounts.

## F-C3 (P2) Stream drop declared "nothing was saved" in ~6 s, retry relaunches a paid audit

**Changed**

- `src/lib/live.ts`: `onError(err, failure?)` now carries
  `{ kind: "rejected" | "stream_dropped" }`. Non-OK responses and `error`
  events are `rejected`; the inactivity watchdog, an early stream close and a
  network exception are `stream_dropped`.
- `src/lib/runner.ts`: `BgRun.errorKind`, `BgRun.serverDeadlineAt`
  (`startedAt + DEEP_INVESTIGATION_MAX_DURATION_SECONDS`), and
  `streamDropRecoveryDeadline(run)` (server deadline plus 45 s persistence
  grace).
- `src/App.tsx`: `recoverPersonRun(ref)` replaces the fixed 4-poll loop. A
  `rejected` run keeps the short poll and the `rescan-failed` notice with
  "Run the scan again". A `stream_dropped` run immediately shows the new
  `stream-dropped` notice ("The connection dropped; the server is still
  collecting ... No second scan was launched and no additional credit was
  used"), polls with backoff (1.5 s x4, then 5 s -> 15 s) until the recovery
  deadline, and opens the newer version when it lands. Its primary button
  ("Check for the saved report now") re-attaches by polling; the relaunch
  offer appears only after the deadline passes.

**Tests** `src/App.routing.test.tsx` ("treats a dropped stream as still
collecting and re-attaches to the version the server saves later", "offers a
relaunch only once the disconnected run's server budget has passed"). The
existing rejected-run tests are unchanged. The routing test's `./lib/runner`
mock gained `streamDropRecoveryDeadline`.

**Server note (not changed here)** `api/audit.ts` has no dedupe for a second
concurrent audit of the same handle. The client now avoids launching one
while a dropped run may still be alive; a server-side idempotency guard
(reject or re-attach when a run for the same subject and credit window is in
flight) would close the remaining window where an analyst relaunches from
another tab.

## F-C4 (P2) Running scans invisible from other entry points (ref forms)

**Changed** `src/lib/scanrunner.ts`: `scanRunMatchesRef(run, ref)` and
`findScanRun` are the one canonicalizer. A run matches when its key, raw
input or `canonicalRef` equals the normalized lookup, or when the address
component of either form (bare or `chain:address`) is the same contract.
Lookups prefer an in-flight run, then the exact key, then the newest match.
`ScanRun.canonicalRef` is bound from the collector's resolved
`(chain, address)` on completion (`bindCanonicalRef`), so a DexScreener-URL
run is later found by `solana:<mint>` or the bare mint. `cancelScanRun` uses
the same finder.

**Tests** `src/lib/scanrunner.test.ts` ("run lookup across subject ref forms").

**Limitation** a DexScreener-URL run is re-keyed only when the collector
completes; mid-run it still matches by URL only (the collector does not expose
the resolved subject before completion).

## F-C5 (P3) Startup rail reconciliation never matched token rows

**Changed** `src/lib/auditlog.ts`: `sameAuditRef(left, right)` normalizes with
`normalizeSubjectRef` and compares the address component when exactly one
side is chain-qualified; the same address on two different chains remains two
subjects. `reconcileAuditOutcome` uses it.

**Tests** `src/lib/auditlog.test.ts` ("reconciles a bare-address token row
from the server's chain-qualified ref", "folds the active projection into a
bare-address row when no qualified row exists").

## F-C6 (P3) Refused credit reservation receipted as `collection_failed`, 1 credit

**Changed** `src/lib/scanrunner.ts`: `reserveCredit` has its own catch and
receipts `failureCode: "credit_reservation_failed"` with
`creditsCharged: run.chargedCredits` (0 until the server confirms a charge);
no provider is started. `src/lib/scanReceipts.ts`: `creditsCharged` is a
field (defaults to 1 for callers that do not pass it, which are the successful
persisted runs in `App.tsx`).

**Tests** `src/lib/scanrunner.test.ts` ("credit reservation receipts"),
`src/lib/scanReceipts.test.ts` ("reports zero charged credits").

**Server note (not changed here)** `api/scan-receipt.ts:40` still hardcodes
`creditsCharged: 1` when it records the receipt; it should read
`body.creditsCharged` (bounded to a non-negative integer) so the ledger
matches the client receipt.

## F-C7 (P3) Threat leg race relaunches a second unbounded scan; cancel never aborts it

**Changed** `src/lib/runner.ts`: a per-run `AbortController` is passed to
`threatScan`; `raceThreatLeg` aborts the leg at the 120 s wall clock instead
of abandoning it; the forced retry runs only when the first leg actually
settled empty (`threatSettled && !aborted`), has its own controller and the
same wall clock; `cancelRun` aborts the stream and both threat controllers.
`src/threat/scan.ts` (shared file, minimal edit): `options.signal` is
accepted and passed to `auditToken`.

**Tests** `src/lib/runner.token-leg.test.ts` ("aborts a merely slow threat leg
at the wall clock instead of overlapping it with a forced retry", "stops the
threat leg when the run is cancelled"). Two existing assertions in that file
now expect the third `{ signal }` argument.

## F-C8 (P3) Unbounded fetches leave a run "running" forever

**Changed** `src/lib/investigationCredits.ts` accepts `{ signal }`;
`src/lib/scanrunner.ts` passes `AbortSignal.timeout(15_000)`
(`CREDIT_RESERVATION_TIMEOUT_MS`). `src/lib/investigation.ts`
`fetchDeployerTrail` is bounded by `DEPLOYER_TRAIL_TIMEOUT_MS` (30 s) combined
with the investigation's abort signal.

**Tests** `src/lib/scanrunner.test.ts` (the reservation assertion now requires
an `AbortSignal`).

**Skipped** a generic "no step for N seconds" watchdog in the investigation
runner. Every remaining await inside `streamInvestigation` is already bounded
(token audit deadline, token-identity 40 s, x-authenticity 25 s, the embedded
person stream's inactivity watchdog); a second blanket timer would race the
legitimate long embedded audit and needs a product decision on the number.

## F-C9 (P3) `onOpenRecent` evicts a just-persisted result

**Changed** `src/App.tsx`: in the `open && !report` branch, a session result
with `persistence.state === "persisted"` is shown like a pending one instead
of being cleared.

**Tests** `src/App.routing.test.tsx` ("keeps a just-persisted session result
when the durable projection lags behind activation").

## F-C10 (P3) Shared watchlist merges unvalidated rows

**Changed** `src/lib/watchlist.ts`: `parseSharedWatchItem` validates `id`,
`kind`, `label`, `snapshot.verdict` and the optional numeric fields;
`hydrateSharedWatchlist` drops malformed rows before saving.

**Tests** `src/lib/watchlist.hydrate.test.ts` (new).

## INT-4 (P1) Browser graph cache not organization-scoped

**Changed** `src/graph/store.ts`: the cache is keyed
`argus:graphstore:<organizationId>`; every stored row is stamped with
`organizationId`; `getContributions()` returns only rows stamped with the
current org; `hydrateCommunityGraph` runs once per bound org and backfills
only those rows (stamp stripped from the POST body); the pre-tenancy
`argus:graphstore` key is never read and is removed once an org binds.
`setGraphStoreOrganization` / `clearGraphStoreForSignOut` /
`graphStoreOrganization` are new exports. `src/App.tsx` binds the store to
`useArgusAuth().organizationId` before hydrating (an org change rebinds and
re-hydrates). `src/auth.tsx` `signOut` clears the cache.

**Tests** `src/graph/store.tenancy.test.ts` (new). The routing test's
`./graph/store` mock gained `setGraphStoreOrganization`; `src/auth.test.tsx`
mocks `./graph/store`.

**Behaviour note** an analyst's pre-existing local-only contributions under
the old unscoped key are not migrated (they cannot be attributed to a tenant);
the shared graph already holds every contribution whose POST landed.

## Shared-file edits other groups should know about

- `src/threat/scan.ts`: `threatScan(input, emit, options)` accepts
  `options.signal?: AbortSignal` and forwards it to `auditToken`. Two lines.
- `src/lib/live.ts`: `LiveHandlers.onError` has an optional second argument
  (`LiveFailure`); existing callers compile unchanged.
- `src/lib/investigationCredits.ts`: optional seventh `options` argument.
- `src/lib/scanReceipts.ts`: optional `creditsCharged` field.

## Verification

`npm run quality`, `npm run build`, `git diff --check` and
`node scripts/validate-agent-context.mjs` output tails are in the pull
request body.
