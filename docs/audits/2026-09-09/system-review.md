# ARGUS reliability, data quality, and logic review

Reviewed 2026-09-09 against `1828156f30248252f704bc36f4e259d9575b2ed6` (production/main, PR #389). Review branch: `codex/system-review-20260909`.

## Assessment

The main problem is inconsistent treatment of uncertainty across independently implemented paths. Person/project scoring now supports assessed-evidence provisional scores, but token scoring, some threat outcomes, public API fields, and presentation fallbacks still convert missing information into points, zeros, completed checks, or reassuring prose. Passing the existing suite does not cover these cross-layer contradictions.

This review identifies **17 actionable findings**, including **14 controlled reproductions** covering 13 findings. The other findings are supported by direct control-flow inspection. Several findings concern related variants of the same underlying defect; the counts are not independent failure-rate measurements. These are verified behaviors or code-level guarantees, not a claim that all occurred in production.

No application code, migrations, customer records, provider configuration, branch protection, or deployed software was changed by this review. No paid live investigation was launched. Evidence below uses artificial fixtures and aggregate production reads.

## Preserve existing work

GitHub and remote branches were inspected before review. There were no open Enigma PRs at that snapshot. The only open PR was #311, removal of unreliable notable followers; continue that PR rather than recreate it. Unpublished local work on another machine is outside this snapshot.

| Existing repair | Preserve when implementing findings |
| --- | --- |
| Enigma #389: laptop document gutter | Keep `.af-doc` padding and the 1020px border-box limit. |
| Enigma #387: graph pan state/ref crash | Keep captured drag values; do not restore lazy reads of mutable refs. |
| #351: common Production/Developer presentation | Keep two views and one common renderer; fixes belong in that shared presentation. |
| #385: assessed-evidence scoring, strict identity binding, burns measured-empty, guarded web fetches | Preserve risk caps, unknown-versus-empty distinctions, the empty-burn early return, and public-web protections. |
| #388: Arkham per-address outcomes, Basic Facts collection completion, deployer no-data semantics | Keep these contracts; avoid reverting to global provider completion or treating no verified facts as an outage. |
| #388: tenant-scoped threat ledger, base58 restoration, cross-workspace due queue | Extend chain identity and client normalization without removing organization scoping, retry deferral, or restored capitalization. |
| Enigma #314: generic chart posture | Keep the generic presentation; strengthen asset binding behind it. |
| Owner decision: no personal approval gates | Retain automated release checks; do not restore Kyle/Enigma approval requirements. |

## Verification and production evidence

- Baseline: **409 test files, 4,332 passing tests, one expected failure**. Typecheck, source-of-truth contract, 20/20 calibration, and 7/7 offline canary passed.
- An additional **14 local diagnostic tests passed**, asserting the problematic behavior in the current implementation. All external calls were mocked. The fixture is preserved in `reproductions.test.ts.txt`; it is deliberately excluded from normal CI.
- Production dependency audit: zero reported production vulnerabilities at review time. This is not a security certification.
- Vercel's last-24-hour aggregate query returned no 5xx rows. The runtime error tool returned the existing `DEP0169 url.parse()` warning on `/api/shared-report`. Sparse traffic and logs cannot establish collection correctness or latency under load.
- Read-only database snapshot: **86 latest-per-case reports: 22 complete, 64 partial; 12 have null scores**. All 12 null scores are among the 17 partial, server-collected person-kind reports. Person-kind storage also includes project/account investigations; these are not necessarily 12 individual people.
- **Zero of those latest reports were created after 2026-09-08 17:40 UTC**, the final release boundary used for this audit. Deployment does not backfill frozen evidence or repair old results.
- Last seven days of scan receipts: only four rows, three degraded `/api/audit` runs and one complete `/app/scan` run. The degraded API runs averaged 198.7 seconds, maximum 246 seconds; one lacked a report version. This is too small and old a sample for a current-release failure rate or latency percentile.
- Common missing checks in the latest-report corpus include legal history, name sanctions, funding/operator traces, founder identity/track record, and token simulation. Some are optional, role-dependent, or historical; raw `not_run` counts must not be treated as mandatory failures.
- The existing `audit:reports` CLI could not run because this isolated checkout has no local Supabase service credential. Aggregate queries used the authenticated read-only connector instead. No claim is made that the full historical payload corpus passed semantic verification.

## Findings

Priority **P1** means correct before relying on the affected conclusion or increasing usage. **P2** means a functional or reliability defect to schedule next. Neither denotes a demonstrated production incident.

### F01 · P1 · Token scores still award points to unmeasured axes

**Evidence:** `src/token/audit.ts:1074`, `1093`, `1107`, `1150`.

An unavailable safety source produces 9/26 contract points, 6/12 tradeability points, and a default holder score. All axis weights remain in the 100-point total. The controlled missing-safety fixture gave `[9, 6, 3]` on those three unmeasured axes. This is incompatible with the approved policy of scoring the evidence actually assessed: it both invents credit and depresses the score compared with excluding unassessed weight.

**Repair:** Add assessed/applicability metadata to token axes and normalize over assessed weight, following the person/project contract. Keep hard risk caps and identity blocks dominant. Report a provisional score plus assessed weight and named gaps; no numeric score when nothing was assessed.

**Acceptance:** Disabling a provider must not inject preset points; recovery must add measured evidence rather than an unexplained baseline shift. Cover EVM, Solana, and unsupported chains.

### F02 · P1 · A present but empty safety payload becomes assessed contract data

**Evidence:** `src/token/audit.ts:435–436`, `1093`; `src/lib/scanChecklist.ts:277`.

`available: !!gp || !!s` and `contractPropertiesAssessed: !!gp` depend on object presence. A valid envelope containing an empty GoPlus object marks contract properties assessed and awards all 12 tax points. The checklist uses `safety.available`, so even a simulation-only payload can become a recorded contract-safety outcome without the contract-property source.

**Repair:** Validate individual safety capabilities and measured fields. Unknown taxes must remain unknown; simulation completion, contract properties, authorities, holders, and LP state need separate coverage. A successful HTTP envelope is not a completed capability.

**Acceptance:** Empty, partial, malformed, simulation-only, and full responses have distinct checklist and scoring outcomes. Do not regress the existing tradeability-method distinction.

### F03 · P1 · Exact-contract selection can silently switch to another asset

**Evidence:** `src/token/sources.ts:353–364`; `src/token/audit.ts:601–615`.

When `pickPair(pairs, wantedAddress)` finds no matching base token, it returns the deepest pair anyway. The audit then adopts that pair's base-token address. The fixture requested one address that appeared as the quote token and received another base token. This also fails closed poorly for a mismatched provider response.

**Repair:** Separate exploratory pair selection from exact-token resolution. Exact requests must return a validated requested asset, properly handle quote orientation if supported, and otherwise return an explicit unresolved binding. Carry chain through selection.

**Acceptance:** Quote-side pairs, unrelated pairs, case-normalized EVM matches, and case-sensitive Solana matches cannot silently change the requested subject.

### F04 · P1 · Threat identity omits chain in both storage and market rechecks

**Evidence:** `api/_ledger.js:45`, `125`; `api/threat-recheck.ts:21–29`, `82`.

Database conflict identity is organization + address + kind, not chain. Two same-address EVM tokens on different chains overwrite the same receipt/alert key. The recheck then fetches by address and takes maximum liquidity across all returned chains. The fixture with Ethereum liquidity $0 and Base liquidity $50,000 classified the Ethereum receipt alive and emitted no collapse alert.

**Repair:** Adopt a canonical `(chain, address)` identity for receipt, alert, holder-edge, and deployer-memory joins, under the existing organization scope. Filter provider pairs by chain and exact token. Migration must use preserved payload chain/address, quarantine ambiguous legacy rows, and avoid guessing.

**Acceptance:** Same-address Ethereum/Base cases remain separate through scan, persist, recheck, alert deduplication, and reload. Existing tenant-isolation tests must continue passing.

### F05 · P1 · Omitted liquidity can create a false collapse alert

**Evidence:** `api/threat-recheck.ts:29`, `89–105`; client analogue `src/threat/receipts.ts:91–104`.

A pair without `liquidity.usd` is coerced to zero. The controlled server fixture marked a previously $10,000 market dead and emitted an alert even though no new liquidity value was measured. Client rechecks also collapse provider failures to an absent pair and then zero.

**Repair:** Parse a typed market outcome: measured positive, measured zero, confirmed no-pair, unavailable, or malformed. Missing/non-finite liquidity preserves the last measured observation and records a failed refresh. Do not infer an asset's disappearance from a transport failure.

**Acceptance:** Missing fields, null, malformed values, HTTP failures, genuine zero liquidity, and confirmed no-pair responses remain distinct, on both server and client.

### F06 · P1 · Client threat memory still folds case-sensitive Solana identities

**Evidence:** `src/threat/receipts.ts:35`, `57–58`, `75`, `100`; `src/threat/scan.ts:211`.

The server restoration preserved base58 case, but client record/deduplication/deployer matching still lowercases all addresses. A fixture returning two case-distinct Solana mint strings merged them into one receipt. This can contaminate or suppress the historical evidence used in a later threat scan.

**Repair:** Use a shared chain-aware address key everywhere, preserving exact base58. Include chain in deduplication and deployer comparisons. Do not reverse #388's data restoration.

**Acceptance:** Case-distinct Solana addresses remain distinct; EVM case variants remain equivalent only within the same chain.

### F07 · P1 · The daily paid-request allowance does not cover every paid entry point

**Evidence:** `middleware.ts:42–49`, `231`; `api/social-activity.ts:21–36`; `server/socialActivity.ts:211–228`, `616–653`.

An authenticated standalone `/api/social-activity` request reaches the collector without a supplemental reservation or investigation-credit check. The middleware fixture confirmed zero quota RPCs. A caller can vary handles to avoid cache reuse. `/api/find-wallet` and `/api/x-authenticity` also reach configured paid X providers without entries in the supplemental route set; these need the same route-policy review.

**Repair:** One explicit route/capability cost policy should classify every provider-backed endpoint. Standalone calls reserve supplemental allowance; required scan-internal calls need a scoped run authorization so charging them does not double-debit the investigation.

**Acceptance:** After 100 admitted supplemental requests, all paid standalone surfaces reject further work; required work already covered by a scan reservation remains functional. Keep `/api/augment` POST's existing budget check.

### F08 · P1 · The common report can deny gaps its own coverage display shows

**Evidence:** `src/reports/kyle/KyleIntelligenceDecisionCanvas.tsx:301`, `670`.

An empty `nextSteps` list produces “No required check remains open” and “No checks remain open” regardless of incomplete check counts. The rendering fixture reproduced both strings with 2/4 checks complete. This is in the presentation promoted by #351, not Enigma's gutter repair.

**Repair:** Derive completion statements from the canonical required-check ledger. If tasks are missing but checks are open, say which checks lack evidence or that next steps were not recorded. Preserve available scores and the provisional label.

**Acceptance:** Person, project, token, public, and Developer views never claim all checks complete when required coverage is partial or unknown. Add assertions against contradictory copy, not just presence of a score pill.

### F09 · P2 · A DEX outage is reported as token-not-found

**Evidence:** `src/token/sources.ts:171–186`; `src/token/audit.ts:602–610`; `api/v1/token.ts:82–92`.

The typed source result contains `ok`, but `dexByToken` discards it. A 503 fixture returned the same null dossier as no market. The API then returns 404 “no DEX pair found.” Null is cached for 60 seconds by `auditToken`. A temporary outage looks like a nonexistent token and can suppress an immediate retry.

**Repair:** Preserve unavailable versus measured-empty through the collector and API, use retryable 503/explicit degraded results for outages, and do not negative-cache transport failures. A no-market token should still expose any independently assessed contract data where supported.

**Acceptance:** 429/503, invalid payload, genuine empty response, and recovery have distinct responses and cache behavior.

### F10 · P2 · Token gap investigations report unknown provider cost as zero

**Evidence:** `api/gap-investigation.ts:387–391`, `452`, `470–471`.

For token gaps `personDossier` is null by construction; cost is read only from that variable. Consequently the response reports `observedCostUsd: 0`, empty cost metadata, and `within_estimate` even when token social collection performs paid work. This is directly established by the control flow, not a measured billing incident.

**Repair:** Give both collectors a common usage ledger. Until available, report unknown cost rather than zero and do not claim compliance with an estimate on missing measurements. Reconcile physical calls and cached reads without double counting.

**Acceptance:** A token gap with one paid provider call records its actual/estimated cost; missing telemetry is explicitly unknown.

### F11 · P2 · The token gap timeout does not cancel the collector

**Evidence:** `api/gap-investigation.ts:352–370`; token collector options `src/token/audit.ts:565–567`.

`Promise.race` rejects the caller after the time budget but does not abort the losing `auditToken` promise. No abort signal/deadline is passed to the collector. It may continue starting downstream calls or populate its cache after the proposal has been marked failed. The previous bounded audit/Moni fixes did not cover this path.

**Repair:** Propagate a shared AbortSignal and absolute deadline through token providers, retries, social collection, and cache publication. Reserve finalization time and reject work before it starts after expiry.

**Acceptance:** With a delayed mocked provider, expiring/canceling a gap produces no subsequent provider starts, cache publication, or proposal writes. Full person/project adapters also need deadline propagation; see operational improvements below.

### F12 · P2 · Browser API clients cannot use the documented idempotency header

**Evidence:** `middleware.ts:79`; `api/v1/person.ts:25`; `api/v1/token.ts:26`.

Middleware terminates OPTIONS before the API's CORS handler. It allows Authorization and Content-Type but omits Idempotency-Key. The allowed-origin preflight fixture reproduced the omission, so browsers reject the request before the handler can use its replay protection.

**Repair:** Centralize allowed CORS headers and include Idempotency-Key on the supported API routes. Preserve the origin allowlist.

**Acceptance:** A permitted-origin browser request using an idempotency key succeeds; an unpermitted origin is not granted access.

### F13 · P2 · Manual owner threat rechecks are unreachable in production

**Evidence:** `middleware.ts:96–105`; `api/threat-recheck.ts:58–67`.

The handler supports an authenticated owner with organization scope, but middleware accepts only the cron secret for that path. The fixture confirmed an owner JWT receives 401 before any user lookup. The #388 handler-only test therefore passes while the composed route does not work.

**Repair:** Admit the cron secret to global queue mode; otherwise perform ordinary owner authentication and limit the handler to that owner's workspace. Keep both paths independently enforced.

**Acceptance:** An integration test runs middleware and handler together for cron, owner, analyst, and anonymous callers. No owner request may obtain global scope.

### F14 · P2 · Chart posture lacks exact asset binding

**Evidence:** `api/technical-posture.ts:98–112`, `133–145`.

The route takes ticker and optional cap, with no contract/chain identifier. The cap guard explicitly accepts rows whose feed cap is absent. A fixture with an unbound same-ticker row and no feed cap produced `covered:true` and a bullish reading. Similar caps also do not prove identity.

**Repair:** Bind the chart feed to a verified exchange instrument/asset registry and the scanned chain/address. Unbound ticker matches may be shown as discovery candidates, not the scanned token's technical reading.

**Acceptance:** Same-symbol unrelated assets, absent cap, and similar-cap namesakes never inherit each other's signals. Keep the generic chart language introduced by Enigma.

### F15 · P2 · The public token API can label FDV as market cap

**Evidence:** `src/token/audit.ts:619`, `1284–1287`; `api/v1/token.ts:119`.

The dossier keeps a fallback numeric `mcap` plus a `marketEvidence.mcap` flag. The API publishes `d.mcap` as `market.marketCap` without that flag or separate FDV. A fixture with only $100m FDV produced `d.mcap=100m` with `marketEvidence.mcap=false`; the API consumer cannot distinguish it from measured circulating market cap.

**Repair:** Respect measured flags in serialized public fields; publish `marketCap:null`, separate `fullyDilutedValuation`, and provenance/coverage. Apply the same rule to absent volume/liquidity values.

**Acceptance:** FDV-only and market-cap-only fixtures remain distinguishable in browser, API, export, and share surfaces.

### F16 · P2 · Token API results lack the immutable version path used by person API

**Evidence:** `api/v1/token.ts:94–128` versus `api/v1/person.ts:183–194`.

The token API records a receipt and returns a dossier-derived response but never persists a report version or links one in the receipt. The person API does. For a lost token API response, the existing run key is claimed while “open its saved result” offers no version created by this path. This is a durability/API-parity gap; no recent production token API traffic was observed to quantify it.

**Repair:** Persist an immutable token version with checks and cost before reporting completion; return its version ID and support retrieving the result for the same completed idempotency key. Define whether private API runs persist privately or are explicitly ephemeral.

**Acceptance:** A completed token API call can be recovered after the client disconnects without repeating provider work or charging another credit.

### F17 · P2 · The report-quality audit omits important report types and can silently truncate

**Evidence:** `scripts/report-quality-audit.ts:53–54`, `91–101`.

Cases and versions are independently limited to 1,000; versions are ordered by case ID rather than latest-per-case. Larger corpora can omit cases while earlier cases consume the version limit. Findings are then counted only for `server_collected` reports. The current 86-report aggregate has 32 in that attestation class; other app-saved token/investigation reports are outside those final counts. Subject-label matching also replaces exact case identity when selecting the filtered results.

**Repair:** Query latest/active versions explicitly with stable pagination and retain case/version IDs through the audit. Evaluate every supported report kind, stratifying results by attestation rather than excluding most kinds. Report omitted/skipped counts and fail closed on truncation.

**Acceptance:** More than 1,000 versions, duplicate display names, token/investigation reports, and cases without versions remain accounted for. A zero-error summary must name its denominator and exclusions.

## Operational and data-gap improvements

1. **Refresh old evidence deliberately.** Mark report collection/methodology versions and show when a fix warrants a rescan. Prioritize the 12 null-score historical reports and high-impact missing identity/security evidence. Preserve immutable history; do not manufacture current facts by rewriting old payloads. Use a bounded, owner-authorized rescan queue with cost estimates.
2. **Finish global deadline propagation.** `server/orchestrate.ts:4363–4391` checks deadlines before an adapter, then awaits the entire adapter. Basic Facts performs multiple discovery and verification passes after it starts. Per-call timeouts do not guarantee the shared collection deadline. Reserve time for identity/adverse screens, scoring, and persistence and test providers that stall near each boundary. The current 60-second token API ceiling also differs substantially from the 600-second person routes; exercise a realistic slow-provider timeline before claiming parity.
3. **Treat the threat queue as a monitored queue.** `vercel.json` schedules one run daily; `api/_ledger.js:238` and the handler cap it at 120 receipts across all workspaces. More than 120 due receipts increases recheck age beyond a day. A ten-minute retry deferral does not itself schedule a retry. Track oldest due age and deferred count, and choose cadence/throughput from an explicit freshness target.
4. **Make data gaps actionable.** Each required check should state attempted/not attempted, source, observed time, failure class, next available source, and whether a retry could change the score. Distinguish not applicable, unknown, unavailable, checked-empty, and verified. Avoid blanket INCOMPLETE labels where a provisional assessed-evidence score is valid.
5. **Use one source of truth for coverage and display.** Share the same typed evidence/check state across person, project, token, threat, API, export, and renderer paths. Maintain adapters for legitimate methodology differences, not independent interpretations of “available.”
6. **Strengthen evaluation beyond the current golden set.** `src/calibration/run.ts:15` scores prepared dossier evidence; it does not invoke the token collector or the deployed middleware/handler stack. Add identity, outage, partial-payload, stale-cache, cross-chain, cross-tenant, budget, persistence, and render-contradiction cases. Measure false reassurance and false adverse conclusions independently.
7. **Measure actual reliability.** Track scan start/finish/persist/activation, provider attempts and p95 duration, required coverage by role, null-score rate, stale receipt age, cost per useful verified fact, and rescan recovery rate. Partition by deployment/methodology. Four old receipts cannot support a release-quality claim.
8. **Continue the existing notable-followers removal PR #311.** It is already durable work and is not duplicated here.

## Implementation order and acceptance gates

| Batch | Scope | Required evidence before release |
| --- | --- | --- |
| 1: truth in outcomes | F01, F02, F05, F08, F09, F15 | Provider outage/partial/empty matrix; no invented zeros or points; no contradictory completion text; risk caps preserved. |
| 2: exact identity | F03, F04, F06, F14 | Chain/address round-trip tests; Solana case preservation; exact chart binding; migration collision/tenant fixtures. |
| 3: bounded work and recovery | F07, F10, F11, F12, F13, F16 | Middleware+handler integration; shared daily allowance; cancellation after deadline; accurate or explicitly unknown costs; recoverable immutable API results. |
| 4: corpus quality | F17 and operational items | All-kind latest-version audit, no silent truncation, prioritized bounded rescan cohort, deployment-specific metrics. |

Before each batch, fetch main and recheck open PRs. Keep changes small and replay the existing Enigma/reliability regressions. Any database change should be additive and tested against legacy/collision/tenant cases. Do not reintroduce personal approval gates; existing automated checks remain mandatory.

## Reproducing this review

From the repository root at the reviewed commit, copy `docs/audits/2026-09-09/reproductions.test.ts.txt` to `api/review-20260909.probe.test.ts`, then run `npx vitest run api/review-20260909.probe.test.ts`. Remove the temporary file afterward. The 14 tests assert current defective behaviors so their failure after a repair can be expected; convert them into assertions of the desired behavior in each repair PR.

The fixture uses synthetic identities and mocks all network requests. It is evidence for these behaviors, not a live-provider or authenticated browser acceptance test. The original application suite was run before adding the temporary diagnostic file. No production data is embedded in the fixture.
