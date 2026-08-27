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

Each stable staging hostname selects its matching report lane. Both owners can open both URLs, but each renderer is built from its own protected branch. There is no public style selector and no query-string override; inspect the other renderer by opening its staging URL.

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

Both staging branches are protected: direct and force pushes are disabled, administrators are included, conversations must be resolved, and a pull request needs one approval from someone other than its last pusher. That review gate prevents either owner from changing the other report without the other person seeing and approving it.

`CODEOWNERS` records the presentation boundary. The `report-lane-ownership` policy and its Node tests additionally enforce:

1. Only Kyle may change the Kyle report directory.
2. Only Enigma may change the Enigma report directory.
3. Shared report files require approval from the other owner.
4. Only Kyle may change the ownership policy.
5. The Kyle and Enigma staging branches reject changes authored by the other owner, except policy-only maintenance by the repository owner.

GitHub activates `pull_request_target` workflows only from the default branch. The automated ownership check is therefore staged but is not a required status check yet; it can replace the human approval gate after the workflow itself is explicitly approved into `main`.

Production remains unchanged until an immutable report-lane commit is explicitly approved for promotion.
