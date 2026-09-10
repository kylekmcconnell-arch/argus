# Report logic review — 10 September 2026

Baseline: `720f016176f833940a90081ca5ca1241ae29ca92` (PR #392). Review only: no application changes or deployment in this batch. Production and Developer continue to use the same report renderer. No competing open PR was present at review start.

## Evidence and limits

Reviewed the path from subject resolution, collection and scoring through immutable persistence, completion contracts, common report rendering, copied summaries, exports and sharing. This is a cross-path review, not a claim that every branch of the code was exercised. Six synthetic diagnostic reproductions and 77 existing tests passed (83 total in seven files). The diagnostic tests assert current defects, not desired behavior, and are preserved as a text fixture outside CI.

A read-only production snapshot accounted for 86 latest reports: 12 had null scores, and none were collected after the latest releases. Two explicitly authorized targeted rescans were started through the normal authenticated production UI. One token investigation completed in 24.9 seconds, persisted its next immutable version under the same case, and changed its token score from 84 to 90. Its linked account assessment was omitted because the account bio did not contain a contract address. The resulting investigation was stored as complete, with six core token checks complete and six follow-ups open. The receipt correctly reported cost as unknown, not zero. The person rescan saved a new version in 250.0 seconds, recovering a previously null score to 31 while completing 5/10 required checks. Its receipt was correctly degraded, with estimated provider cost $0.80. All score axes were assessed, demonstrating that scoring coverage and required-check completion are distinct. Its broad facts pass accepted none of nine candidate leads, although another collection path recovered a source-backed relationship. This is too small a sample to estimate a failure rate or latency percentile.

Historical statements displayed on a fresh renderer remain historical evidence, not newly verified claims. Do not rewrite old payloads to make the corpus pass. No public sharing links were minted during this review.

## Findings to fix next

### 1. Unverified leads can become the headline main limitation (high priority)

`src/components/Report.tsx:2740` merges `subjectLeadNarrative` into `decisionCanvasConcerns`. `KyleIntelligenceDecisionCanvas.tsx:629` takes the first concern for the main limitation and reservation. A saved person report visibly led with an unverified accusation while a later section stated that no verified adverse finding was recorded. The qualifying text existed, but the decision hierarchy still promoted the lead.

Keep three typed collections: verified decision risks, unverified research leads, and evidence gaps. Only eligible risks may populate the headline limitation. Leads remain visible with explicit unverified status, without turning the absence of verified risks into an all-clear. Acceptance: a report containing only a model lead never uses that allegation as its verdict-driving reservation.

### 2. Website scoring confuses claims and negated warnings with wrongdoing (high priority)

`src/collect/projectverdict.ts` uses context-free regex matches. The synthetic phrase “Returns are not guaranteed. Investing is not risk-free.” triggers `manipulation_language` and caps the score at 25. A plain “100,000 users” claim is placed in `fabricatedMetrics` and generates a bad finding without evidence that it is false. Both are reproduced.

Parse claim scope, negation and speaker before scoring. A numeric claim is unverified until checked; fabrication needs contradictory evidence. Separate website content assessment from project diligence. Acceptance: risk disclaimers produce no guarantee penalty; an unverified number remains a verification question; an actual affirmative guaranteed-return claim remains detectable.

### 3. Token composition loses evidence metadata at the common renderer (high priority)

`InvestigationReport.tsx:813` maps axes to score/weight/rationale but omits support/counter counts and the new assessed/applicability metadata. The common canvas sums absent counts as zero. The fresh token report showed six assessed axes and a 90 score beside “0 source-backed score inputs.” Partial token axes also need the same unassessed treatment already introduced in standalone `TokenReport`.

Give token measurements explicit evidence references and pass assessment metadata through every renderer. Unknown citation counts must not display as measured zero. Acceptance: standalone token, embedded investigation, exports and saved versions agree about assessed weight and provenance.

### 4. A completed token assessment is being presented as a completed investigation (scope design)

`reportCheckContract.ts` deliberately waives the investigation graph requirement when the embedded account cannot bind; `reports.ts:143` then labels the whole record complete when core token checks finish. The live rescan demonstrated this: token safety finished, project diligence disappeared, and the report still stored `complete`.

Preserve the useful token score. Store and display separate outcomes for token safety, project/operator diligence and supplemental research. A token-only result is valid, but the report must say which scope finished and which was unavailable. Do not solve this by making every token say INCOMPLETE. Acceptance: one completed facet cannot imply that omitted facets were researched.

### 5. Account binding has too few safe routes (observed data gap)

`src/lib/investigation.ts:408` accepts only a verified `/api/x-authenticity` result. That endpoint principally checks the bio and a small set of linked landing-page hosts. The live token rescan rejected the linked account solely because no contract appeared in the bio.

Keep the mismatch protection from earlier repairs. Add independent deterministic routes: official-domain contract publication, exact-chain/address registry records with reciprocal official links, and verified migration records. Store the selected route and source. Names, tickers, and model confidence alone must never bind an account. Acceptance: an absent bio address can be resolved by sufficient alternate evidence; a conflicting address remains unresolved.

### 6. Copied token text still mislabels FDV and absent measurements (high priority)

`TokenReport.tsx:130` writes `d.mcap` as market cap and emits raw liquidity without consulting `marketEvidence`. The public API was repaired in #391, but this consumer retains the old fallback behavior. It also prints a raw saved verdict alongside the presentation verdict.

Serialize browser, API, copied text and exports from a shared measured-field presentation object. Name FDV separately and keep unknown values null. Acceptance: an FDV-only fixture never says circulating market cap; partial scores have consistent labels everywhere.

### 7. Share minting still has a mutable-version fallback (existing #380)

`Report.tsx:3214,3305` can give Copy Summary a mint callback outside `canShare`; `api/share.ts:46` accepts missing version IDs and resolves the current projection. Existing `api/share.test.ts` explicitly confirms that behavior. This was reverified with mocked storage; no live capability was created.

Require an explicit immutable version on the server and use the same eligibility gate for every share action. Private or pending reports may copy plain text without a share capability. Acceptance: summary text and linked content always reference the same saved version; absent-version mint requests fail.

### 8. Chain-aware identity stops short of the main report case (existing #329, extended)

The threat ledger and token API now use chain/address identity, but browser `syncReport` forwards the caller's address-only ref and `api/report.ts` persists that as the case canonical reference. The token API independently uses `chain:address`. `normalizeSubjectRef` also lowercases a chain-prefixed base58 reference (reproduced), although bare base58 is preserved.

Use a typed subject identity across browser/API/cases/share/delta/watchlist paths. Migration must preserve case history and quarantine ambiguous legacy chains. Acceptance: identical EVM addresses on two chains remain separate cases; browser and API converge for the same asset; Solana capitalization survives prefixed identities.

### 9. The strongest “verified” claim is inferred from a count (presentation defect)

`KyleIntelligenceDecisionCanvas.tsx:153` chooses a strongest axis from supportCount and calls it verified without receiving verification strength. A synthetic limited-support row is called the strongest verified part of the case. The same helper routes generic “audit the founder identity” wording to security/governance because `/audit/` wins the heuristic (reproduced).

Pass typed evidence strength and role-specific gap categories. Say source-attributed or self-reported when appropriate. Do not infer a security gap from generic workflow words. Acceptance: headlines cannot upgrade evidence confidence or substitute another role's unanswered question.

### 10. Organization links are described as verified team identities (live progress defect)

`server/orchestrate.ts:1513` stores linked organizations as `kind: org`. Its progress summary at line 1698 counts all artifact-backed webTeam entries without excluding organizations. The fresh person scan visibly named organization accounts as verified project team identities. This observation establishes a progress-label problem, not that those organizations necessarily received P1 person points.

Separate people, organizations and claimed relationships in progress and report prose. A fetched bio proves the claim was made; a follow edge does not prove an employment/incubator relationship. Acceptance: org accounts never contribute to a “people verified” count, and first-party affiliation claims retain their strength label.

## Methodology and evaluation improvements

- Keep score, assessed-weight coverage, source strength, safety overrides and collection scope as separate concepts. Preserve provisional numeric scores and adverse/identity overrides. Missing evidence must not create either free points or invented wrongdoing.
- Expose governing-role coverage separately from total multi-role coverage. Audit `audit.ts:709-773`: a person disclosure bonus still applies to every non-PROJECT role after rounding, and is disabled on partial coverage. Evaluate organization roles and boundary effects before changing the policy; do not quietly retune verdict thresholds.
- Make score changes comparable. A score moving after a rescan can reflect market movement, changed assessed weight, changed role routing, a provider replacement or a methodology change. `ScoreContext` displays raw deltas and `reportDelta` has no methodology-comparability contract. Explain the basis before calling it improvement or deterioration.
- Measure evidence yield: leads discovered, pages fetched, subject bound, predicate matched, facts accepted, and cost per accepted fact. The person scan's 0/9 facts-pass result needs a reason-by-reason review; it does not prove all nine leads were true or that verification should be weakened.
- Fix the rescan planner's reasons: it currently calls any non-null-score candidate “methodology_changed,” even when selected only for a quality error. Use actual failed invariant, availability of an alternate source and an estimated cost to prioritize targeted work.
- The calibration runner now invokes `assembleDossier`, so the old claim that it tests only `finalize()` is stale. It still does not cover live collection, persistence and rendering end to end. Add a small maintained corpus across person, founder, fund, project, EVM token, Solana token, site and no-account investigation, with wrong-identity, outage, checked-empty, sparse and adverse cases. Assert claim eligibility and cross-surface consistency, not only score ranges.

## Recommended implementation order

1. Correct false adverse website findings and headline promotion of unverified leads; add cross-surface claim invariants.
2. Fix token provenance mapping, FDV serialization and explicit facet completion; preserve the usable score.
3. Add safe alternate identity bindings, then rerun a small token/project cohort and compare coverage gained per request.
4. Require immutable share IDs and unify chain-aware case identity with migration fixtures.
5. Improve role-specific wording, score-change explanations and targeted retry planning.

Run the existing guard suites on each batch. Preserve #389's gutter, #387's graph fix, #385/#388's identity/provider truth repairs and #391/#392's assessed scoring/deadlines/adverse-search handling. Keep one Production/Developer report implementation and automated CI gates; no personal approval gate is needed.

## Reproducing the diagnostic evidence

Copy `report-logic.probe.test.tsx.txt` to `src/report-logic-review.probe.test.tsx` at the baseline, then run `npx vitest run src/report-logic-review.probe.test.tsx`. Remove the temporary file afterward. The six tests intentionally assert the problematic baseline behavior; they must be rewritten as desired-behavior regressions during repairs. `probe-results.txt` records the combined 83-test run.
