# Authorized evidence-gap investigations

Argus Eye remains a frozen-report reasoning surface. It never turns a question into unrestricted search. When the saved question director identifies an open evidence gap, the Eye may instead present a separate bounded authorization.

## Authorization contract

The server binds one authorization to:

- the authenticated organization and analyst;
- the exact active source report version and case;
- one open saved Intelligence Spine question;
- task IDs already present in the source report's saved research plan;
- capabilities and allowlisted delegates derived by the server from those tasks;
- an expiry, a wall-clock limit, and an accepted estimated cost ceiling.

The browser cannot supply capabilities or specialist names. Identity and synthesis gates can be added only when the frozen director already selected those workstreams. Blocked, completed, invented, or out-of-plan tasks are rejected before provider work starts.

## Proposal lifecycle

The bounded collector re-runs identity, attribution, source-lineage, graph-integrity, provenance, and scoring gates. Candidate evidence, check outcomes, observed cost, and execution receipts are persisted under a new immutable report version marked `proposed`.

Proposal persistence and restoration of the exact source projection happen in one database transaction. The active report therefore remains visible and unchanged while the proposal is reviewed.

A normal activation call rejects a proposed version. An active analyst must explicitly promote it through `promote_gap_investigation_proposal`, which still applies the existing report-quality, graph, and lineage activation guards. The analyst may instead roll it back, leaving it inactive and preserving its audit receipt.

## Evidence preservation

A bounded follow-up runs only the authorized capabilities, so every check outside that scope comes back absent rather than disproven. The proposal therefore merges the fresh run onto the source version instead of replacing it.

- Inside the authorized scope the fresh outcome wins. A closed gap is recorded as newly measured work.
- Outside the authorized scope the source outcome is carried with its original observation time, provider and source count, plus a `carriedForward` stamp naming the version it was measured in. A carried row never reads as work this run performed, on screen or in `check_runs` metadata.
- A carried outcome past its freshness window is carried as `stale` rather than as a current result.
- When a selected retry fails to reproduce an outcome the source already held, the evidence is carried with an explicit "the retry did not reproduce it" reason instead of being dropped.
- `not-applicable` stays `not-applicable`: applicability is a property of the subject, not of this retry's budget.

The proposal freezes an evidence comparison under `gapInvestigation.evidenceComparison` that separates recovered, newly measured, re-confirmed, carried, stale-carried, retry-regressed and still-open areas, so a reviewer sees the trade before promoting anything.

## Scoring and promotion

Only a person follow-up derives its own number: the bounded collector rescores from the axes it just built. A token + project follow-up keeps the frozen token score it did not touch, and an integrated token re-run rescores everything it collected.

When a person proposal carries decision-critical evidence the fresh scorer never saw, its coverage and its score would have different bases. The proposal therefore keeps the merged evidence but publishes no numeric score or verdict; the bounded run's own number stays visible as `gapInvestigation.scopedRunScore`, labelled as what that run alone assessed. This is deliberate: an old score is never spliced into a fresh partial dossier.

Promotion fails closed. `/api/gap-investigation` refuses a promote request when the proposal's frozen comparison reports a block:

- `carried_evidence_not_rescored` — the proposal carries evidence its score does not describe.
- `decision_critical_evidence_regression` — the merged proposal would still lose a decision-critical outcome the active version holds.
- `no_progress` — the follow-up closed nothing the active version was missing.
- `evidence_comparison_missing` — the proposal predates evidence carry-forward, so its coverage cannot be verified against the source version.

A blocked proposal stays inactive and reviewable, and the analyst can roll it back. Closing the gap authoritatively requires a fresh full assessment.

## Current increment

Execution is available for saved person reports, newly saved standalone token reports, and saved token + project investigations. For a token + project investigation, the authorization re-runs only the saved project-account specialist plan, replaces that project-account evidence inside a copy of the source investigation, and preserves the source token, market, contract, liquidity, recon, and wallet evidence unchanged. The result remains an inactive proposed investigation version until an analyst promotes it.

A newly saved standalone token report freezes one coarse integrated token-refresh task when a retryable contract, trading, holder, wallet, market, or sanctions check remains open. That task names the complete allowlisted collector delegate set because those providers feed one coherent token score and cannot safely be invoked as independent person-research specialists. An authorization may run only that exact saved task. It performs a fresh server token audit, creates an inactive token proposal, and leaves the source version unchanged. Project documents, news, GitHub, and trust-graph gaps are not advertised as token-refresh work because the standalone collector cannot answer them; those require a bound token + project investigation.

Older standalone token reports without this frozen plan continue to fail closed. Rescanning and saving the token creates a current report with the bounded plan when a compatible retryable gap exists.

The migration in `supabase/migrations/20260823204751_gap_investigation_proposals.sql` must be reviewed and explicitly approved before it is applied to production. Application deployment alone does not create or alter these production tables or functions.
