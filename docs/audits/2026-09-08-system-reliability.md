# ARGUS system reliability review and implementation, 2026-09-08

## Assessment and scoring policy

Kyle approved scores from available assessed evidence, explicit data gaps, and a separate limit of **100 supplemental requests per workspace per UTC day**. Reports normalize earned points over assessed methodology weight and label partial assessments PROVISIONAL. Missing axes earn neither zero points nor positive credit. Identity blocks and disqualifying caps remain effective; no assessed evidence means no numeric score. See [the scoring decision](../decisions/2026-09-08-provisional-scoring.md).

This branch repairs reliability defects across person, project, investor, token, combined investigation, website, threat, report persistence, and supplemental request paths. Automated evidence establishes the behaviors below. It does not establish live provider completeness or production throughput.

Baseline: `45689e56e2339d69d0d0adac37ccad60d1f54959`. Branch: `codex/reliability-system-review`. Draft PR #385 includes the earlier #360 official-site repair. The independent Production/Kyle/Enigma report-style promotion remains PR #351.

## Implemented safeguards

| Area | Result and issue references |
| --- | --- |
| Person / multi-role scoring | Known risk caps and identity blocks survive missing axes and mixed-role completeness (#353). Available assessed axes produce provisional scores with named gaps. |
| Project scoring and routing | Unresolved token identity leaves token conduct unassessed without erasing supported project scores (#354). Provider-bound project identity survives investor vocabulary without requiring a token (#330). Skipped basic-facts collection cannot establish negative backing/transparency findings (#357/#320). |
| Investor scoring | Missing fund-scale artifacts remain unassessed; other assessed axes can yield a provisional score. This addresses the report-level incompleteness concern in #326 without inventing AUM or changing artifact eligibility. |
| Identity and adverse evidence | Strict official-X profile URLs (#359), unread official sites remain unavailable (#360), prelaunch wording cannot override identity uncertainty (#370), and related searches cannot complete a failed subject screen (#377). |
| Combined investigations | Only verified account/contract bindings launch an embedded account audit. Mismatch, unknown, and unavailable bindings do not. Model-derived founder suggestions remain discovery leads rather than verified founders (#372). |
| Run replay | An atomic unique receipt insert claims tenant/user/route/subject context before provider execution. Reusing a run key returns conflict; claim storage failure returns unavailable (#355). Quota debit and receipt claim remain separate operations. |
| Forced rescans and privacy | An already-running investigation is reused even when force is requested; completed runs can be refreshed. Public and private runs use separate keys. Canceled reservations receive terminal receipts and late callbacks cannot publish (#369). |
| API presentation | Token API final fields now follow frozen check coverage. Provisional scores are available in the assessment and preliminary signal; partial runs are recorded degraded, not complete. |
| Durable publication | Token/investigation audit history and graph publication follow successful exact-version persistence. Failed saves publish neither. Supplemental team discoveries remain session-only pending a durable version (#362). Watchlist opening resolves saved reports (#361). |
| Website panels | Site safety, documentation, infrastructure, favicon hashing, and history subject reads use guarded public-web retrieval with DNS/IP checks, validated redirects, bounded bodies and one request deadline. Partial site-safety coverage cannot become clean (#364). |
| Forensic providers | Etherscan semantic errors, malformed holder data, failed burn/log reads, incomplete Arkham reads, and unavailable wallet taxonomy rows remain unavailable. Failed Arkham coverage is not cached as absence (#363). |
| Threat ledger | Authenticated organization scope propagates through reads/writes, valid organization-qualified conflict keys are used, Solana address case is preserved, and failed reads return unavailable instead of empty (#365). |
| Collection budgets | Short gap runs receive positive collection/screening/scoring windows (#358). Boxed security-audit and Moni stages now abort their injected fetches on expiry and reject later fetch starts/results (#378, bounded repair). |
| Supplemental spending | Middleware atomically reserves one request from the shared daily allowance before configured paid panels and report chat. Members and routes share the same workspace allowance. Database errors fail closed; exhausted allowance returns 429 (#356). |
| Dependencies | Compatible dependency updates remove the baseline npm advisories. A real Open Graph render validates the selected patched release; mocked route tests alone missed a failure in the next release. |

## Supplemental allowance and deployment contract

`ARGUS_SUPPLEMENTAL_DAILY_LIMIT` defaults to 100 and accepts integers from 1 through 100000. This is a request-admission allowance, separate from investigation credits; cached and subsequently failed requests count once admitted. It is not a dollar cap or a count of downstream provider calls. Reset is UTC midnight.

Apply `supabase/migrations/20260908143234_supplemental_budget.sql` before deploying the middleware. Its service-role-only RPC validates active investigator membership and serializes per-workspace/day reservations with an advisory transaction lock. A partial usage-events index supports daily accounting. There is no new customer-facing table or permissive grant.

Scheduled threat rechecks require `ARGUS_THREAT_ORGANIZATION_ID` for the intended workspace. Without it, the cron refuses to choose a tenant. Configure this deliberately during rollout.

## Verification

- Final local gates passed: 405 test files, 4,310 passing tests plus one expected failure; typecheck; truth contract; 7/7 recorded canaries with 18 intercepted requests and no unexpected URLs; 20/20 calibration cases with no drift or unsafe conclusions; production build including generated bundles; git diff whitespace check. npm audit reports zero vulnerabilities. Vite retains large-chunk and mixed-import warnings.
- Regression coverage injects provider rate limits and semantic failures, missing coverage, account mismatch/unknown bindings, duplicate claims, save failures, exhausted supplemental budgets, canceled fetches, concurrent tenant contexts, and force/private run collisions.
- A fresh isolated local Supabase project applied repository migrations and passed all 57 database checks across nine test files. The pre-existing local database was not reset; production was not migrated.
- Thirty concurrent service-role reservations against an allowance of five admitted exactly five and rejected twenty-five. Test fixtures were removed. Six new database assertions cover the supplemental allowance, shared membership accounting, denied-request accounting, privileges, and membership validation.
- Local database security advisors reported no issues. This is not a full authenticated production penetration test.
- Real Open Graph generation using the selected package produced a successful PNG response.
- Earlier read-only production probes returned homepage 200 and 401 for five unauthenticated protected scan/report endpoints. They establish reachability and authentication rejection only.

## Remaining boundaries and follow-up

These are explicit limits, not claims of complete issue closure:

- The cancellation repair covers the four boxed audit/Moni invocations. Ordinary collector adapters and long intake still rely on their own request timeouts; a single global cancellation contract and live deadline/latency proof remain follow-up for #357/#378.
- Atomic run claims prevent provider replay, but quota reservation and claim insertion are not one database transaction. A receipt-store outage after debit requires an idempotent retry. Embedded run authorization still merits a parent/child capability review.
- Provider outages are distinct from measured absence in the repaired routes. Capped burn pagination, provider freshness, and concurrent provider cost accounting still require broader completeness/telemetry work. No paid production provider runs were performed.
- Threat keys remain organization/ref/kind; chain-specific identity for equal EVM addresses and a multi-organization cron dispatcher remain separate work.
- Numeric provisional scoring does not justify treating missing investor AUM or other missing decision-critical evidence as assessed absence. Reports must retain confidence and coverage disclosures.
- Existing immutable versions preserve their evidence. Fresh scans are needed to replace older null-score or misleading provider outcomes.

## Release and rollback

Historical rollout note: this audit originally required Enigma-Fund ownership approval. Kyle retired that requirement on 2026-09-08; the current release policy is in `docs/report-lanes.md`. Deploy through protected main after its required automated checks.

Roll back source and generated collector/sweep artifacts together. For the supplemental allowance, reverting middleware first leaves the additive RPC/index harmless; remove those only after confirming no deployed caller uses them. Preserve usage history. No customer records were changed during this implementation.


## Enigma review follow-up

The review of `5c21997` correctly identified that the Etherscan measured-empty guard fell through to a status-one requirement. Completed no-transfer reads now return an explicit empty history immediately; provider errors remain unavailable. Regressions cover both Etherscan empty payload forms and one populated burn address alongside one empty address.

The public favicon hash reader again rejects bodies of 120 bytes or less before hashing. Tests cover empty/tiny bodies, the 121-byte boundary, and redirects into private networks. Site-infrastructure cache version v4 prevents earlier placeholder hashes from being reused. This restores the size heuristic; it does not identify every larger stock favicon, and favicon matches remain soft signals.
