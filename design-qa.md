# Design QA — investigation report storytelling

- Source visual truth: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/stonkbroker-report-audit/01-verdict-opening.png`
- Implementation screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/stonkbroker-report-implementation/design-qa-implementation-mobile-top.png`
- Combined comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/stonkbroker-report-implementation/design-qa-comparison-mobile.png`
- Additional responsive evidence: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/stonkbroker-report-implementation/design-qa-implementation-desktop.png`, `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/stonkbroker-report-implementation/design-qa-implementation-mobile-expanded.png`
- Source pixels: 673 × 1513
- Implementation pixels: 658 × 1173 from a 673 × 1200 CSS viewport; the in-app browser excludes its scrollbar from the captured image width
- Density normalization: source and implementation were compared at the same 673px design width; the implementation was scaled from 658px to 673px only for the side-by-side comparison
- State: light theme, saved `$STONKBROKER` report, evidence ledger collapsed for the primary comparison

## Findings

No actionable P0, P1, or P2 differences remain.

- The prior visual truth led with the verdict but then repeated the 93 score in a separate card before reaching the decision brief. The implementation keeps the existing verdict and provenance treatment, removes the duplicate ready-state score card, and places the decision brief immediately beneath the story navigation.
- The approved editorial hierarchy is visible at the first viewport: verdict → clear section navigation → strongest evidence / sharpest concern / change condition → ranked support and concern lists.
- The sharpest concern has a distinct amber boundary and remains text-labeled; meaning does not rely on color alone.
- Evidence is not removed. Additional support/concern items and the complete score ledger remain available through native, keyboard-operable disclosure controls.
- The narrow layout has no document-level horizontal overflow (`document.body.scrollWidth` 662px at a 673px viewport). The section navigation retains its intentional internal horizontal scrolling behavior.
- The evidence disclosure was opened in-browser and exposed all five score rows. No console warnings or errors were recorded in the clean verification tab.

## Required fidelity surfaces

- Fonts and typography: existing ARGUS sans/mono hierarchy is preserved. The verdict remains the primary display statement; evidence metadata remains mono; the decision brief adds no unrelated font treatment.
- Spacing and layout rhythm: the new decision argument uses three equal cards on wide screens and a single readable stack on narrow screens. Above-the-fold hierarchy is materially clearer without compressing body copy.
- Colors and visual tokens: only existing pass, caution, signal, ink, panel, and line tokens are used. No new palette or gradient was introduced.
- Image quality and asset fidelity: no new raster or illustrative assets were required. Existing Phosphor icons and ARGUS report primitives are reused; no CSS, inline-SVG, emoji, or placeholder art was added.
- Copy and content: the original score, verdict, support, concern, check progress, saved timestamp, and evidence language remain present. Navigation uses the approved plain labels: Brief, Risks, Market, People, Evidence, Method, Challenge.

## Interaction checks

- Story navigation renders and resolves to report anchors.
- Evidence disclosure starts collapsed and opens successfully.
- Five score rows appear after opening the evidence ledger.
- Additional evidence disclosures preserve items beyond the three ranked leads.
- No Vite error overlay appeared.
- Clean verification tab console: 0 errors, 0 warnings.

## Comparison history

First comparison: no P0/P1/P2 fidelity issues were found. The implementation intentionally omits application chrome in the dev-only visual harness; production verification will cover the authenticated report shell after deployment. No visual-fix loop was required.

## Follow-up polish

- P3: consider replacing the persistent provenance legend with a small help popover in a later iteration. It remains unchanged here to avoid reducing evidence transparency.

final result: passed

---

## Issue #120 follow-up · plain-language verdict hero

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-22 at 7.46.30 PM.png`
- Implementation screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/report-verdict-hero-120/implementation-desktop.png`
- Narrow implementation screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/report-verdict-hero-120/implementation-mobile.png`
- Combined comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/report-verdict-hero-120/comparison.png`
- Viewports: default desktop preview and 673 × 1200 narrow check
- State: light theme, saved `$STONKBROKER` PASS report with score 93

### Findings

No actionable P0, P1, or P2 differences remain. The existing hero grid, score
ring, typography, spacing, color tokens, provenance marks, and responsive
stack are unchanged. Only the reader-facing copy changed. The longer headline
wraps cleanly, the exact 26/26 and 18/24 figures stay visibly marked as derived,
and the narrow page has no document-level horizontal overflow (658px body in a
673px viewport).

### Required fidelity surfaces

- Fonts and typography: unchanged ARGUS display, body, and mono treatments.
- Spacing and layout rhythm: no CSS or layout changes; the current two-column
  hero and narrow stack remain intact.
- Colors and visual tokens: unchanged PASS, ink, line, and provenance tokens.
- Image quality and asset fidelity: no assets were added or replaced.
- Copy and content: vague analyst phrases were replaced with a direct result,
  plain descriptions of contract ownership and liquidity concentration, and a
  clear evidence affordance. Recorded scores and rationales remain the inputs.

### Interaction and console checks

- Desktop and 673px narrow states rendered successfully in the in-app browser.
- The hero remained readable with the score ring, saved date, and provenance
  legend intact.
- Console check: 0 errors and 0 warnings.

### Comparison history

The first comparison found no P0/P1/P2 visual mismatch because the change uses
the existing #119 layout and tokens without modification. No visual-fix loop
was required.

final result: passed
