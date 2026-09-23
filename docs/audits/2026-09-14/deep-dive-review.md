# ARGUS deep-dive: reliability and logic review, 2026-09-14

Reviewed against `origin/main` at `042a271` (2026-09-12, PR #411) in a detached
worktree. No application code, migration, saved report, or deployment was
changed. No paid live scan was launched. Seven parallel lane reviews (engine,
orchestration, identity binding, token/threat, persistence/API, client,
intelligence/projection) each verified findings by reading the code path and,
where marked, by a throwaway reproduction test that was run and deleted. Lane
reports with full mechanism and repro inputs are in `lanes/`.

## Baseline

| Gate | Result on 042a271 |
| --- | --- |
| `npm test` | 425 files, 4481 passed, 1 expected fail |
| `npm run typecheck` | clean |
| `npm run truth:check` | passed |
| `npm run calibrate` | 20/20, no drift |
| `npm run canary:offline` | passed |
| Generated bundles (`api/_collector.js`, `api/_sweep.js`) | byte-identical to sources |
| `npm run lint` (not a CI gate) | 243 errors, almost all `no-explicit-any` |

Repository state worth knowing: the checkout at `/Users/kyle/Documents/ARGUS`
is on `codex/update-and-integrate-wip` (Aug 26), 285 commits behind main. Two
pieces of work exist only there: commit `c4bd47a` (product entitlements and
private Argus Eye conversations, with its migration) and an uncommitted
ThreatScanPage "Market mechanics / MarketOverview" rewrite. Neither is on main.

Issues #353-#384 from the 2026-09-06 audit are all still open although PRs
#385/#388/#391 claimed to fix most of them. This review confirms #378
(`withWallClockBox`) is fixed on main and #353/#373/#374/#375/#323/#318/#371/
#381/#383/#366 are not. The rest were not re-verified here.

## What this review found

39 new defects across the lanes (details below), none duplicating the open
issue list or the 2026-09-09 F01-F17 set. They cluster into five themes. The
first two are the ones that produce wrong verdicts on real subjects.

### Theme A: something other than a verified binding is used as a bind key

The source of truth says a partner, namesake, or nearby name cannot lend facts
to the subject and the display name is not a bind key. Nine independent code
paths violate that:

| Ref | Sev | Defect | Where |
| --- | --- | --- | --- |
| ID-1 | P1 | Official-site token tier binds any *single* tradeable address printed on the page as the project's token (USDC, WETH, a partner CA). Repro: `@acmepay` "We accept USDC" -> `projectToken = USDC, verified, official_domain`. | `server/adapters/projectToken.ts:667-697, 954-1128` |
| ID-2 | P1 | Every URL in the bio *description* becomes an official-domain scope, so a fan or impersonator account with a link to the real site binds the real CoinGecko token; the registry's contradicting `twitter_screen_name` is stored but never compared. Repro: `@uniswapfans` "Unofficial, not affiliated" -> UNI bound, confirmed. | `server/adapters/x.ts:397-426`, `projectToken.ts:515-569` |
| INT-1 | P1 | Fund-scale and portfolio entity match is substring: "Sequoia Capital China" IS "Sequoia Capital"; the artifact is minted with the subject's name so the strict gate passes. Repro: HongShan's $9B fund scored as Sequoia's I3 exceptional. | `server/adapters/portfolio.ts:396-425`, `fundScale.ts:113-118, 462-470, 1000-1001` |
| ID-3 | P1 | Bio/tweet role grammar binds "ex @proj", "Former CEO @proj", "Not the founder of @proj", and a tweet asking "who is the founder of @proj?" as `artifact_verified`, `subject_first_party` team rows. | `server/adapters/x.ts:1653-1741, 2420-2502` |
| ID-4 | P1 | A PDL name match upgrades a Grok-supplied `domain` to `official_counterparty`; every lead fetched from that (possibly lookalike) host verifies without the identity check applied to `evidence_url`. | `peopledatalabs.ts:381-434`, `basicFacts.ts:3910-3928, 4255-4263` |
| INT-3 | P1 | Monid management merge matches on display name and promotes the Grok-guessed `@handle`/GitHub on that row to deterministic/verified; it becomes a TEAM edge in the trust graph. | `server/orchestrate.ts:3775-3791`, `src/data/dossier.ts:407-424` |
| INT-7 | P1 | Graph nodes keyed by display-name slug and `$ticker`; a namesake on a failed report yields a medium tie and a cap of 69 on an unrelated subject. | `src/graph/network.ts:101-103`, `src/engine/audit.ts:938-940, 1011-1017` |
| CL-1 | P1 | Investigation path assigns a Grok-guessed `website` straight to `siteUrl`, recons it, promotes its team as `founders` "named on the project site", and pays for recon-team on it. The X-handle half of the same fallback is gated; the site half is not. | `src/lib/investigation.ts:323-331, 356, 460-463`, `App.tsx:798` |
| ID-7 / ID-8 | P2 | Wayback corroboration promotes on display-name match; official-site recovery confirms identity from a brand-stem lookalike domain and accepts a tweet link as a backlink. | `wayback.ts:229-323`, `basicFacts.ts:1075-1118, 4703-4768` |

Also in this theme (P2/P3): INT-14 `api/resolve-github` binds on one-way
`twitter_username` or substring name; INT-20 augment legacy listing keyed by
display label; OR-10 two intake cache keys fall back to display name.

### Theme B: an outage or a stale value becomes a measured result

| Ref | Sev | Defect | Where |
| --- | --- | --- | --- |
| INT-2 | P1 | OFAC/legal/news name screens: when basic facts resolve a new real name and the refresh is unavailable, the earlier `checked_empty` for the *old* name wins (priority 4 > 2) and is reported as "screen completed ... no match". When the refresh does hit, the new-name artifact is deduped away and the only stored artifact still says no match. | `server/orchestrate.ts:4421-4426`, `checks.ts:370-379, 504-516`, `offchain.ts:47-56, 437-453` |
| INT-5 | P1 | GitHub 401/403/429/5xx on repos/orgs list returns null like 404 -> "no public repositories" and affiliations `checked-empty`. | `server/adapters/github.ts:48-57, 253-293, 398-406` |
| OR-1 / ID-5 | P2 | `reverseBioMemo` is a process-global, never-reset, unbounded promise cache (only tests call `resetReverseBioMemo`). An outage-empty or stale bio result replays for every later scan of that handle in the warm instance, across tenants, with $0 in that run's ledger. Found independently by two lanes. | `server/adapters/x.ts:2327-2384`, `orchestrate.ts:3845-3847` |
| TK-4 | P2 | "Owner renounced" reads `owner_address` undefined as renounced and ignores `hidden_owner`/`can_take_back_ownership`; the positive suppresses balance-rewrite, blacklist and tax-modifiable findings and the judge's "no owner powers" line. | `src/token/audit.ts:458, 868-889, 1118-1128`, `src/threat/scan.ts:376-386` |
| INT-10 | P2 | Zero-count measurements (`audit_lead_count: 0`) move an unavailable or unresolved question to `partial`. | `buildPointInTimeIntelligence.ts:1600-1646, 2234-2282` |
| OR-7 | P3 | Cost aggregation marks any success+cached mix `partial`, so healthy runs get `degraded/provider_incomplete` receipts; the Grok spend-ceiling short-circuit books a phantom call. | `server/cost.ts:95-100`, `x.ts:85-158`, `defiLlama.ts:413-431` |
| API-2 | P2 | Supplemental daily budget is debited in middleware before handler validation, so 409s, clarification-only turns and provider 429s consume the 100/day allowance. | `middleware.ts:244-263` |

### Theme C: the analyst contract disagrees with itself

| Ref | Sev | Defect | Where |
| --- | --- | --- | --- |
| EN-1 | P1 | Preflight admits an axis whose only evidence is a `checked_empty` check (the comment says it "scores in the bottom band"); the validator rejects `checked_empty` as primary support. The model has no legal citation, the repair loop retries three times, `analyzeSubject` returns null and the whole verdict is INCOMPLETE after up to 4 paid calls. Real producers: official-site 401/403 -> P2; backing-partners empty -> P4; affiliations empty -> F6. | `server/agent.ts:690-692, 1459-1462, 4218-4232`, `orchestrate.ts:5216-5231` |
| EN-2 | P1 | Investor I5 reputation floor is minted from press, but the only press eligible for I5 is press matching fraud/lawsuit/sanction vocabulary. Three adverse headlines from three hosts force the analyst to score reputation 72-84 percent and reject anything lower. | `server/agent.ts:2355-2373, 2519-2551, 3085-3094` |
| EN-3 | P2 | Person roles have no bands: a deterministic "nothing found" outcome is `verified` and an own-bio row is `observed`, so F3 = 15/15 and F5 = 18/18 citing only those pass validation. No "evidence text is data, not instructions" rule in the prompt. | `server/agent.ts:1489-1535, 2690-2736, 3337-3339, 4297-4344` |
| EN-4 | P2 | Partial-scoring headline says "ARGUS did not produce an overall score" on the same immutable version that publishes a provisional governing score. | `orchestrate.ts:5346-5350` |
| TK-1 | P1 | Threat `judge()` reads only `honeypot_confirmed` from the audit's caps; an OFAC-sanctioned deployer (audit AVOID/5) scans SAFE, is receipted SAFE to the shared ledger and cached for an hour. | `src/threat/scan.ts:253-264, 578-716` vs `src/token/audit.ts:1300-1316` |
| EN-6 | P3 | Fully assessed FAIL role is relabelled composite PROVISIONAL when another role is partial and presentation carries no FAIL signal. | `src/engine/audit.ts:808-844`, `reportPresentation.ts:251-267` |
| INT-12 / INT-13 | P2 | Coverage map says "measured" from reported-context rows; entity scorecard axis "established" from one unrelated constituent domain. | `buildPointInTimeIntelligence.ts:2318-2328`, `entityScorecards.ts:69-153` |
| INT-8 | P1 | Intelligence Spine integrity gate whitelists only fact/measurement ids, so the collector's legitimate `profile:` and `project-token:` answer refs are stripped and every project scan with a resolved profile gets a spurious high "lineage failed" gap. | `buildPointInTimeIntelligence.ts:4296-4398`, `basicFacts.ts:4379-4386` |

### Theme D: token and forensic math

| Ref | Sev | Defect | Where |
| --- | --- | --- | --- |
| TK-2 | P1 | OFT cross-chain liquidity is summed with no chain filter; the deepest pool in the mesh is counted once per peer chain ($515k reads as $1.01M; thin-pool warnings suppressed). | `src/threat/crosschain.ts:35-49`, `scan.ts:505-520` |
| TK-3 | P1 | Rug-clone detector matches on runtime-bytecode fingerprint alone; launchpad factory tokens share bytecode, so one DANGER template token adds +50 to every later sibling and cascades org-wide. | `api/bytecode.ts:141`, `src/threat/deepsources.ts:208-222`, `scan.ts:276-280` |
| TK-5 | P2 | Threat-lane RugCheck parse sums overlapping insider clusters (token lane takes the largest); two 40 percent clusters read 80 percent. | `deepsources.ts:36-53` vs `src/token/sources.ts:616-630` |
| TK-6 / TK-7 | P2 | `auditToken` cache key and `/api/threat-scan` cache key omit chain; the same EVM address on Base and Ethereum returns the other chain's dossier for 60 s / 1 h. | `src/token/audit.ts:581`, `api/threat-scan.ts:26-67` |
| TK-8 | P2 | When every holder row is infrastructure the excluded pool is republished as top holder (T4 docked, checklist finding). | `src/token/audit.ts:1037-1042` |
| TK-9 / TK-10 / TK-11 | P2 | EVM creator has no factory guard (factory inherits deployer rep, OFAC, Arkham); Helius "tokens created" counts any TOKEN_MINT touching the wallet; launch-block supply = first mint transfer only. | `audit.ts:762-770`, `api/deployer.ts:176-193`, `api/launch.ts:41-72` |
| TK-12..16 | P3 | Liquidity risk non-monotone at $2.5k; `cannot_sell_all` FAIL vs RUG disagreement; burned percent divides by post-burn supply; RugCheck `lpLockedPct` 0 as measured; Arkham trace guard only excludes the token CA. | see `lanes/findings-token.md` |
| INT-6 / INT-16 | P1/P2 | github-forensics mines forks, so upstream maintainers' emails become hard `email:` ties across every project forking the same repo; per_page=30 sample presented as account totals. | `api/github-forensics.ts:85-124`, `server/adapters/github.ts:250-293` |
| INT-9 | P2 | `fundScaleSourceCount` counts URL variants of one page as independent sources; one manager page -> "multi-source" -> I3 exceptional. | `fundScale.ts:768-772, 914-918` |
| INT-11 | P2 | Year-only and month-only funding dates are parsed as exact instants; "2024" sorts before "2024-03-01", "Q1 2024" is dropped silently. | `buildPointInTimeIntelligence.ts:1647-1666` |

### Theme E: tenancy, spend, and client runtime

| Ref | Sev | Defect | Where |
| --- | --- | --- | --- |
| INT-4 | P1 | Browser graph cache `argus:graphstore` is not org-scoped and is backfilled via POST into whichever org signs in next on that browser. | `src/graph/store.ts:27, 174-197`, `auth.tsx:265-275` |
| OR-2 | P2 | Private scans still write `entity_facts` (org-visible, with `audit_count` and fresh timestamp) and can be reused by a colleague's scan under `ARGUS_ENTITY_REUSE`. | `api/audit.ts:344-373`, `orchestrate.ts:5554-5578` |
| API-1 | P1 | Credit debit and receipt claim are two calls; a failure between them orphans the debit while the client copy says "no credit was taken" and a retry mints a new key and debits again. | `api/investigation-credit.ts:31-69`, `src/lib/scanrunner.ts:83-157` |
| API-5 | P2 | `/api/v1/token` replay is org-scoped while the debit is user-scoped; another analyst's key returns their result free or a permanent 409. | `api/v1/token.ts:56-80` |
| CL-2 | P2 | AuthGate unmounts the whole App on every hourly `TOKEN_REFRESHED`; current view, session result cache and unsaved Case Brief drafts are destroyed. | `src/auth.tsx:199-249, 372` |
| CL-3 | P2 | After an SSE drop the client polls four times over six seconds then declares "nothing was saved" and offers a retry that launches a second full paid audit while the server run (up to 600 s) continues and persists. | `src/App.tsx:1127-1174, 2030-2051`, `src/lib/live.ts:78` |
| CL-4 / CL-5 | P2/P3 | Running-scan lookup keys and click refs use different identity forms (`ethereum:0x..` vs `0x..`), so a rescan started from the report is invisible from Recent cases and the old version is shown; startup rail reconciliation never matches token rows. | `src/lib/scanrunner.ts:58-140`, `App.tsx:1255-1305`, `auditlog.ts:329-350` |
| CL-6 / CL-7 / CL-8 | P3 | Refused credit reservation receipted as `collection_failed` with `creditsCharged: 1`; threat-leg retry runs concurrently and unbounded; credit and deployer-origin fetches have no timeout so a run can stay "running" forever. | `scanrunner.ts:92-193`, `runner.ts:148-249`, `investigationCredits.ts:14` |
| OR-3 | P2 | Watchlist sweep reads only legacy Supabase env vars and always sends Bearer; after key rotation it returns `checked: 0, "no backend configured"` as HTTP 200 forever. Also unbounded and off the cost ledger. | `server/sweep.ts:23-98` |
| OR-4 | P2 | Gap investigations re-run the full unscoped cold intake (8-way discovery, Serper follow-ups) before the scoped adapters, spending outside the authorization and often exhausting the collection window before the authorized work starts. | `orchestrate.ts:4141-4294`, `api/gap-investigation.ts:449-461` |
| OR-5 / OR-6 | P3 | Handle casing preserved into x.ts cache keys (embedded `@Uniswap` and direct `uniswap` never share the 24 h cache); `withProviderDeadline` aborts fire-and-forget cache writes on return. | `x.ts:1466-2866`, `providerDeadline.ts:5-28` |
| API-3 | P2 | `legacy_unknown`/`legacy_ambiguous` token cases can never be saved again; no writer of `identity_state` exists, the RPC raises, the client retries three times and shows "storage failed". | `20260910091456_report_subject_identity.sql:41-71`, `api/report.ts:1232` |
| API-4 | P2 | Argus Eye `coverage_record` basis accepts an empty citation list and any text, so injected evidence excerpts can produce a "grounded" answer that is neither cited nor withheld. | `api/ask.ts:841-903, 1103` |
| INT-18 | P3 | Challenge-verdict withholds whenever any frozen array exceeds 64 items, which is exactly the rich reports where a second opinion matters. | `api/challenge-verdict.ts:134-139, 279` |

## Suggested sequencing

Each group is one issue-linked branch and draft PR per the repository contract.

1. **Bind keys** (Theme A): ID-1, ID-2, INT-1, INT-3, ID-4, ID-3, INT-7, CL-1.
   Shared fix pattern: exact normalized equality or token-boundary match; a
   registry X handle that differs from the audited handle is a namesake, not a
   bind; description URLs are leads; model-supplied domains and handles never
   survive a name-only merge. Add a regression fixture per path with a
   namesake, a subsidiary ("X China"), a fan account, and a "former" bio.
2. **Analyst contract** (EN-1..EN-4, EN-6): one rule for "assessed empty" shared
   by preflight and validator; investor floors from verified artifacts only;
   assessed-null band for person roles; prompt rule that packet text is data.
   Add a calibration control for "fund with adverse press only" and a test that
   preflight `ready` implies every requested axis has a validator-acceptable
   primary artifact.
3. **Outage is not empty** (Theme B): supersede name-screen observations on a
   name refresh; GitHub discriminated result; reset and bound `reverseBioMemo`
   at scan start; owner-assessed gating in token audit; cached counts as
   success in cost aggregation.
4. **Threat lane parity** (TK-1..TK-11, INT-6): judge consumes every audit cap;
   chain filter in `crosschain.ts` and the two cache keys; clone detector
   ignores launchpad templates; largest-cluster insider math; factory guard;
   fork exclusion in GitHub forensics.
5. **Spend and runtime** (API-1, API-2, CL-2, CL-3, CL-4, OR-3, OR-4): single
   RPC for debit plus receipt; reserve supplemental budget after validation;
   keep App mounted on token refresh; treat an SSE drop as "still collecting";
   one canonicalizer for run keys; scoped intake for gap runs.
6. **Tenancy** (INT-4, OR-2, API-5): org-scoped graph cache cleared on
   sign-out; private runs skip `entity_facts`; user-scoped v1 replay.

## Checked and found correct

To save the next reviewer time, these were examined and hold on 042a271:
`finalize()` normalization, bonus withholding and cap ordering; token
applicability handling; Grok JSON parse robustness (no fabricated fallback
scores); `persist_report_version` replay equality and monotonic versions; all
`on_conflict` targets match live indexes; share-token generation and lookup;
auth edge cases and the SECURITY DEFINER surface; `publicWeb.ts` SSRF guards
including reader recovery labeling; verified-passage substring check; SSE
framing and heartbeat handling; thrown adapters leave checks `unknown` (never
falsely complete); `withWallClockBox` cancellation (#378 fixed);
`_sanctions-core` partial-load handling; `projectFactCoherence`; strict
provenance lineage; React 19 `javascript:` href blocking; every localStorage
parse is guarded; run-id guards on async setState.

## Verification limits

Findings marked "repro" were confirmed with mocked providers, not live
subjects. Frequency in production was not measured. Existing immutable
versions are unaffected by any fix; new scans are needed to replace results
produced through the paths above.
