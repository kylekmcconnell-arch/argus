# Report reliability pass — September 11, 2026

Scope: shared person, project and token report opening, score breakdown, source navigation, and supplemental launch evidence. Base: main at 9afe404. No saved scores or scoring rules change.

## Reproduced and repaired

| Defect | Repair and evidence |
| --- | --- |
| Missing counter metadata displayed zero concerns | Unknown, partial and explicit-zero counts remain distinct; unit regression covers all three. |
| Some missing reference counts erased the counts that were present | Preserve the known lower bound; label these references, not unique independent sources. |
| Completed-check percentage labeled evidence strength | Label completion directly; a completed check can contain an adverse finding. |
| Unassessed, deferred and irrelevant areas counted toward displayed maximum | Exclude them from the denominator and score-ring normalization. Saved score stays unchanged. |
| Finished count could coexist with “No check has finished yet” | Distinguish missing summaries from missing completed checks. |
| Missing explanation claimed a counter-signal was already weighted | Say the saved report does not explain its effect. Empty concern summaries no longer imply a clean investigation. |
| Duplicate composition IDs confused evidence navigation | Give the opening its own score-explanation ID. The investigation source overview points to the full breakdown, with a methodology fallback if absent. |
| Supplemental retry implied only gaps were rerun | Label it Refresh launch analysis and disclose the full bounded rerun and supplemental request. |
| All attributed launch findings called registry evidence | Label provider-reported evidence and list the providers attached to retained observation IDs. |
| One receipt was described as proving all indexed exits | Corroborate only the referenced transaction; require its block to agree with the indexer. Legacy overclaim display copy is corrected without rewriting stored evidence. |
| Parity traces ignored reverted ancestors | Propagate failure by trace-address ancestry, including out-of-order ancestors. Regression also preserves a successful sibling. |
| Curve fee rounding differed from the contract | Subtract separately rounded protocol and creator fees. Golden example: gross 99, fees 2 and 0, net 97. Compared with PonsV2BondingCurve.sol sell(), source checkout debbc21fb27761245356fe9b61a9276437147a1c. |
| Returned logs counted without identity/window validation | Reject wrong emitter/topic, removed entries and out-of-window blocks before counting sell records. |
| Future restrictions described as ended; getter called immutable proof | Compare end block with pinned block and describe the factory address as reported, not proof of immutability. |

## Verification and scope limits

Focused regressions exercise presentation and collector behavior using bounded provider fixtures; no paid scan is needed to reproduce these defects. Full tests, typecheck, build and protected-branch CI gate release. Live verification checks the shared report and existing saved launch evidence after deployment.

Supplemental refresh still reruns the full bounded collector. It does not selectively cache successful checks. Indexed trades remain provider claims even when a referenced transaction succeeded. Source counts do not establish independence. Existing snapshots are not silently rescored; new collector corrections apply to new supplemental runs.

Rollout: GitHub PR through protected main. No migration or new credentials. Rollback: revert the PR.
