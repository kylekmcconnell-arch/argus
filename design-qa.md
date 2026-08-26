# Style 2 dual-score restoration — design QA

## Evidence

- Source visual truth: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/style2-two-score-reference-hero.png`
- Rendered implementation: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/style2-dual-score-restored.png`
- Responsive implementation, initial: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/style2-dual-score-mobile.png`
- Responsive implementation, final: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/style2-dual-score-mobile-final.png`
- Source pixels: 1310 × 1049 at browser density 1.
- Implementation pixels: 1310 × 1167 full-page capture at browser density 1; browser viewport width 1310 CSS px.
- Mobile pixels: 390 × 2646 full-page capture at browser density 1; viewport 390 × 844 CSS px.
- State: light theme, completed report, Style 2, separate project-diligence and token-safety scores, six composition dimensions per score.
- Normalization: source and desktop implementation were captured in the same browser at the same 1310 CSS-pixel width and density. The implementation is taller because the retained canonical State of the House brief includes the evidence ledger directly below the opening.

## Full-view comparison

The original Style 2 reference and the restored implementation were opened together in one comparison input. The defining relationship is restored: narrative/verdict on the left and two independently labeled score cards on the right. Both cards retain the compact numeric hierarchy, semantic caution/pass colors, segmented evidence composition, current-segment label, per-dimension points, and explanation that the scores answer different questions.

The opening narrative differs intentionally from the original “Promising, with material gaps” headline. The current Style 2 keeps the approved “State of the house” narrative and the canonical concerns/credible/checks ledger so the design does not reintroduce the hardcoded EARN-only report body.

## Focused-region comparison

The score-card region was compared at readable size because the full report makes its labels too small to judge. Fonts, spacing, color, animation state, and copy were inspected directly:

- Fonts and typography: display hierarchy remains large and readable; score labels and evidence labels use the report’s mono language; the 54 and 79 numerals retain strong optical weight.
- Spacing and layout rhythm: the two cards share a balanced grid, matching padding and aligned tracks; the explanatory copy sits below both cards instead of being repeated.
- Colors and visual tokens: project caution uses amber, token pass uses green, and every segment uses the same score-composition semantic token as the full ledger.
- Image quality and assets: this region contains no logos, photography, illustration, or non-standard icon assets; no placeholder or approximate asset was introduced.
- Copy and content: “Project diligence score” and “Token safety score” are explicit, and the explainer says why the values must not be blended.

## Findings and comparison history

### Iteration 1

- [P2] Mobile score block began too close to the vertical story rule.
  - Evidence: `.codex-audit/style2-dual-score-mobile.png` showed the score kicker and explanatory copy starting against the left rule rather than aligning with the narrative column.
  - Impact: the score section looked clipped and visually detached from the approved document rhythm on a narrow screen.
  - Fix: added the same responsive inline start padding used by the narrative column to `.report-style-2 .decision-dual-scores`.

### Iteration 2

- Post-fix evidence: `.codex-audit/style2-dual-score-mobile-final.png`.
- The kicker, both score cards, and the explainer now align with the narrative measure; there is no horizontal overflow, clipped copy, or collision with the story rule.
- No actionable P0, P1, or P2 visual mismatch remains.

## Browser verification

- Primary state tested: Style 2 completed-report opening at desktop and 390 px mobile.
- Interactions tested: composition entrance animation, current-dimension label updates, responsive two-column-to-one-column transition.
- Browser console: a fresh local preview tab reported no application errors. Extension-only warnings from the pre-existing browser environment were excluded.
- Automated coverage: dual-score Style 2 rendering, Style 1 single-score preservation, report/investigation regression suites, TypeScript build, and production build.

## Follow-up polish

- [P3] The desktop implementation preserves more vertical breathing room than the dense original memo. This is acceptable because it follows the current approved State of the House reading style and improves legibility.

final result: passed
