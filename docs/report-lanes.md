# Report views and release checks

ARGUS has two views over one report presentation and one evidence/scoring engine.

- Production is the default for public, shared-link, analyst, and viewer sessions.
- Developer uses the identical report with an expandable evidence/verification inspector. Workspace owners can select it in the authenticated workspace.
- Old Kyle and Enigma selections resolve to Production. Old Raw selections resolve to Developer for owners. The URL and local-storage settings are migrated without changing report identity.

The renderer registry shares decision, connection, social, and GitHub presentation slots. Component names under `src/reports/kyle` are implementation history, not separate views or exclusive editing boundaries. Evidence acquisition, subject classification, score calculation, saved reports, and provenance stay shared.

## Release policy

On 2026-09-08 Kyle explicitly removed the Kyle/Enigma approval requirements. Neither person's approval is required to merge or release changes. The custom ownership workflow, policy scripts, and CODEOWNERS assignments are retired.

Changes still go through pull requests into protected `main`. Required automated checks are `agent-context`, `database`, `verify`, and `Vercel`. Strict branch currency and conversation resolution remain enabled. Force pushes and branch deletion remain disabled. Ordinary repository write permissions still apply.

A successful merge to `main` triggers the production deployment. Browser view selection never publishes code or changes saved evidence or scores.
