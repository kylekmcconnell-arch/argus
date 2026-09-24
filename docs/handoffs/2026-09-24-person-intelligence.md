# Person source availability and background research

Issue #537; related launchpad and holder programme #525. Presentation 2026-09-24.2.

Implemented per-person source coverage independent from identity confidence. Retained links without receipts stay read-status unknown. First-party X profile enrichment freezes success/partial/failure receipts with time and explicit metadata-only scope. No link or provider failure becomes an adverse finding or proof of absent identity.

The People chapter can request bounded background research for a saved roster member without requiring X. The server loads the exact organization-scoped report, selects one unambiguous saved name/role, and uses up to four metered Serper queries and three guarded public page reads. It saves a separate supplemental receipt; snippets and page reads remain discovery evidence, never identity verification, scoring input or inferred common control. Request IDs prevent duplicate execution. Shared and private report surfaces omit the workspace action. Viewer reads are free; collection requires analyst role and supplemental admission. No paid live collection was run during implementation.

A service-only research table stores results separately from frozen report versions. Terminal completions cannot be changed. Prior research can be discovered across reports only for an identical first-party-bound X account in the same workspace; names and candidate accounts cannot join. Earlier reports remain unchanged. This is not a completed LinkedIn-only scored person audit or an automated verified venture-outcome timeline.

The Decision chapter now separates social-source and holder coverage from safety scores and links to the relevant evidence/actions. Existing decision briefs, dated evidence, relationship graph and holder comparisons remain the governing presentation.

Remaining programme: source-bound employment/outcome extraction and contradictions; full multi-entry scored person dossiers; independently validated cross-platform bindings; reliable globally ranked cross-chain holders and transaction-confirmed flows; complete eight-platform histories and historical CEX/stock-pair outcomes; shadow evaluation before predictive alerts. No claims of complete collection or validated trading performance are made.

Rollout requires protected CI, production database migration and production deployment. Rollback removes the UI/API entry points; supplemental receipts can remain archived without changing historical reports.

Validation: 5,364 passing offline tests plus one existing expected failure, seven offline canaries, 21 calibration subjects, all three type projects and production bundle. The saved Altcoinist preview was inspected through Decision-to-People navigation and the LinkedIn-only Endre evidence disclosure. Provider calls were mocked; no paid research was launched. Database permission and organization-binding tests run in protected CI.

Review also found that existing name-based record matching could present an adverse badge or include a lead explicitly targeting a different account. The renderer now excludes mismatched explicit targets, marks name-only joins neutral unresolved discovery, and calls exact-account adverse leads unverified concerns rather than findings. Reference regressions cover all three cases.
