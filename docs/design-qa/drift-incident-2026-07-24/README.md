# Drift incident-state QA

Reference subject: `@driftprotocol`

Observed production report before the fix:

- Report `PA-5C3EA0507AC844EDB554`, version 6, captured July 24, 2026.
- The hero rendered `N/A followers`, `joined N/A`, and `last posted 64d ago` with no official-account warning.
- The report described token conduct as solid and stated that no verified exploit appeared in the record.
- No visible reference to the April 1, 2026 protocol exploit appeared anywhere in the report.

`before-drift-report-hero.png` is the captured production baseline. The
post-deploy screenshot is added after a fresh immutable scan exercises the new
incident and X-account-state paths.
