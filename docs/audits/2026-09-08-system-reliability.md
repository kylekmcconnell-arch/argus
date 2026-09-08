# ARGUS system reliability review, 2026-09-08

## Assessment

ARGUS has substantial automated coverage and working authentication at its public scan entry points, but it is not yet consistently fail-closed across all scan types. The most important defects concern what a completed result means: missing provider evidence can become a negative finding, partial scoring can erase a known risk, and different delivery paths can apply different publication rules.

This review includes concrete repairs, not just a restatement of the September handoff. Seven issue areas are repaired or hardened in this pass, with the earlier official-site coverage repair carried forward. Remaining items are explicitly separated below. No claim is made that all open issues are resolved.

Baseline: `origin/main` at `45689e56e2339d69d0d0adac37ccad60d1f54959`. Branch: `codex/reliability-system-review`. This branch includes the earlier issue #360 fix and excludes the independent report-style PR #351.

## Scope and evidence

Reviewed intake, provider routing, identity attribution, scoring, coverage, deadlines, report persistence, usage controls, and recovery behavior across the following paths. Evidence consists of source inspection, fault-injection regression tests, the complete existing test suite, offline recorded canaries, calibration, and six read-only production HTTP probes.

| Scan or feature | Main execution path | Assessment |
| --- | --- | --- |
| Person: founder, KOL, advisor, member, agency | `api/audit.ts`, `api/v1/person.ts`, `server/orchestrate.ts`, `src/engine/audit.ts` | Shared identity and partial-score safety repaired; credit replay and collection deadline weaknesses remain. |
| Project / company account | Same collector, provider-backed PROJECT routing and six project axes | Token-identity coverage and provisional treatment repaired; brand-versus-investor routing and skipped basic-facts completion remain. |
| Investor / fund | Shared collector with INVESTOR evidence requirements | Identity-block regression coverage added; absent fund-scale evidence can still prevent a useful score. No evidence requirements were weakened to manufacture a score. |
| Standalone token: EVM, Solana, DEX URL | `src/token/audit.ts`, `api/v1/token.ts`, `src/lib/scanrunner.ts` | Account-link parser hardened; raw token API output does not use the person API's coverage-qualified presentation contract. Provider outage handling in supporting panels needs repair. |
| Combined token + project investigation | `src/lib/investigation.ts` | Explicit account/contract mismatch now blocks the embedded account audit. Name-derived founder candidates and uncertain bindings still need additional policy work. |
| Website / company reconnaissance | `src/collect/recon.ts`, project intake, `api/site-safety.ts` | The site-safety route follows redirects without the guarded public-web reader and can label partial source coverage clean. Not repaired here. |
| Evidence-gap follow-up | `api/gap-investigation.ts`, runtime budgets, authorized research scope | Short-budget reserve arithmetic repaired. Long intake and already-running providers can still consume the remaining window. |
| Threat scan and forensic panels | `api/threat-scan.ts`, `api/_ledger.js`, Arkham/Etherscan/burn/LP routes | Legacy ledger conflict target and partial-provider success handling remain material risks. |
| Saved reports, shares, watchlists, rescans | `api/report.ts`, `src/App.tsx`, runners and report presentation | Immutable version and tenant checks have automated coverage; token publication order, rescan cancellation, and launch-capable navigation remain separate defects. |

## Repairs in this branch

### 1. Risk caps and identity blocks survive missing axes (#353)

`Audit.finalize()` now evaluates caps before checking axis completeness. A known prior-rug cap remains AVOID even when some axes are missing; an identity block remains UNVERIFIABLE_IDENTITY. The missing score stays null. A fully scored capped role also governs when another role is incomplete, instead of disappearing into generic INCOMPLETE.

The collector keeps coverage partial whenever any role has an unscored raw total. This prevents a retained risk signal from masquerading as a fully scored report.

Regression tests cover identity blocks for every supported subject class, a partially scored capped founder, a capped founder alongside an incomplete member role, and existing uncapped incomplete behavior.

### 2. Provisional token identity blocks project finalization (#354)

A fully populated set of project axes no longer overrides `axisTreatment: provisional`. The engine withholds the project's overall score until token identity is resolved. Known disqualifying caps remain visible as risk signals.

### 3. Short gap investigations get a real collection window (#358)

The gap route previously passed an analyst deadline of budget minus 30 seconds while the collector subtracted a fixed 250-second reserve. A 240-second request therefore started with a collection deadline 40 seconds in the past.

Authorized gap runs now allocate up to 60% of the available pre-finalization time to screening/scoring, capped at the normal full-scan reserve. The graph receives a bounded share of that reserve. A 240-second run gets 84 seconds for collection. Every integer budget from 180 through 540 seconds is tested for positive collection, graph, and scoring windows; the route test verifies the actual reserve options it passes.

Full-scan defaults are unchanged. This is an arithmetic and wiring fix, not a guarantee that live providers finish inside their allocation. Short runs intentionally have shorter scoring timeouts; the existing scorer already clamps its timeout to the supplied deadline. No paid live delegate execution was performed.

### 4. Token identity links must point to real profile URLs (#359)

Both the project registry adapter and standalone token scanner now share `officialXProfileHandle`. It requires an HTTP(S) URL on exactly x.com or twitter.com, with one nonreserved profile path segment. Tweet URLs, likes pages, lookalike domains, path-embedded x.com strings, and non-web protocols cannot supply official-account identity.

Tests cover valid profiles, trailing slash/query variants, malformed or hostile URLs, and CoinGecko/DexScreener integration. Existing exact official-account bindings continue to pass.

### 5. Unread official sites remain evidence gaps (#360, carried forward)

The earlier repair distinguishes declared, empty, and failed site outcomes. HTTP 403/429/404, failed reader recovery, token-batch errors, failed capped-batch follow-ups, and unread second official sites no longer become assessed absence. The orchestrator includes site-fetch in provider attempt accounting.

### 6. Prelaunch language cannot override uncertainty (#370)

Token applicability now checks unresolved identity and structured conflicts before considering prelaunch language. A bio saying a token is planned cannot excuse an unavailable provider or a conflicting contract. A completed prelaunch search still defers token conduct as before.

### 7. A mismatched account is not embedded into a token investigation (#372, partial)

An explicit mismatch from the account/contract binding check now prevents the account audit from launching and leaves the embedded account unavailable. A regression test verifies that the paid account stream is not invoked and no account dossier is attached.

This does not fully close #372: model-resolved founder candidates and absent/unreadable binding outcomes still need a broader identity-policy repair. The candidate handle remains visible for investigation; it is not treated as a completed account audit.

### 8. Related searches cannot complete a failed subject screen (#377)

If the subject's own adverse search fails, the decision-critical row stays unavailable even when related-project searches answer or surface leads. Those leads remain in evidence for follow-up. A subject search that genuinely completes empty retains checked-empty, and a completed subject search with findings retains its findings.

## Remaining material defects, in repair order

These were confirmed in code; production frequency and financial impact were not measured.

| Priority | Issue / area | Reproduction mechanism and next repair |
| --- | --- | --- |
| Critical | #355, credit replay | `consumeInvestigationQuota` accepts the credit RPC's allowed result, while the migration returns allowed again for an existing idempotency key. Audit/person/token routes then execute new work. Bind a unique run claim to tenant, user, route and exact subject, and return the stored result or a conflict on replay. |
| High | #364, site-safety network access and coverage | `api/site-safety.ts` fetches the supplied page with `redirect: follow`; initial URL checks are not private-network or redirect-hop validation. Its final clean result can coexist with unavailable sources. Route page retrieval through the guarded public-web mechanism and preserve source-level outcomes. |
| High | #363, forensic provider errors | Etherscan helper increments success after any HTTP-200 JSON, including API-level rate-limit errors. Catch-to-null paths become empty arrays; the outer failure response can say available=true. Arkham null responses can be cached as `{ none: true }`. Distinguish measured-empty, partial, unavailable and explicit access-denied outcomes before caching or scoring. |
| High | #362, publication precedes durable save | Token/investigation callbacks in `src/App.tsx` enqueue persistence and then immediately call `logAudit` and graph contribution code. A failed save can therefore leave externally visible results without a durable version. Publish from successful exact-version persistence completion. |
| High | #365, obsolete threat ledger target | `api/_ledger.js` and `api/threat-scan.ts` still upsert `reports?on_conflict=ref,kind`; migration `20260711191503...` drops that uniqueness index. Failures are reduced to false/empty values. Move to tenant-scoped storage with a valid unique key and make write failures observable. |
| High | #357 and #320, skipped and ungated collection | `runAdapter` exits on budget exhaustion before running basic facts. Later project backing/transparency outcomes may be derived from other material without a completed basic-facts search. Some post-intake stages are independently time-boxed rather than uniformly deadline-gated. Preserve explicit skipped outcomes and require completed producers for negative findings. |
| High | #330, project/investor role collision | `providerBackedRoles` can delete PROJECT whenever INVESTOR remains and no verified project token exists. A company account can inherit the wrong governing methodology because of fund vocabulary. Preserve provider-bound organization identity independently of token existence. |
| High | #378, timeout without cancellation | `withWallClockBox` races an already-running promise; expiry does not cancel provider work or prevent later evidence mutations. Propagate AbortSignal and stop mutations after closure, with stage-level provider accounting. |
| High | #369, forced rescans | `startInvestigationScan` aborts an existing run on force, keyed by the contract without privacy separation. Existing credit/receipt lifecycles can be orphaned. Deduplicate by authorized run identity and settle canceled reservations explicitly. |
| High | Token API publication parity (#318/#323 related) | `api/v1/token.ts` returns raw `d.verdict` and `d.score` and records complete after any non-null dossier. `api/v1/person.ts` uses a coverage-qualified output and preliminary signal. Align token API completion and final fields with its frozen safety/check coverage. |
| Medium | #356, bounded supplemental spending | Contrary to an overly broad reading of the old handoff, Arkham and EVM-deployer already require an organization-bound HMAC panel token and attach usage. That token is a report-context capability, not an atomic daily spending limit. `/api/ask` authenticates and loads an exact tenant-owned version, but this is not equivalent to a per-org model budget. Audit and enforce bounded spending across all paid routes. |
| Medium | #326, investor assessed absence | The scoring prompt explicitly leaves I3 unscored without verified fund-scale artifacts. A clean but private fund can remain incomplete. Implement the approved assessed-empty policy with explicit search provenance; do not relax artifact eligibility or invent AUM. |
| Medium | #361, watchlist navigation | `WatchlistPage` receives the launch-capable `onSafeAudit` callback. Opening a saved item should use saved-report resolution, with a new scan as an explicit action. |
| Medium | #372 remaining identity work | `resolvedFounder` can still be constructed from the token-identity response and prepended to founders. Separate discovery leads from verified people and require unique identity binding before promotion. |
| Medium | Dependency advisories | npm audit reports 16 advisories: one critical, 13 high, two moderate. These are package classifications, not a demonstrated production exploit. Several suggestions involve major changes or downgrades; review reachable code paths and upgrade in a separate tested change. |

## Existing safeguards confirmed

- The person API derives public readiness from frozen coverage and separates preliminary model output from final verdict fields.
- Report APIs have tests for organization-qualified reads and exact immutable versions.
- Core database migrations enable RLS and revoke direct privileged function access; API authentication resolves current membership server-side rather than trusting editable user metadata. This is source inspection, not a full live RLS penetration test.
- Offline canaries exercise recorded person/project/token cases, including identity collision, incomplete coverage, honeypot, and sanctions outcomes.
- Calibration is stable, but it is not evidence that runtime failures are safe. New tests explicitly inject unavailable sources, mismatches, partial scores, and conflicting identity evidence.
- The old handoff's issue numbers drift after #369. This report uses current GitHub issue titles and numbers instead of copying the stale mapping.

## Production entry-point smoke check

Six unauthenticated requests on 2026-09-08 returned within 0.21 to 0.38 seconds from this machine:

| Path | HTTP result |
| --- | --- |
| `/` | 200 |
| `/api/audit` | 401 |
| `/api/v1/person` | 401 |
| `/api/v1/token` | 401 |
| `/api/report` | 401 |
| `/api/gap-investigation` | 401 |

These confirm homepage reachability and rejection of unauthenticated entry-point requests. They do not establish provider health, tenant isolation under authenticated attack, data completeness, or paid-scan latency.

## Release and verification boundary

The reliability branch must pass its source/type/test/bundle gates and protected CI before deployment. Existing immutable reports retain their original evidence; fresh scans are needed to receive corrected outcomes. No customer records were modified, no production database migrations were applied, and no paid scans were launched in this review.

The separate report-style PR is not bundled with these reliability changes. Roll back source and generated collector/sweep artifacts together if a reliability release needs reversal.

### Final local verification

- Exact `npm run typecheck`: passed.
- `npm run build`: passed; collector and sweep bundles rebuilt. Vite reports existing large-chunk and mixed static/dynamic import warnings.
- `npm run truth:check`: passed.
- `npm run canary:offline`: 7/7 matched, 18 provider requests intercepted locally, zero unexpected URLs.
- `npm run calibrate`: 20/20 matched, no drift.
- `npm test`: 401 files passed; 4,282 tests passed plus one expected failure.
- `git diff --check`: passed.
- Live database integration tests were not run locally. Protected CI remains a release requirement.
