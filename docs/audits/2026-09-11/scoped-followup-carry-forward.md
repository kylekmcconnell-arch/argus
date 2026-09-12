# Scoped follow-up proposals lost untouched evidence

Issue #407. Reproduced against `461ed848` and repaired on `codex/issue-407-carry-forward`.

## What was wrong

A bounded gap follow-up restricts the collector to the authorized capabilities. `api/gap-investigation.ts` then used the fresh dossier wholesale as the proposed report body and `personDossier.checkRuns` as the proposed checklist. Everything the scoped run was not allowed to assess therefore reappeared as `not_run` or `unavailable`, and the proposal's score came from a dossier that had assessed only a slice of the case.

The live `@matetokay` verification showed the shape exactly. The active version 2 (score 31, saved 2026-09-10) held five of ten required checks. A five-minute identity follow-up costing $0.45 produced proposal `d56fa8f2-607e-48a5-a0d1-35deb2cc0038` in which:

- `adverse-screen` went from `complete` to `unavailable`;
- `founder-asset-distinction` and `founder-repeat-backing` went from `complete` to `not_run`;
- no founder gap was recovered;
- the proposed score was 27 against the active 31.

Promotion would have replaced a better report with a worse one, and nothing in the flow said so.

## What changed

`src/lib/gapCarryForward.ts` merges the bounded run onto the source version.

- Checks the authorization did not select keep the source outcome, its original `completedAt`, `provider` and `sourceCount`, and gain a `carriedForward` stamp naming the source report version and observation time.
- Selected checks take the fresh outcome. A selected check whose retry failed to reproduce an outcome the source held is carried with reason `retry_did_not_reproduce` rather than dropped.
- Carried outcomes past a 90-day freshness horizon are carried as `stale`.
- `not-applicable` determinations are preserved.
- The merge emits a per-check disposition (`recovered`, `newly_measured`, `reconfirmed`, `carried_forward`, `carried_stale`, `retry_regressed`, `still_open`, `not_selected_open`, `not_applicable`) and a summary.

`api/gap-investigation.ts` freezes that comparison onto the proposal, persists the merged checklist, and stops splicing an incoherent number:

- A person proposal that carries decision-critical evidence the fresh scorer never saw publishes no score and no verdict. The bounded run's own number is kept as `gapInvestigation.scopedRunScore`, labelled as what that run alone assessed.
- A token + project follow-up keeps its frozen token score, and an integrated token re-run rescores everything it collected, so neither withholds.

Promotion fails closed in `promotionRefusal()`. A promote request is refused with 409 and the blocking reasons when the frozen comparison is not promotable, and also when a proposal carries no frozen comparison at all — which is how proposal `d56fa8f2-607e-48a5-a0d1-35deb2cc0038` is refused without touching stored data.

`api/_provenance.ts` records `carriedForward` and `measuredInThisRun: false` in `check_runs.metadata`. The row's `finished_at` already came from the check's own `completedAt`, so a carried row keeps its original observation time in provenance too. No migration was needed: `attestation_state` still describes the run, and the metadata stamp is what distinguishes carried rows.

On screen, `MethodologyChecklist` labels a carried row "Kept from the earlier report (checked YYYY-MM-DD); this follow-up did not re-run it.", and ARGUS Eye shows a "What changed against the active report" panel separating closed, newly measured, re-confirmed, kept, stale-kept, retry-regressed and still-open areas. When the proposal is not promotable the Promote button is replaced by "Promotion unavailable" with the reason.

## Regression coverage

`src/lib/gapCarryForward.test.ts` (18 cases) covers scope selection, the narrow person follow-up preserving unrelated completed checks, one selected check resolving while another stays unavailable, provenance survival, stale carried evidence, not-applicable preservation, legacy label-only rows, retry regression, no-progress, and the promotion gate in both directions.

`api/gap-investigation.test.ts` adds the end-to-end `@matetokay`-shaped fixture asserting carried rows, withheld score, frozen comparison and response payload, plus promote-gate cases for a blocked proposal, a pre-carry-forward proposal, and an unaffected rollback.

`src/components/ArgusEyeAssistant.test.tsx` and `src/components/MethodologyChecklist.test.tsx` cover the two user-visible surfaces.

## Still true after this change

The endpoint still creates only an inactive proposal, still binds chain, contract, handle, organization and source version, and still preserves immutable base versions. A scoped follow-up that recovers nothing still costs money; that limitation is unchanged and is now stated in the proposal rather than hidden behind a lower score.

Coherent rescoring over merged evidence remains future work. The engine builds its axes during collection, so recomputing a person score over carried evidence would mean replaying frozen evidence into a new `Audit`. Until that exists, a person proposal with carried evidence is a review artifact, not a promotable replacement.
