# Score assessed evidence; disclose coverage separately

Owner decision: Kyle, 2026-09-08. Reports should give a useful score from available assessed evidence and clearly disclose data gaps, instead of defaulting to INCOMPLETE whenever a check or axis is missing.

## Rules

- Compute the score over assessed weighted axes only. Missing axes receive neither zero points nor positive credit.
- Example: 8/12 for identity and 20/28 for track record produce 28/40 = 70/100, labeled PROVISIONAL. State that 2 of 6 areas and 40% of the methodology weight were assessed.
- Keep expected applicable axes, assessed axes, assessed weight, total weight, and missing axis names on the frozen report in `score_coverage`. This is evidence coverage, not a statistical probability or calibrated confidence estimate.
- Do not apply the identity disclosure bonus to a partially assessed role.
- The lowest assessed role governs the numeric result. If any applicable role is only partially assessed or has no assessed axes, the overall result remains provisional. Missing roles are disclosed rather than assigned fabricated scores.
- An unresolved project token leaves token conduct unassessed, but other supported project areas can still produce a provisional score.
- Verified disqualifying caps and identity blocks remain effective. An impersonation block withholds the numeric score. No assessed axes also means no numeric score.
- Coverage remains partial, `presentation.final` remains false, and the result cannot become authoritative graph clearance merely because a provisional number exists.
- Public cards, Open Graph previews, watchlist presentation, and portable exports retain the provisional qualification. The person API keeps its final fields separate from its existing preliminary-model-signal fields.

## Compatibility

New scans freeze the new score and coverage metadata. Existing saved reports with a valid numeric model score can display it provisionally when coverage is partial. Old versions with a null score are not silently rescored or rewritten; a new scan is needed to create a newly scored immutable version.

This updates the earlier reliability review's score-withholding policy. Its data-integrity repairs still apply: failed sources stay unavailable, uncertain identity does not become a confirmed bind, and provisional is never final PASS.

## Verification changes

The three partial-axis calibration controls now expect explicit provisional scores rather than null scores. Their exact expected values follow weighted normalization; calibration still rejects final verdicts for insufficient-evidence controls and requires the engine's provisional coverage flag. Sparse/no-axis controls still require a null score. Hard-cap, impersonation, stale-check, export, public-card, and watchlist tests retain their respective safety assertions.
