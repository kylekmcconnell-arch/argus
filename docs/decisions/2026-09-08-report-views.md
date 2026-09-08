# Production and Developer report views

Kyle requested two views on 2026-09-08: Production and Developer. Developer uses the same report with evidence/debug tools, not an experimental layout.

- Production is the common narrative presentation for person, project, token, saved, and shared reports.
- Developer uses the same presentation slots, navigation, typography, scores, and frozen evidence. Its only additional presentation is a collapsed evidence/verification inspector below the decision summary.
- Only workspace owners can select Developer, preserving existing access rules. Public and non-owner reports always use Production.
- Retired Kyle and Enigma URL/local-storage choices resolve to Production. Raw resolves to Developer for owners. Managed selections rewrite old URLs and preferences to canonical IDs while preserving the report query and anchor.
- Component filenames under `src/reports/kyle` remain implementation history. They no longer correspond to separate selectable user experiences. Enigma-owned source files are not active registry entries.
- Kyle subsequently requested removal of personal approval requirements. Releases require automated checks, not Kyle/Enigma reviews; see `docs/report-lanes.md`.

Validation: 44 report-view tests; full suite 4,332 passing with one expected failure; typecheck, truth contract, offline canary, calibration, production build. Browser fixture verifies the two controls, evidence expansion, and 390px mobile width without horizontal overflow. No live scans or customer records are used by that fixture.
