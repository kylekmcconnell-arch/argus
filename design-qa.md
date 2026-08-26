# Canonical report and scan-theme repair - design QA

## Evidence

- User reference: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 11.22.39 AM.png`
- Desktop implementation: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/report-desktop.jpg`
- Light scan implementation: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/light-scan-screen.jpg`
- Responsive implementation: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/report-mobile.jpg`
- Same-input comparison: `/Users/kyle/Documents/ARGUS-earn-report-style2/.codex-audit/report-comparison.jpg`
- Reference pixels: 1315 x 842.
- Desktop implementation pixels: 1310 x 1105 at browser density 1; its top 842 pixels were used for the direct comparison.
- Mobile report pixels: 319 x 3118 at browser density 1.
- Light scan pixels: 319 x 724 at browser density 1.
- Tested state: light theme, active investigation progress, canonical Style 2 report opening, and separate token-safety and project-diligence scores.

## Full-view comparison

The reference and implementation were placed together in one 2625 x 842 comparison input. The reference exposes a P1 layout collision: the unbroken “The state of the house” accent continues beneath the score cards. The implementation keeps the same narrative-and-two-score composition while constraining the narrative grid item and allowing the accent to wrap inside its own column. No title text crosses the card boundary.

The scan workspace was also checked in the product’s active light theme. Its computed workspace background and document background both resolve to `rgb(247, 247, 245)`, so the investigation surface no longer substitutes a black terminal palette inside the light application shell.

## Focused comparison

- Typography: the State of the House display treatment remains prominent; the title wraps without clipping, shrinking, or overlapping the score cards.
- Spacing and layout: the narrative and dual-score regions preserve their desktop grid and collapse into a readable single-column mobile flow.
- Colors and tokens: the scan workspace now consumes the active global theme tokens; light mode is consistently light while the existing dark theme remains available through the application theme system.
- Images and assets: no image, logo, or icon asset changed in this repair, and no placeholder asset was introduced.
- Copy and content: both “Token safety score” and “Project diligence score” remain explicit. No Style 1 or Style 2 selector is exposed.

## Findings and comparison history

### Iteration 1

- [P1] The report headline bled into the dual-score cards because the accent was forced onto one unbroken line inside a constrained two-column grid.
- [P1] The investigation workspace overrode every application color token with a hardcoded dark palette, even when the surrounding shell was in light mode.
- [P2] Style 1 and Style 2 controls remained visible even though Style 2 had become the canonical report.

### Iteration 2

- Added shrink constraints to the narrative grid item and allowed the accent to wrap at the column boundary.
- Removed the workspace-level dark token overrides so the loading screen inherits the active product theme.
- Removed the report-style control and its URL/local-storage resolver from all public report routes. Legacy `reportStyle=1` links now render the canonical report.
- Post-fix desktop, mobile, and scan captures show no overlap, clipping, horizontal overflow, or cross-theme dark panel.
- No actionable P0, P1, or P2 visual mismatch remains.

## Browser and automated verification

- Browser DOM check: zero report-style selectors, the State of the House opening present, and both score cards present.
- Browser runtime check: no Vite error overlay or visible application runtime error in either local preview.
- Theme check: the light scan workspace and root use the same computed background color.
- Responsive check: both score cards stack cleanly at 319 CSS pixels.
- Automated checks: production build passes; targeted report, sharing, decision-canvas, and progress-canvas tests pass; full suite passes after removing the deleted selector component from the tracked-file copy-policy scan.

final result: passed
