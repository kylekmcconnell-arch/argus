# Style 2 design QA

## Comparison setup

- Source visual truth:
  - `/Users/kyle/Downloads/Screenshot 2026-08-18 at 2.04.59 PM.png` (opening narrative)
  - `/Users/kyle/Downloads/Screenshot 2026-08-18 at 2.05.06 PM.png` (score composition)
  - `/Users/kyle/Downloads/Screenshot 2026-08-19 at 6.12.18 PM.png` (team narrative)
- Rendered implementation:
  - `.codex-audit/03-style2-final-opening.png`
  - `.codex-audit/04-loading-terminal.png`
  - `.codex-audit/06-team-narrative.png`
  - `.codex-audit/07-score-composition.png`
- Combined comparison evidence: `.codex-audit/05-opening-comparison.png`
- Local route: `http://127.0.0.1:4173/?design-preview=argus-eye`
- State: saved token investigation, Style 2 selected by default, light report theme; separate dark research-loading state also checked.
- Viewport: browser capture at 1110 × 1049 CSS px, device scale factor 1.
- Source pixels: opening reference 2356 × 1520. Implementation pixels: 1110 × 1049. The combined comparison scales both images into equal 760 px-high frames with `object-fit: contain`; this is a hierarchy and composition comparison rather than pixel-for-pixel alignment because the production implementation retains ARGUS navigation and report chrome that are absent from the Auric mock.

## Findings

- No actionable P0, P1, or P2 differences remain.
- [P3] Product chrome makes the live report denser than the standalone Auric mock.
  - Location: full report opening.
  - Evidence: the Auric source devotes the full canvas to the document; ARGUS retains its sidebar, saved-report banner, official links, and report actions.
  - Impact: the editorial opening has less whitespace, but all report controls and provenance remain available.
  - Classification: accepted product constraint; removing the chrome would reduce report utility and was not requested.
- [P3] Some saved reports will not show a seven-row score table because only dimensions actually present in the saved evidence are rendered.
  - Location: score composition.
  - Evidence: the Auric mock has seven illustrative dimensions; the implementation uses the canonical saved axes and does not invent absent dimensions.
  - Impact: row count varies by report, while the interaction and weighted-points explanation remain consistent.
  - Classification: intentional data-integrity constraint.

## Required fidelity surfaces

- Fonts and typography: passed. Style 2 uses a materially larger editorial headline, darker body copy, stronger weights, more generous line height, and readable score rows. The state-of-the-house phrase now stays on one line at the tested desktop width; mobile CSS allows it to wrap.
- Spacing and layout rhythm: passed. The opening uses a stable two-column text/ring grid, clear chapter spacing, a readable document measure, and larger team/score rows. No report content was removed to create the editorial treatment.
- Colors and visual tokens: passed. Report surfaces preserve ARGUS neutral paper tones, ink contrast, green evidence accents, and amber caution states. The research screen is intentionally black/dark green and remains scoped to that workflow.
- Image quality and asset fidelity: passed. Stored official X CDN portraits are preserved and rendered at 48 px; untrusted avatar URLs are rejected and the existing safe fallback remains. No source image or logo was replaced with CSS art, emoji, or a handmade SVG.
- Copy and content: passed. The opening states what the subject does, explains why the saved score was reached, and derives both from canonical saved evidence. Team prose distinguishes subject-named people, independently confirmed people, and identity-bound profiles.
- Icons and controls: passed. Existing icon family and button treatments are preserved. Style 1/Style 2 buttons expose `aria-pressed` and remain keyboard buttons.
- Responsiveness and accessibility: passed for the tested desktop viewport and CSS breakpoint review. Contrast is stronger, visible controls retain labels, mobile wrapping rules are present, score animation respects the existing motion system, and the loading ETA has an accessible label.

## Interaction and runtime checks

- Style 2 is selected when `reportStyle` is absent.
- Style 1 can be selected and retains Web & product, Market, People, Connections, and the canonical report body.
- Returning to Style 2 removes the opt-in query parameter and restores the narrative opening.
- The score ring names the active dimension when composition exists and names the saved score while the fallback ring fills.
- The dark research screen shows a stage-based estimated time remaining.
- Browser console checked: no application errors. Only unrelated browser-extension warnings and the normal Vite/React development messages appeared.
- Automated verification: 376 test files / 3,977 tests passed; TypeScript passed; production build passed.

## Comparison history

1. Initial comparison found a P2 headline-wrap issue: “The state of the house” broke across two lines inside the already separate state line, weakening the Auric-style lockup.
2. Fix: reduced the desktop fluid display size slightly, removed the restrictive character width, and kept the accent phrase together above the mobile breakpoint.
3. Post-fix evidence: `.codex-audit/03-style2-final-opening.png` and `.codex-audit/05-opening-comparison.png` show the subject on one line and the complete state-of-the-house phrase on the next, matching the reference hierarchy.

## Implementation checklist

- [x] Style 2 is the default for every report type.
- [x] Style 1 remains available and uses the same report data and sections.
- [x] Product explanation and state-of-the-house narrative lead the report.
- [x] Weighted score composition is larger, expandable, and source-grounded.
- [x] Team narrative and trusted stored portraits are preserved.
- [x] Ring-filling animation names what is being added.
- [x] Research loading state uses a dark terminal treatment and live ETA.
- [x] Full tests, typecheck, build, visual comparison, interactions, and console were checked.

## Follow-up polish

- Consider a future “reading mode” that temporarily collapses global app chrome for long-form reports, without removing provenance or actions from the saved report.

final result: passed
