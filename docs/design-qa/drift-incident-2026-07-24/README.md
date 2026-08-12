# Drift incident-state QA

Reference subject: `@driftprotocol`

Observed production report before the fix:

- Report `PA-5C3EA0507AC844EDB554`, version 6, captured July 24, 2026.
- The hero rendered `N/A followers`, `joined N/A`, and `last posted 64d ago` with no official-account warning.
- The report described token conduct as solid and stated that no verified exploit appeared in the record.
- No visible reference to the April 1, 2026 protocol exploit appeared anywhere in the report.

Verified production result after the fix:

- Report `PA-EB14FDA3A2D04E398F2D`, captured July 24, 2026.
- The suspended account now routes back to the project methodology before
  role-aware research begins.
- The hero replaces generic profile `N/A` values with `X profile metrics
  unavailable` and `last observed post 64d ago`.
- A top-level material-risk block records the `$295M` April 1, 2026 incident,
  the DeFiLlama classification and technique, the unresolved return status, and
  the official X suspension as separate sourced warnings.
- The report completed all `7/7` applicable decision-critical checks, published
  a decision-ready `CAUTION 56`, and incorporated the incident into the scored
  project axes without treating the exploit as proof of fraud.

Files:

- `before-drift-report-hero.png` is the captured production baseline.
- `after-drift-incident-alerts.png` is the corrected production report.
- `before-after-drift-incident.png` places both states together for visual QA.
