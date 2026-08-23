**Source visual truth**

- `/Users/kyle/Downloads/Screenshot 2026-08-22 at 4.49.57 PM.png`
- Source pixels: 3396 × 2112 (`@2x` desktop capture; 1698 × 1056 CSS-equivalent viewport).
- State: authenticated `$STONKBROKER` investigation report, dark theme, desktop sidebar and report toolbar visible.

**Implementation evidence**

- Local URL: `http://127.0.0.1:5177/?design-preview=referrals`
- CSS viewport: in-app browser desktop viewport.
- Rendered DOM verification:
  - Light active navigation: `rgb(0, 168, 107)` on `rgb(4, 18, 13)`; contrast 6.21:1.
  - Dark active navigation: `rgb(0, 200, 5)` on `rgb(6, 16, 6)`; contrast 8.54:1.
  - Sidebar mark: 32 × 32 CSS px, `data-argus-eye-tone="brand"`, green brand iris present.
  - `v3.0` is absent from the rendered sidebar.
  - Case Brief retains its existing handler and primary-button behavior and adds the shared `btn-brand` visual treatment.
- Implementation screenshot path: unavailable. The selected in-app browser reports that pixel capture is unsupported.

**Findings**

- [P2] Pixel comparison is unavailable
  - Location: requested sidebar and report toolbar states.
  - Evidence: the source screenshot is available and the implementation is rendered and inspectable, but the selected browser cannot create an implementation screenshot.
  - Impact: typography, spacing, colors, icon scale, and copy were inspected from the rendered DOM, but the required side-by-side pixel artifact cannot be produced in this browser.
  - Fix: capture the local or deployed implementation with an approved screenshot-capable browser, then compare it with the source at the same desktop viewport.

**Required fidelity surfaces**

- Fonts and typography: unchanged from the source implementation; no type styles were modified.
- Spacing and layout rhythm: the sidebar mark increases from 26 to 32 px within the unchanged 64 px header; no report or navigation frame dimensions changed.
- Colors and visual tokens: the requested emphasis now uses dedicated `brand`, `brand-dim`, and `on-brand` tokens with AA contrast in both themes.
- Image quality and asset fidelity: the existing ARGUS vector mark is retained; only its supported size and iris token change.
- Copy and content: the `v3.0` badge is removed; report and navigation copy is otherwise unchanged.

**Open questions**

- None about the implementation. A screenshot-capable browser is the only missing QA artifact.

**Implementation checklist**

- [x] Use ARGUS green for active navigation.
- [x] Remove the sidebar version badge.
- [x] Increase the sidebar eye and color its iris with the brand token.
- [x] Use the same brand green for Case Brief.
- [x] Verify both theme contrasts, component behavior, tests, typecheck, build, and scoped lint.
- [ ] Capture and compare implementation pixels with the source.

**Comparison history**

- Initial pass: no code-level P0/P1/P2 regressions found; screenshot comparison remains blocked by browser capability.

**Follow-up polish**

- None identified from the rendered DOM inspection.

final result: blocked
