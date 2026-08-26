# Independent report lanes

ARGUS has two independently owned report presentations over one shared evidence and scoring engine.

## Ownership

- Kyle Report: `src/reports/kyle/**`, owned by `@kylekmcconnell-arch`
- Enigma Report: `src/reports/enigma/**`, owned by `@Enigma-Fund`
- Shared report contracts and core renderers: jointly reviewed

Both owners can read and run both reports. The ownership boundary controls who may merge presentation changes.

## Permanent staging environments

- Kyle: https://argus-git-codex-staging-kyle-reports-kyle-mcconnells-projects.vercel.app
- Enigma: https://argus-git-codex-staging-enigma-kyle-mcconnells-projects.vercel.app

Each stable staging hostname selects its matching report lane. Inside staging or local development, append `reportLane=kyle` or `reportLane=enigma` to inspect the other renderer. Production ignores this parameter and exposes no style selector.

## Shared truth boundary

The following stay shared so the same saved report cannot produce conflicting facts or scores:

- evidence acquisition and provider receipts
- subject classification and project-token binding
- score calculation and decision readiness
- social activity and accusation evidence
- immutable saved report data
- report safety and provenance semantics

Layout, narrative order, typography, styling, and report-specific composition belong in the owner lane.

## Enforcement

The `report-lane-ownership` check runs from the protected target branch, not from pull request code. It enforces:

1. Only Kyle may change the Kyle report directory.
2. Only Enigma may change the Enigma report directory.
3. Shared report files require approval from the other owner.
4. Only Kyle may change the ownership policy.
5. The Kyle and Enigma staging branches reject changes authored by the other owner.

Production remains unchanged until an immutable report-lane commit is explicitly approved for promotion.
