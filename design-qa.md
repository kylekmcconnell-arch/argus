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

# Design QA — fluid authenticated workspace (issue #130)

- Source screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/fluid-workspace-issue-130/providers-source.jpg`
- Implementation screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/fluid-workspace-issue-130/providers-implementation.jpg`
- Same-viewport comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/fluid-workspace-issue-130/providers-comparison.jpg`
- Authenticated-shell implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/fluid-workspace-issue-130/referrals-implementation.jpg`
- Viewport: 1280 × 720 CSS pixels for both source and implementation captures
- State: light theme; evidence-source ledger and referrals workspace with representative data

## Findings

No actionable P0, P1, or P2 differences remain.

- The previous evidence-source page stopped at 1024px and left roughly 128px of unused canvas on each side. The implementation uses the available width with a 25px responsive gutter at this viewport.
- The wider ledger materially improves scanability: source name, evidence scope, limit, availability, and last-check status occupy stable columns with less wrapping.
- The authenticated referrals capture confirms the same fluid frame works inside the real post-sidebar canvas. Cards, metrics, referral controls, and the leaderboard align to one responsive gutter.
- Descriptions retain their existing `max-w-2xl` reading measure. Only page-level caps were removed, so prose does not become an unreadably long line.
- Focused scan landing and failure states remain deliberately narrow; completed scan reports, wallet holdings, project people, and provider ledgers use the fluid report/workspace canvas.

## Required fidelity surfaces

- Typography: unchanged ARGUS sans/mono hierarchy, weights, and text sizes.
- Spacing and rhythm: one shared `workspace-frame` now controls horizontal and vertical page gutters; the existing `report-frame` remains the matched report-shell primitive.
- Colors and surfaces: unchanged light/dark tokens, panel borders, shadows, radii, and semantic status colors.
- Assets: no image, logo, icon, or illustration changes.
- Copy and information: no data, labels, actions, report evidence, or disclosures were removed.
- Responsive behavior: gutters use CSS `clamp()` and page width is uncapped; a structural regression test covers all 18 primary workspace routes, while focused forms retain local reading widths.

## Interaction checks

- Referral link and copy action remain present.
- Provider status rows and source links remain present and readable.
- The 1280px implementation has no document-level horizontal overflow (`documentWidth = 1265px`, matching the scrollbar-adjusted viewport).
- Existing page-specific grids and tables retain their responsive breakpoints.

## Comparison history

The first matched comparison found no blocking fidelity issue. The change is intentionally limited to shell width and gutters; page content and behavior are unchanged.

final result: passed

---

## Issue #124 follow-up · full investigation-report language

- Source visual truth:
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-audit/01-report-opening.png`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-audit/03-people.png`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-audit/04-connections.png`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-audit/05-method.png`
- Implementation screenshots:
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/01-opening-desktop-v2.jpg`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/03-people-desktop-v2.jpg`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/04-connections-desktop-v3.jpg`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/05-method-desktop.jpg`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/06-opening-mobile-390x844.jpg`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/07-people-mobile-390x844.jpg`
  - `/Users/kyle/.codex/visualizations/2026/08/22/01a02aec-d8e5-7933-a3d2-6f69aede22aa/full-report-language-qa/08-method-mobile-390x844.jpg`
- Viewports: 1280 × 720 desktop and 390 × 844 mobile.
- Pixel dimensions and density: desktop source and implementation captures are 1280 × 720 and were compared at equal size in the same image input. The in-app browser reports a 1280 × 720 CSS viewport at DPR 2 and returns a normalized 1280 × 720 capture. Mobile captures are 390 × 844 at DPR 1 with no density normalization required.
- State: light theme, saved `$STONKBROKER` investigation, default disclosures collapsed; connection list and one Technical IDs disclosure were also opened.

### Findings

No actionable P0, P1, or P2 findings remain in the changed report path.

- The decision opening now says what the report means, names the main risk, and says what to check next. A report with no saved check register says `No checks saved` instead of presenting `0/0` as a completed state.
- People copy distinguishes the project account, the wallet that created the token, people named by the project, and people confirmed by an independent source. Raw role enums and `deployer` no longer appear in the default reading path.
- Connections use readable node and relationship labels. Canonical node IDs and edge enums remain available only after opening `Readable connection list` and `Technical IDs`.
- Method navigation now targets the method chapter heading itself. Desktop and mobile captures show the correct landing position.
- A full DOM reading-path scan found zero default-path occurrences of `deployer`, `project_attributed`, `score floor`, `Evidence record`, `raw evidence`, `Source reported`, `N/A`, `held_by`, `deployed_by`, or `funded_by`.

### Required fidelity surfaces

- Fonts and typography: existing ARGUS display, body, and mono hierarchy is unchanged. Longer public labels wrap cleanly on desktop and mobile without clipping or loss of hierarchy.
- Spacing and layout rhythm: no CSS, token, radius, shadow, or grid changes were made. Existing cards and chapter spacing remain aligned across the before/after comparisons.
- Colors and visual tokens: unchanged. Existing pass, caution, signal, ink, panel, and line tokens remain the only colors in the report.
- Image quality and asset fidelity: no images, logos, illustrations, or icons were added or replaced. Existing Phosphor icons and report primitives remain intact.
- Copy and content: scores, saved data, sources, and technical IDs remain unchanged. Only deterministic presentation labels, explanatory empty states, and section navigation changed.
- Responsive behavior: 390 × 844 opening, People, and Method states show clean wrapping, stacked cards, usable controls, and no visible horizontal overflow. The story navigation retains its existing intentional horizontal scroll.
- Accessibility and behavior: semantic headings, links, buttons, progress state, native details disclosures, and keyboard-operable graph actions remain. The no-check state omits a misleading progressbar.

### Interaction checks

- Brief, Market, People, Connections, Method, and Challenge story links resolve to unique report targets.
- Method lands with `What ARGUS checked` visible at the top of the chapter.
- `Readable connection list` opens successfully; `Technical IDs` reveals the unchanged `DEPLOYED_BY`/`HELD_BY` typed records only on request.
- Shared reports reuse `InvestigationReport`; print and PDF export print the same rendered DOM.
- Browser console check found one existing React key warning from `LaunchPanel`. That component is outside this PR and the warning reproduced after clean reloads; no changed report component produced a new console error.

### Comparison history

First audit pass found three blocking issues: P1 internal vocabulary across the default report path, P1 Method navigation landing above its heading, and P2 `0/0` language that read as completed. The implementation added one deterministic public vocabulary layer, moved the Method target to the chapter, and added a distinct no-register state. The second desktop/mobile pass found no remaining P0/P1/P2 report mismatch. Focused paired comparisons were completed for the opening, People, Connections, and Method sections.

### Follow-up polish

- P3, outside this PR: fix the pre-existing `LaunchPanel` list-key warning in its own issue so the preview console is fully clean.

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

---

# Design QA — global floating controls (issue #128)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-22 at 8.26.17 PM.png`
- Implementation screenshots: `/Users/kyle/.codex/visualizations/2026/08/22/argus-eye-feedback-issue-128/qa-desktop-closed.png`, `/Users/kyle/.codex/visualizations/2026/08/22/argus-eye-feedback-issue-128/qa-desktop-open.png`, `/Users/kyle/.codex/visualizations/2026/08/22/argus-eye-feedback-issue-128/qa-mobile-closed.png`, `/Users/kyle/.codex/visualizations/2026/08/22/argus-eye-feedback-issue-128/qa-mobile-open.png`
- Focused implementation comparison: `/Users/kyle/.codex/visualizations/2026/08/22/argus-eye-feedback-issue-128/qa-desktop-focused.png`
- Source pixels: 3172 × 506, supplied as a 2× crop representing a 1586 × 253 CSS-pixel region
- Desktop viewport: 1586 × 900 CSS pixels; focused comparison: bottom 1586 × 253 CSS pixels
- Mobile viewport: 390 × 844 CSS pixels
- Density normalization: the source was evaluated at half its physical pixel dimensions; the implementation focused crop uses the corresponding CSS dimensions
- State: light theme, saved token report, ARGUS Eye closed and open

## Findings and iteration history

Initial source comparison found one P1 interaction defect: the 52px ARGUS Eye launcher and 44px feedback launcher occupied the same bottom-right slot, with the higher-z-index Eye obscuring most of the feedback target.

First implementation comparison: no actionable P0, P1, or P2 differences remain.

- Closed desktop: feedback occupies the rail above ARGUS Eye with a 12px visible gap. Measured bounds were feedback `y=772..816` and Eye `y=828..880`.
- Open desktop: the secondary feedback launcher yields while the 390px Eye panel is open, so no hidden or ambiguous hit target remains beneath the panel.
- Closed mobile: the same 12px separation remains at 390px wide with no horizontal document overflow (`body.scrollWidth = 390`).
- Open mobile: the Eye panel fits between `x=8..374`; feedback is hidden and has `pointer-events: none` while the panel is active.
- Bottom and right placement includes browser safe-area insets at both mobile and desktop breakpoints.

## Required fidelity surfaces

- Fonts and typography: unchanged; both controls retain the existing ARGUS mono/sans labels.
- Spacing and layout rhythm: only the floating rail position changed. The report cards, sidebar, toolbar, and recent report redesign are untouched.
- Colors and visual tokens: unchanged; the existing signal, panel, line, ink, and on-signal tokens remain in use.
- Assets and icons: unchanged; existing Phosphor Eye and ChatCenteredText icons are reused.
- Copy: unchanged; `ARGUS EYE`, `Give feedback`, and all accessible labels remain intact.

## Interaction checks

- Both closed launchers remain separately visible and clickable with 44px-or-larger targets.
- ARGUS Eye opens and closes from its existing button; `aria-expanded` exposes the state used by the collision rule.
- Feedback is removed from pointer and visibility flow only while the Eye panel is open, then returns to its reserved rail slot when the panel closes.
- Desktop and mobile screenshots show no launcher overlap or document-level horizontal overflow.
- One pre-existing React key warning from `LaunchPanel` appeared in the full report preview. It is outside the floating controls, predates this change, and no new console error or warning was introduced by the controls.

## Follow-up polish

No P3 follow-up is required for this focused collision fix.

final result: passed
