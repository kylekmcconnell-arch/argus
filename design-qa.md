**Source visual truth**

- `/Users/kyle/Downloads/Screenshot 2026-08-22 at 4.49.57 PM.png`
- Source pixels: 3396 × 2112 (`@2x`; 1698 × 1056 CSS-equivalent desktop viewport).
- State: authenticated `$STONKBROKER` investigation report, dark theme, desktop sidebar and report toolbar visible.

**Implementation evidence**

- Browser-rendered dark screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/argus-green-accent/implementation-dark.png`
- Browser-rendered light screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/argus-green-accent/implementation-light.png`
- Full comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/argus-green-accent/comparison-full.png`
- Focused header comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/argus-green-accent/comparison-focus.png`
- Implementation pixels: 3396 × 2112 (`deviceScaleFactor: 2`; 1698 × 1056 CSS viewport).
- Density normalization: source browser chrome was removed with a 56 px top crop; source and implementation content were compared at equal pixel width and equal 2056 px content height.
- State: desktop report shell, selected navigation, dark and light themes, Case Brief visible.

**Findings**

- No actionable P0/P1/P2 differences remain on the four requested surfaces.
- The green selected navigation is intentionally more prominent than the black source state and remains visually contained within the existing rail geometry.
- The Case Brief button changes from neutral white/black to the same ARGUS green without changing its size, placement, or interaction affordance.
- The eye grows from 26 to 32 CSS px and keeps the existing dotted vector asset; only its iris changes to brand green.
- The `v3.0` chip is cleanly removed without leaving a visible spacing gap.

**Required fidelity surfaces**

- Fonts and typography: unchanged families, weights, sizes, line heights, and wrapping. The focused comparison shows no typography drift caused by the accent pass.
- Spacing and layout rhythm: the 64 px sidebar header, 248 px rail, toolbar height, pill radii, and control spacing remain stable. No document-level horizontal overflow was detected.
- Colors and visual tokens: dark brand `rgb(0, 200, 5)` on `rgb(6, 16, 6)` is 8.54:1; light brand `rgb(0, 168, 107)` on `rgb(4, 18, 13)` is 6.21:1. Both exceed WCAG AA for normal text.
- Image quality and asset fidelity: the existing ARGUS vector mark is retained at 32 CSS px with no rasterization, halo, crop, or replacement asset.
- Copy and content: only `v3.0` is removed. Report copy, evidence, scores, labels, and toolbar actions are unchanged.

**Primary interactions tested**

- Selected navigation renders with `aria-current="page"` and the brand foreground/background pair.
- Case Brief renders as the existing primary action with the additive `btn-brand` treatment.
- Theme switching was verified in light and dark rendered states.
- Browser console warnings/errors: none in the final capture harness.

**Comparison history**

- Initial pass: implementation screenshot capture was blocked by the selected in-app browser.
- Fix: user approved a headless browser solely for pixel capture. A real browser render was captured at the source viewport and combined with the source image.
- Post-fix evidence: `comparison-full.png` and `comparison-focus.png` show the requested emphasis changes without P0/P1/P2 layout, typography, asset, or copy regressions.

**Implementation checklist**

- [x] Use ARGUS green for active navigation.
- [x] Remove the sidebar version badge.
- [x] Increase the sidebar eye and color its iris with the brand token.
- [x] Use the same brand green for Case Brief.
- [x] Verify both themes, contrast, responsive width, interactions, console, tests, typecheck, build, and lint.

**Follow-up polish**

- None required for this scope.

final result: passed
