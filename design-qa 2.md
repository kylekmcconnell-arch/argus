# ARGUS Eye floating assistant design QA

- Final result: passed
- Reviewed state: existing frozen investigation report visible, ARGUS Eye open as a non-modal floating assistant
- Browser CSS viewport: 1280 × 720 at 1× density
- Browser capture: `/tmp/argus-eye-floating-local.png` (970 × 720 visible in-app capture)
- Focused implementation capture: `/tmp/argus-eye-floating-qa.png` (970 × 720; assistant temporarily shifted left only to normalize the in-app browser's cropped capture)
- Source visual truth: `/var/folders/h7/6njc4p9d12s5cjfrwk2sr2080000gn/T/codex-clipboard-888c6a1d-8f68-443b-9f14-b9a9e6a17230.png` (1487 × 1058)
- Side-by-side focused comparison: `/tmp/argus-eye-floating-comparison.png` (830 × 650)

## Findings

No actionable P0, P1, or P2 differences remain for the corrected interaction model. The static report is the primary surface, the assistant remains fixed above it, and opening or closing the assistant does not replace report content or disable the connections graph.

## Required fidelity surfaces

- Fonts and typography: the assistant uses ARGUS's existing display, body, mono, weight, line-height, and uppercase eyebrow conventions. Dense evidence copy remains readable at the compact support-chat width.
- Spacing and layout rhythm: the 390 px desktop panel, 24 px mobile viewport gutters, compact header, scrollable answer area, and pinned composer follow the selected mock's proportions. The panel is capped against viewport height and does not introduce a modal overlay.
- Colors and visual tokens: existing `signal`, `panel`, `line`, `pass`, `caution`, `avoid`, and ink tokens reproduce the selected blue Eye surface without introducing a parallel palette.
- Image quality and asset fidelity: no raster assets were required. All visible controls use the repository's Phosphor icon system; no placeholder, CSS-drawn, or handcrafted SVG assets were introduced.
- Copy and content: the component clearly says `Report only`, distinguishes source-bound identity from legal or wallet control, labels rejected namesake evidence, and states that answers use frozen report evidence.

## Full-view comparison evidence

The browser-rendered report remains visible beneath the Eye panel, including the saved-report status, investigation title, score/readiness cards, and page navigation. The assistant is a conventional lower-right support surface rather than a new report mode or workspace. DOM bounds after the production-position render were x=870, y=76, width=390, height=624 within the 1280 × 720 CSS viewport.

## Focused comparison evidence

The combined comparison uses the selected mock's lower-right Eye composer on the left and the implementation's expanded assistant on the right. The implementation retains the blue Eye header, compact card treatment, prompt/input affordances, close control, and elevated lower-right launcher. It intentionally expands the selected compact composer to include the report-specific `What matters now`, current evidence status, rejected conflict, investigative prompts, answer thread, and citations requested for the production experience.

## Comparison history

1. P1 from the prior implementation: opening ARGUS Eye replaced the complete report with a separate three-column workspace. Fixed by removing the report-level conditional and mounting a fixed assistant after the unchanged report content. Post-fix browser evidence shows the report title and report cards remain visible while the Eye dialog is open.
2. P1 from the prior implementation: the Eye chat was nested inside a separate reasoning page and therefore unavailable while reading ordinary report sections or the existing connections graph. Fixed with a persistent lower-right launcher and viewport-fixed panel.
3. P2: the selected mock's composer alone did not explain what the assistant knew before the first question. Added a source-honest report briefing, identity status, rejected-conflict notice, and three useful investigation prompts.
4. P2: the in-app browser capture cropped the production-position panel even though DOM bounds showed it inside the CSS viewport. Normalized the focused evidence capture by shifting only the capture fixture left, then restored and rechecked the production `right: 1.25rem` position.

## Interaction and runtime checks

- Floating launcher opens the assistant and exposes `aria-expanded` and `aria-controls`.
- Close control hides only the assistant; the report remains mounted and visible.
- `#argus-eye` opens the floating panel directly without changing report layout.
- Suggested prompts and custom questions post to `/api/ask` with the immutable `reportVersionId`.
- Responses render safe source links and preserve explicit loading/error states.
- Saved-report absence disables questions and explains that the report must be saved first.
- Primary browser interactions passed in the in-app browser; no error boundary, broken control, or Vite runtime error appeared in the reviewed state.
- Production question verification initially exposed an extension-resolution failure in the existing `/api/ask` function. The runtime import was corrected, redeployed, and the same STONKBROKER prompt then returned a grounded frozen-report answer with no production 500s.
- Component and report regression tests: 33 passed.
- Typecheck, scoped lint, and production build passed.

## Follow-up polish

- P3: retain the compact launcher-only state on narrow mobile screens if future usability testing shows the text label competes with browser controls.

final result: passed
