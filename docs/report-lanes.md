# Report presentation lanes

ARGUS serves three editorial report presentations and one Raw Evidence verification view from the production origin over one shared evidence and scoring engine.

## Ownership

- Production Report: `src/reports/production/**`, jointly reviewed and public by default
- Kyle Report: `src/reports/kyle/**`, owned by `@kylekmcconnell-arch`
- Enigma Report: `src/reports/enigma/**`, owned by `@Enigma-Fund`
- Raw Evidence: `src/reports/raw/**`, jointly reviewed and deliberately non-editorial
- Shared report contracts and core renderers: jointly reviewed

Both active ARGUS owners can read and run every presentation. The ownership boundary controls who may merge presentation changes.

## One production origin

- Canonical application: https://argus-one-flax.vercel.app
- Public, shared-link, analyst, and viewer sessions always use Production.
- Active owners see a `Production / Kyle / Enigma / Raw` selector in the authenticated workspace.
- An owner selection uses `reportView` in the URL and local storage so it is linkable and survives navigation.
- The authorization check wins over the URL. A non-owner who receives an internal view link is returned to Production and the parameter is removed.

The selector changes only the viewing definition. It does not create or select a different report version. Production, Kyle, and Enigma are editorial interpretations; Raw is the verification view over the same frozen record.

## Shared truth boundary

The following stay shared so the same saved report cannot produce conflicting facts or scores:

- evidence acquisition and provider receipts
- subject classification and project-token binding
- score calculation and decision readiness
- social activity and accusation evidence
- immutable saved report data
- report safety and provenance semantics

Layout, narrative order, typography, styling, and report-specific composition belong in the owner lane.

All three editorial presentations currently use the synchronized narrative report baseline: sticky contents navigation, readable report typography, and separate project-diligence and token-safety scores. They diverge only through future changes made inside their owned directories. Raw Evidence adds no narrative synthesis; it exposes the score records, coverage, evidence ledger, sources, and methodology used by every presentation.

## Enforcement

`CODEOWNERS` records the presentation boundary. The `report-lane-ownership` policy and its Node tests additionally enforce:

1. Only Kyle may change the Kyle report directory.
2. Only Enigma may change the Enigma report directory.
3. Production, Raw Evidence, and shared report files require approval from the other owner.
4. Only Kyle may change the ownership policy.

The policy runs against pull requests into protected `main`. Kyle and Enigma work on short-lived branches, see each other's presentation in the production selector after merge, and cannot modify the other owner's directory.

Promotion is an explicit reviewed change into `src/reports/production/**`. A selection in the browser cannot promote a renderer and cannot change saved evidence or scoring. Lane-owned synthesis enters shared report surfaces only through the neutral renderer slots in `ReportLaneDefinition`; shared components never import an owner lane directly.
