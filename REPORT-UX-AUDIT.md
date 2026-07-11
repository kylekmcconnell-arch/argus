# ARGUS investor-decision UX audit

Date: 2026-07-10
Flow reviewed: home → report library → completed person report → methodology → evidence ledger

## Executive finding

ARGUS already looks and feels like a serious investigation product. Its largest trust risk was not visual: a report could lead with `PASS 100` and call a founder “investment-grade” while the same report disclosed that only 1 of 9 applicable checks had a recorded outcome.

A score can summarize the evidence that exists. It cannot substitute for evidence that was never collected. Positive verdicts therefore need a separate due-diligence readiness gate.

## Flow health

1. **Home entry — healthy with caveats**
   - The main investigation task is clear and the visual tone is strong.
   - Recent-score cards need coverage, freshness, and report-state qualification before repeating a positive score.

2. **Report library — needs improvement**
   - Persisted reports and search are easy to understand.
   - Cards need decision readiness, age, version, collection state, and top unresolved risk.
   - The original destructive `×` control was ambiguous and too close to the verdict.

3. **Report hero — critical trust issue, now gated**
   - Subject identity and hierarchy are excellent.
   - The original `PASS 100` dominated every caveat and read as final clearance.
   - The updated hero separates the immutable scored-evidence verdict from investigation readiness. An under-covered positive score now presents as `INCOMPLETE`, with its preliminary model signal preserved for auditability.

4. **Methodology coverage — strong foundation**
   - Per-check states are exactly the right product direction.
   - Recorded outcomes, findings, unavailable providers, stale results, unknown checks, and not-applicable checks must remain distinct.
   - Lazy supplemental checks must not silently change the apparent completeness of a frozen report.

5. **Evidence ledger — good foundation, needs deeper auditability**
   - Claims already carry status, source count, and date.
   - Every visible source should be openable and safe, and every corroborator should ultimately be inspectable.
   - The complete target is claim → source excerpt/snapshot → retrieval time → content hash → affected scoring axis → conflicts.

## Priorities

### P0 — decision safety

- Gate positive verdicts on recorded investigation coverage.
- Preserve the underlying engine score without presenting it as clearance.
- Persist and rehydrate immutable report version, attestation, methodology, completeness, and check outcomes.
- Mark live legal and sanctions lookups as supplemental and not scored unless they are frozen into a new version.

### P1 — investor decision brief

- Above the fold, show: readiness, strongest evidence, highest risks, unresolved questions, freshness, and what could change the conclusion.
- Make all evidence inspectable, including every claimed independent source.
- Propagate readiness to recent-score, library, directory, watchlist, share, and exported-report surfaces.
- Move destructive actions out of the primary action row and use native accessible controls.
- Raise the contrast and size of critical metadata; much of the current faint 8–12px text is too difficult to read.

### P2 — product coherence

- Explain the relationship between Audits, Dossiers, and the Report library.
- Use the library’s empty space for decision-relevant density rather than decoration.
- Add report-to-report comparison and change history so investors can see what moved since the last diligence run.

## Evidence

- `01-home-entry.jpg` — home and recent-score entry
- `02-report-library.jpg` — persisted report library
- `03-report-hero.jpg` — original unqualified verdict hero
- `04-methodology-coverage.jpg` — 1/9 recorded outcomes beneath PASS 100
- `05-evidence-footer.jpg` — evidence ledger and methodology footer
- `06-updated-decision-readiness.jpg` — implemented readiness gate
- `07-before-after-comparison.jpg` — visual QA comparison
- `08-updated-home-readiness.jpg` — coverage-qualified recent investigation
- `09-updated-library-readiness.jpg` — partial-evidence report library state
- `10-final-report-readiness.jpg` — persisted version/attestation context

Screenshots are stored under `.artifacts/report-audit-2026-07-10/` and intentionally excluded from version control.

## Audit limits

This review used desktop screenshots, the accessibility tree/DOM, and selected implementation code. It is not a full WCAG conformance audit. Mobile reflow, browser zoom, complete keyboard traversal, screen-reader behavior, slow-network states, and production provider failures still require dedicated testing.
