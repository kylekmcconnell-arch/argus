# Design QA — true centered report score (2026-08-24)

- Source visual truth: `docs/design-qa/score-center-2026-08-24-v2/reference-current-report.png`
- Desktop implementation: `docs/design-qa/score-center-2026-08-24-v2/implementation-desktop-visible.jpg`
- Mobile implementation: `docs/design-qa/score-center-2026-08-24-v2/implementation-mobile-visible.jpg`
- Combined comparison: `docs/design-qa/score-center-2026-08-24-v2/comparison.jpg`
- Source pixels: 3416 × 2248; focused decision-brief crop normalized to 968px width
- Desktop CSS viewport: 1440 × 900; browser transport capture: 968 × 891
- Mobile CSS viewport: 390 × 844; browser transport capture: 375 × 812
- Density normalization: device scale 1; the source decision brief and implementation decision brief were normalized to the same 968px comparison width
- State: light-theme saved-report decision brief with a numeric score and completed-check status

## Findings

No actionable P0, P1, or P2 differences remain.

- The source screenshot confirms the defect: the enlarged score is centered only inside a narrow trailing result column, leaving it visibly right-aligned against the complete decision brief.
- The implementation uses equal flexible tracks on both sides of the score. Browser geometry measured the complete heading center and score center at exactly 712.5 CSS pixels, a 0px delta.
- The decision title remains left-aligned and the score is now the true visual center. No score, verdict, readiness, evidence, or report-content behavior changed.
- Below 1024px the title and score stack. The 390px verification measured the score lockup and complete heading at the same 187.5px center with zero document overflow.

## Required fidelity surfaces

- Fonts and typography: the existing ARGUS display, sans, and mono hierarchy is unchanged. The shared 168px `ScoreRing`, score numerals, verdict, and completion copy remain intact.
- Spacing and layout rhythm: the decision brief now uses a symmetric `1fr / auto / 1fr` desktop composition. The left decision rail and surrounding chapter spacing remain unchanged; tablet and mobile use a deliberate centered stack.
- Colors and visual tokens: all existing score-band, verdict, line, panel, and ink tokens are preserved. No new color, gradient, or semantic state was introduced.
- Image quality and asset fidelity: no new visual asset was required. The existing shared score component is reused; no CSS art, placeholder, emoji, inline SVG, or generated image was added.
- Copy and content: `What this report means`, the saved score, verdict, check count, and provisional state use the existing production copy without alteration.

## Interaction and browser checks

- Shared decision canvas rendered in the in-app browser at 1440 × 900 and 390 × 844 CSS viewports.
- Desktop center delta: 0px.
- Mobile center delta: 0px.
- Desktop and mobile document overflow: 0px.
- Browser console: zero errors and zero warnings.

## Comparison history

### Iteration 1

- Earlier P1 finding: PR #235 enlarged the ring but preserved the right-hand result column, so the product-owner request for a centered score was not met.
- Fix: replaced the asymmetric result-column composition with symmetric outer tracks and moved the score to the middle track; added a pre-overlap stacked breakpoint.
- Post-fix evidence: the combined comparison and geometry measurements above show the score at the complete brief's exact horizontal center on desktop and mobile.

final result: passed

---

# Design QA — oversized centered report score (2026-08-24)

- Source visual truth: `docs/design-qa/oversized-score-2026-08-24/reference-current-score.png`, showing the 168px report score the user identified as too small
- Desktop implementation: `docs/design-qa/oversized-score-2026-08-24/implementation-desktop.png`
- State: authenticated light-theme canonical decision-report preview with a completed score

## Findings

The score is restored as the dominant visual anchor of the decision brief. The ring is 240px, the score numeral is 48px, and the three-column layout keeps the ring mathematically centered in the report rather than centered in the leftover space beside the copy.

- Typography: the score numeral scales with the larger ring while the `/ 100` denominator remains secondary.
- Spacing: the decision hero grows to 312px high and preserves clear separation from the review controls below.
- Responsive behavior: the existing tablet/mobile breakpoint still moves the lockup into its own centered row at full width.
- Tokens and semantics: verdict colors, score bands, labels, and accessible SVG structure are unchanged.

## Verification

- Focused component and geometry suite: 9 tests passed.
- Static layout contract asserts the 240px ring, true center column, 312px hero height, and responsive stacking behavior.
- Desktop implementation was inspected in the in-app browser with no overlap or horizontal overflow.

final result: passed

---

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

# Design QA — public team evidence language and hierarchy (2026-08-24)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-24 at 8.24.34 PM.png`
- Desktop implementation: `docs/design-qa/team-public-language-2026-08-24/implementation-desktop-final.png`
- Mobile implementation: `docs/design-qa/team-public-language-2026-08-24/implementation-mobile.png`
- Combined comparison: `docs/design-qa/team-public-language-2026-08-24/comparison.png`
- Source pixels: 4094 × 198; normalized to 1007 × 49 for the combined comparison
- Desktop implementation pixels: 1007 × 720; focused comparison crop: 1007 × 390
- Mobile implementation pixels and CSS viewport: 390 × 844 at device scale 1
- State: light-theme saved project report, one source-grounded creator, internal identity confidence `Probable`

## Findings

No actionable P0, P1, or P2 differences remain.

- The source exposed the internal `Probable` taxonomy and compressed the entire team result into a roughly 40px row.
- The implementation keeps that frozen confidence value unchanged but replaces the public label with `Identity link found` where a compact status is required.
- The team evidence now has a 22–30px chapter heading, a plain explanation of exactly what ARGUS found, a named-person count, a 40px avatar, a full evidence card, a public source label, the exact role-source link, and a clear Review action.
- The one-person desktop state uses the full available report width. Multiple people retain the established two-column report card pattern.
- At 390px, the header, count, person card, evidence, and action stack into one readable column with no horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: existing ARGUS sans and mono roles remain; the person name and chapter title receive the established report hierarchy instead of adding a new type system.
- Spacing and layout rhythm: the team block grows from a compact row to the repository's existing decision-critical team card treatment. Desktop and mobile card padding follow the shared responsive tokens.
- Colors and visual tokens: only existing panel, line, ink, signal, and neutral button tokens are used. The identity link is not colored as verified.
- Image quality and asset fidelity: the existing saved avatar and Phosphor-based application chrome remain unchanged; no generated, placeholder, CSS, inline-SVG, or emoji asset was added.
- Copy and content: `Probable`, `identity resolved`, `role proof`, and the parenthetical internal operator-attribution label are removed from public presentation. Exact evidence, provider attribution, role-source URL, handle, role, and review action remain visible.

## Interaction and browser checks

- `Open role source` remains a real external link to the saved proof URL.
- `Review` remains connected to the existing handle-audit callback.
- Desktop and mobile browser renders contain no public `Probable` text for this state.
- Mobile `documentElement.scrollWidth` and `body.scrollWidth` both equal the 390px viewport.
- Browser console: zero errors and zero warnings.

## Comparison history

The first visual pass confirmed the larger hierarchy but the capture aligned the chapter beneath the sticky report header. The final desktop and mobile captures were realigned to show the full section. No implementation defect was found, and no P0/P1/P2 visual-fix loop was required.

## Follow-up polish

- P3: a later report-wide copy pass can standardize `Open role source` with other source-link verbs outside this section.

final result: passed

---

# Design QA — large centered decision score (2026-08-24)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-24 at 7.57.22 PM.png`
- Desktop implementation: `docs/design-qa/score-center-2026-08-24/implementation-desktop-v2.png`
- Mobile implementation: `docs/design-qa/score-center-2026-08-24/implementation-mobile-v2.png`
- Combined comparison: `docs/design-qa/score-center-2026-08-24/comparison-v2.png`
- Focused score crop: `docs/design-qa/score-center-2026-08-24/implementation-score-v2.png`
- State: saved EarnOnHood-style report, early/provisional 36/100 score, six of seven required checks complete

## Findings

The saved report's existing shared `ScoreRing` is restored as the dominant visual result without changing its score, verdict, readiness, report content, or surrounding chapter layout. The ring is 168px on desktop and centered in the existing result column. At a 390 × 844 mobile viewport, it becomes a centered single-column lockup with no horizontal overflow (`scrollWidth` 375).

## Required fidelity surfaces

- Layout: current report grid and content order preserved.
- Typography: existing report typography preserved.
- Color: existing fail/avoid verdict color preserved.
- Spacing: only the score result column was widened to fit the larger shared ring.
- Responsive behavior: centered at desktop and mobile with no horizontal overflow.
- Data behavior: score value, verdict, readiness, and required-check calculations are unchanged.

## Comparison history

1. The first local fixture used the wrong verdict tone, producing a black ring. The fixture was corrected to the report's red `avoid` tone before final comparison.
2. The first mobile pass allowed the completion line to stack beside the enlarged ring. The responsive lockup was changed to a centered single column.

## Runtime checks

- Final verified preview produced no browser errors or warnings.
- The combined comparison confirms the existing report copy, color, and layout remain unchanged around the larger centered score.

final result: passed

---

# Design QA — restored report score prominence (2026-08-24)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-24 at 12.51.23 AM.png`
- Focused source crop: `docs/design-qa/score-prominence-2026-08-24/source-current-score-region.png`
- Intended score idiom: the original shared `ScoreRing` presentation recovered from commit `0a65353` in `TokenReport.tsx`
- Desktop implementation: `docs/design-qa/score-prominence-2026-08-24/implementation-desktop.jpg`
- Mobile implementation: `docs/design-qa/score-prominence-2026-08-24/implementation-mobile.jpg`
- Desktop viewport: 1742 × 920 CSS pixels, light theme, complete SuperGemma-shaped report fixture, score 46/100, 7/7 checks complete
- Mobile viewport: 390 × 844 CSS pixels, same report state
- Source crop pixels: 1450 × 230
- Desktop implementation crop pixels: 1382 × 230
- Mobile implementation pixels: 390 × 844
- Density normalization: device scale 1; the focused source and implementation were inspected together at their native density and equivalent decision-brief region

## Findings

No actionable P0, P1, or P2 differences remain.

- The reported production state made the score look absent: `46 / 100` was a small right-edge statistic with no visual anchor.
- The restored state reuses the original ARGUS `ScoreRing` component at 120px, retains the saved score and verdict color, and gives it a labeled, bordered lockup above the fold.
- Score and completion remain semantically separate: the ring is `46 / 100`; the supporting line is `7/7 checks complete`.
- The same lockup renders `N/A / 100` plus `Score withheld` when the scoring contract withholds a result, and labels unfinished results as an early risk score with provisional completion copy.
- The mobile layout has no document-level horizontal overflow (`document.body.scrollWidth` equals 390px). The ring and check status become a compact horizontal lockup below the decision-brief title.

## Required fidelity surfaces

- Fonts and typography: the existing ARGUS mono score treatment, report serif title, weights, tracking, and tabular numerals are preserved. The score is now large enough to read at a glance.
- Spacing and layout rhythm: desktop uses the original right-hand score composition with a hairline boundary; mobile stacks the score beneath the heading without clipping or crowding.
- Colors and visual tokens: only the existing pass, caution, avoid, ink, panel, and line tokens are used. The original three-band score track is restored.
- Image quality and asset fidelity: no new raster, SVG, CSS-drawn, or placeholder asset was introduced. The existing shared score-ring component is reused exactly.
- Copy and content: `ARGUS risk score`, verdict, `/ 100`, and completed-check count are explicit and independently labeled.

## Interaction and runtime checks

- Canonical report decision canvas rendered in the in-app browser at desktop and mobile widths.
- Complete-score, provisional-score, and withheld-score component tests cover the public states.
- Browser console: zero errors and zero warnings.
- Responsive measurement: 390px viewport and 390px document width; no horizontal overflow.

## Comparison history

### Iteration 1

- Earlier finding: P1, the score was technically present but visually buried, so users reasonably read it as missing.
- Fix: restored the original shared `ScoreRing`, promoted it to a labeled 120px decision lockup, and kept check completion outside the score.
- Post-fix evidence: desktop and mobile captures listed above. The source and desktop implementation were reviewed together in one comparison input.

final result: passed

---

# Design QA — sidebar instrument-seal logo (2026-08-23)

## Comparison target

- Source visual truth: `docs/design-qa/sidebar-logo-2026-08-23/source-option-3.png`
- Browser implementation: `docs/design-qa/sidebar-logo-2026-08-23/implementation-desktop-v1.png`
- Focused header capture: `docs/design-qa/sidebar-logo-2026-08-23/implementation-header-v1.png`
- Combined comparison: `docs/design-qa/sidebar-logo-2026-08-23/comparison-v1.png`
- Viewport: 1440 × 900 CSS pixels at device scale 1
- Source pixels: 1536 × 1024; focused source crop: 800 × 270
- Implementation pixels: full browser transport 933 × 900; focused header capture 247 × 64 at 1:1 CSS density
- Normalization: the selected concept's lockup and the implementation header were each isolated, then scaled to the same 800px comparison width. The 247 × 64 focused capture is the fidelity source for spacing and mark legibility because it preserves CSS-pixel density.
- State: authenticated light-theme landing preview, sidebar expanded, brand pupil in its slow observing loop

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses the existing ARGUS interface family at 17px/600 with restrained 0.045em tracking, matching the selected concept's firm sans-serif wordmark without importing a conflicting display face.
- Spacing and layout rhythm: the 36px seal sits inside the existing 64px navigation header with 16px leading inset and a 12px mark-to-word gap. The lockup fits the 248px sidebar without changing downstream navigation alignment.
- Colors and visual tokens: the iris uses `--color-brand`, the pupil uses `--color-eye-pupil`, the highlight uses the on-brand token, and the calibrated point field inherits the existing neutral ink token. Light and dark modes therefore remain token-driven.
- Image quality and asset fidelity: the selected rounded point-field seal, white eye aperture, jade iris, black pupil, and compact wordmark proportions are all present. The mark remains a sharp scalable vector component so the pupil can move independently; no low-resolution crop from the concept board is shipped in the product.
- Copy and content: the wordmark remains exactly `ARGUS`; no version badge or extra header copy was introduced.
- Motion and accessibility: only the pupil moves. The iris, aperture, and point field remain fixed. The browser reported the `argus-eye-observe` animation at 13.5 seconds, and the reduced-motion media rule disables the pupil transform and animation.

## Full and focused comparison evidence

The full browser render confirms the new lockup stays visually subordinate to the investigation command and does not disturb the sidebar's navigation rhythm. The focused combined comparison confirms the selected option's distinctive square point field, cut-through eye, green iris, dark pupil, and bold wordmark survive at the real 36px mark size. A focused comparison was required because the logo is too small to judge reliably in the full application capture.

## Comparison history

### Iteration 1

- Earlier findings: none at P0/P1/P2. The first browser comparison preserved the selected silhouette, proportions, color hierarchy, and intended header density.
- Fixes made: no post-comparison visual correction was required.
- Post-fix visual evidence: `docs/design-qa/sidebar-logo-2026-08-23/comparison-v1.png`.

## Runtime checks

- Verified the logo renders at 36 × 36 CSS pixels inside a 247 × 64 header.
- Verified the pupil is a separate animated group and the field and iris remain fixed.
- Checked the browser console after the final render: no errors or warnings.
- Passed 9 focused component/navigation tests and the production build.

## Follow-up polish

- P3: the generated concept uses slightly irregular rasterized dots, while the product seal uses a cleaner calibrated vector field for small-size sharpness and theme support.

final result: passed

---

# Design QA — compact landing question sequence (2026-08-23)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-23 at 10.55.16 AM.png`
- Desktop implementation: `docs/design-qa/landing-lenses-2026-08-23/implementation-desktop-v2.png`
- Mobile implementation: `docs/design-qa/landing-lenses-2026-08-23/implementation-mobile-v1.png`
- Focused side-by-side comparison: `docs/design-qa/landing-lenses-2026-08-23/comparison-v1.png`
- Source pixels: 2880 × 866
- Focused implementation pixels: 1057 × 321
- Mobile implementation pixels: 390 × 844
- Viewports: 1440 × 900 desktop and 390 × 844 mobile at browser-normalized 1× capture density
- State: authenticated light-theme New Investigation preview, default research focus, empty subject input
- Normalization: the source and focused desktop implementation were each normalized to 1400px wide and placed in one side-by-side comparison. The source is a high-density, content-only crop; the implementation is the rendered main-content region without application chrome.

## Findings and comparison history

The source stacked the step number, icon, heading, and description as four separate vertical beats, leaving each question visually suspended in a tall column. That was the only actionable P2 issue in the first comparison.

The implementation fixes it by placing a two-digit step marker, the existing Phosphor icon, and the question on one shared baseline. Supporting copy follows immediately underneath, section padding is reduced, and the research disclaimer closes the page sooner. The three desktop columns still share equal tracks and separators; mobile keeps the sequence stacked but each item remains a compact two-beat row. The post-fix comparison and mobile capture show no remaining actionable P0, P1, or P2 differences.

## Required fidelity surfaces

- Fonts and typography: the existing ARGUS display, body, and mono hierarchy is preserved. The smaller mono marker now behaves as sequence metadata instead of a separate content row.
- Spacing and layout rhythm: the section header gap, item padding, marker-to-title spacing, and footer gap are reduced. Desktop content aligns on one shared header baseline; mobile retains readable separation without the original tall stacks.
- Colors and visual tokens: the marker uses the existing brand, panel, and line tokens with restrained tinting. No new palette or gradient is introduced.
- Image and asset fidelity: no new imagery is required. Existing Phosphor icons are reused; no custom SVG, CSS illustration, emoji, or placeholder asset is introduced.
- Copy and content: all three questions, explanations, the How ARGUS works action, and the research disclaimer remain unchanged.

## Verification

- Focused Landing tests: 4 passed.
- Production build: passed.
- Mobile body and document widths equal the 390px viewport; no horizontal overflow.
- Browser console: 0 errors and 0 warnings after the final mobile render.

## Follow-up polish

- No P3 follow-up is required for this scoped refinement.

final result: passed

---

# Public early-access home design QA (2026-08-23)

## Comparison target

- Source visual truth: `docs/design-qa/public-access-home-2026-08-23/source-landing.png`
- Desktop implementation: `docs/design-qa/public-access-home-2026-08-23/implementation-desktop-v1.png`
- Mobile implementation: `docs/design-qa/public-access-home-2026-08-23/implementation-mobile-v1.png`
- Side-by-side comparison: `docs/design-qa/public-access-home-2026-08-23/comparison-v1.png`
- Viewports: 1440 × 1000 desktop and 390 × 844 mobile
- State: logged out, empty early-access code

## Findings

No actionable P0, P1, or P2 differences remain.

- Typography and hierarchy retain the authenticated landing's exact decision-first headline, display treatment, restrained eyebrow, and compact supporting copy.
- The public page removes workspace navigation, decision cards, and report-method detail because those controls require membership. The remaining login and code-entry actions are visible without competing with the headline.
- The existing ARGUS eye, brand-green iris, neutral page tokens, line treatment, radii, and mono labels are reused. No new visual asset or one-off icon language was introduced.
- Desktop keeps the eye as a quiet counterweight. Mobile removes the decorative eye so the headline and access form remain above the fold without horizontal overflow.
- An empty code cannot be submitted. Entered codes normalize to uppercase before the guarded join flow receives them. Login and request-access paths remain separate and explicit.

## Interaction checks

- Entered `argus-7`, observed `ARGUS-7`, and submitted it through the preview callback.
- Selected `Log in` and observed the preview callback.
- Confirmed the request-access link targets `/?view=join`.
- Confirmed desktop and mobile accessible structure includes one named access-code field, a disabled empty submit action, and an explicit login control.

final result: passed

---

# Design QA — brand-green landing eye (2026-08-23)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-23 at 12.08.33 AM.png`
- Browser-rendered implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/landing-green-eye/implementation.png`
- Focused source/implementation comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/landing-green-eye/comparison-eye.png`
- Source and implementation pixels: 1325 × 704 each
- CSS viewport: 1325 × 704 at browser-normalized 1× density; no density normalization required
- State: authenticated New Investigation preview, default decision intent, empty subject, light theme; dark theme checked separately

## Findings and comparison history

The source shows the landing method eye with a black focal circle. The implementation changes that circle to the existing ARGUS brand-green tone while preserving the halftone field, live focus motion, highlight, size, and surrounding layout. The first focused comparison found no actionable P0, P1, or P2 difference beyond the requested color change, so no visual correction loop was required.

## Required fidelity surfaces

- Fonts and typography: unchanged.
- Spacing and layout rhythm: unchanged; the eye remains a 150px mark in the existing method rail.
- Colors and visual tokens: the mark now resolves through `--color-brand` (`#00a86b` in light mode and `#00c805` in dark mode) instead of the neutral interaction token.
- Image quality and asset fidelity: the existing scalable `ArgusMark` asset is reused; no rasterization, replacement, or hand-drawn approximation was introduced.
- Copy and content: unchanged.

## Verification

- Browser DOM reports `data-argus-eye-tone="brand"`; computed focal-circle fills are `rgb(0, 168, 107)` in light mode and `rgb(0, 200, 5)` in dark mode.
- The page remains exactly viewport-wide at 1325px with no horizontal overflow.
- Light/dark theme switching was exercised; browser console errors and warnings: none.
- Focused Landing and ArgusMark tests pass (9 tests); TypeScript, scoped ESLint, and production build pass.

final result: passed

---

# ARGUS Eye default-panel simplification QA

## Comparison target

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-22 at 11.56.00 PM.png`
- Browser implementation: `docs/design-qa/argus-eye-2026-08-23/implementation-v1.png`
- Side-by-side comparison: `docs/design-qa/argus-eye-2026-08-23/comparison-v1.png`
- Source pixels: 1287 × 1115
- Browser viewport: 1289 × 1115 CSS pixels; captured page content is 1289 × 1037 pixels after browser chrome
- Density normalization: device scale 1; the implementation was padded by 78 pixels at the bottom for an equal-height side-by-side canvas. No report or Eye content was scaled.
- State: light theme, saved token/project report, ARGUS Eye open with no conversation yet

## Findings

No actionable P0, P1, or P2 issue remains in the focused Eye panel.

- Information hierarchy: the problem state presented a product-mechanics subtitle, an evidence badge, a multi-paragraph lead card, a status row, a rejected-conflict warning, three long prompts, a dense input placeholder, and a policy footer at once. The implementation presents one plain-language takeaway, three short questions, and the input. Supporting verification is closed by default under `Why ARGUS says this`.
- Fonts and typography: the implementation preserves the report's existing sans and mono families, compact header, and established weights. The takeaway now has one clear bold level; secondary copy no longer competes with it.
- Spacing and layout rhythm: the same 390-pixel panel, report alignment, radii, and token spacing remain. Removing two default rows and shortening the prompts materially reduces panel height and scanning effort without changing the surrounding report.
- Colors and visual tokens: the implementation reuses the existing signal header, neutral panel, border, and ink tokens. It removes the default red warning block and green status chip because those colors implied a decision before the user asked a question.
- Image and asset fidelity: there are no raster assets in this component. Existing Phosphor icons are retained; no replacement or custom-drawn asset was introduced.
- Copy and content: internal language including `evidence bound`, `role evidence state`, `conflict rejected`, `canonical identity`, and `report-wide reasoning layer` no longer appears in the default UI. The project attribution is now stated as what the project says and what ARGUS has not independently confirmed.
- Accessibility: dialog, close button, launcher expanded state, textbox label, suggested-question buttons, and details disclosure remain semantic and keyboard-addressable.

## Focused comparison evidence

The side-by-side full view is also the focused comparison because both panels are large enough for their complete default-state copy and controls to remain readable. The left side demonstrates the excessive simultaneous layers; the right side demonstrates the shorter reading path while preserving the same report position and visual language.

## Comparison history

### Iteration 1

- Initial P1: internal evidence and routing terminology dominated the first-time experience.
- Initial P1: the rejected-lead warning looked like a project risk even though it represented an unrelated search result.
- Initial P2: the three long prompts and explanatory footer made the panel feel like documentation rather than a chat tool.
- Fixes: rewrote the takeaway in plain language, moved attribution support and the ignored result into one closed disclosure, shortened all prompts, simplified the input, and removed default mechanics labels and footer copy.
- Post-fix evidence: `docs/design-qa/argus-eye-2026-08-23/implementation-v1.png` and `docs/design-qa/argus-eye-2026-08-23/comparison-v1.png`.

## Primary interactions and runtime checks

- Opened and closed the Eye from its floating launcher; both states were visible and the launcher retained `aria-expanded` behavior.
- Opened `Why ARGUS says this` and verified the plain-language attribution, ignored-result explanation, and source link.
- Entered a question in the textbox and verified the input accepted it.
- Unit coverage exercised suggested-question submission and evidence-backed answer rendering.
- One existing React list-key warning from `LaunchPanel` appeared in the full report preview. It is outside `ArgusEyeAssistant`, predates this focused change, and no new Eye console warning or error appeared.

## Follow-up polish

No P3 follow-up is required for this focused simplification.

final result: passed
---

# Design QA — decision landing and live research (2026-08-23)

- Landing direction: `/Users/kyle/.codex/generated_images/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/exec-0fab70c2-e935-4966-b00c-539ea4c04bac.png` (user-selected option 2)
- Research direction: `/Users/kyle/.codex/generated_images/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/exec-34412396-e99d-4481-97aa-aaa17d8437f1.png` (user-selected option 1)
- Desktop implementations: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/decision-research-release/landing-desktop.jpg`, `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/decision-research-release/research-desktop.jpg` at 1440 × 1000
- Mobile implementations: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/decision-research-release/landing-mobile.jpg`, `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/decision-research-release/research-mobile.jpg` at 390 × 844
- Paired evidence: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/decision-research-release/landing-comparison.png`, `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/decision-research-release/research-comparison.png`
- State: light and dark themes; authenticated shell; representative observed trace fixture for the dev-only loading harness

## Findings and iteration history

1. Landing hierarchy and intent rail match the selected decision-first direction while retaining ARGUS's real privacy control, provider-spend disclosure, saved-report route, green identity, and sidebar.
2. Mobile landing initially opened scrolled to the command field because of automatic focus. Removing automatic focus restored the intended story order; the stacked command icon was also realigned to its input.
3. Research matches the selected command-deck hierarchy: live state, subject, latest observed evidence, stage rail, and evidence ledger. Every status, source, and count is derived from trace events; no percentage, ETA, timestamp, or provider activity is simulated.
4. The evidence ledger's first row was partially clipped with four fixture events and a waiting row. Its event viewport was increased while preserving user-controlled scroll and jump-to-latest behavior for longer runs.
5. Responsive checks passed at 1440 × 1000 and 390 × 844. Dark theme, semantic headings, pressed intent state, busy state, polite event announcement, reduced-motion scrolling, and background-run copy remain legible and usable.
6. No unresolved P0, P1, or P2 visual or interaction issue remains.

## Required fidelity surfaces

- Typography: existing ARGUS sans and mono hierarchy is preserved, with editorial display scale used only for the decision and live-research story.
- Spacing and rhythm: wide layouts use the full post-sidebar canvas; landing choices and research stages collapse cleanly to a single-column mobile reading order.
- Colors and assets: only existing panel, line, ink, signature-green, semantic status tokens, ARGUS mark, and Phosphor icons are used. No gradient, placeholder art, or fabricated provider mark was added.
- Copy and information: all current inputs, privacy behavior, provider-spend disclosure, background-run behavior, source detail, status tone, and final-report pathways remain.

## Verification

- Complete Vitest suite: 3,668 tests passed.
- Scoped ESLint for every changed TypeScript/TSX file: passed. Repository-wide ESLint continues to report the pre-existing 440-error backlog outside this release.
- TypeScript client, server, and API projects: passed.
- Production build: passed.
- In-app browser: desktop, mobile, light, and dark renders checked; no preview console error or warning observed.

final result: passed

---

# Design QA — white-on-green controls and floating launchers (issue #140)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-22 at 10.43.01 PM.png`, with the user's verbal override that green-filled text should be white and both floating launchers should be green
- Light implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/green-controls-140/implementation-light-673x1504-v2.jpg`
- Dark implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/green-controls-140/implementation-dark-673x1504.jpg`
- Focused before/after comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/green-controls-140/comparison-focused-v1.jpg`
- Source pixels: 3478 × 1714 at 2× display density
- Implementation pixels and CSS viewport: 673 × 1504 at normalized screenshot density
- State: light and dark saved `$STONKBROKER` investigation; green Case Brief, active navigation, feedback launcher, and closed/open ARGUS Eye states

## Findings and comparison history

The supplied source showed two P2 consistency issues identified by the user: green-filled active controls used near-black foregrounds, while the two persistent report launchers used neutral black rather than the established brand green. The implementation applies a shared filled-brand treatment with white foregrounds. A focused before/after comparison confirms the requested contrast and color changes without altering control dimensions, position, typography, or surrounding report layout. No actionable P0, P1, or P2 findings remain.

## Required fidelity surfaces

- Fonts and typography: unchanged. Existing ARGUS sans and mono labels, weights, letter spacing, and icon sizing are preserved.
- Spacing and layout rhythm: unchanged. The Case Brief pill, sidebar active row, 44px feedback target, 52px ARGUS Eye target, safe-area offsets, and collision-free rail retain their existing measurements.
- Colors and visual tokens: filled controls use `brand-fill` (`#008754` light, `#008a03` dark) with `on-brand` white. Both pairs meet WCAG AA for normal text. The brighter signature-green `brand` token remains unchanged for marks and accents.
- Image quality and assets: no raster, logo, or icon assets changed. Existing Phosphor icons remain sharp and correctly aligned.
- Copy and content: unchanged. All report facts, actions, labels, and accessible names remain intact.

## Interaction and responsive checks

- ARGUS Eye opened and closed successfully; its launcher remains green with a white foreground in both states and keeps `aria-expanded` synchronized.
- Feedback opened and closed successfully; it remains above the Eye and continues yielding while the Eye panel is open.
- The narrow 673px × 1504px state preserves the toolbar scroll, floating-control clearance, and report reading width without a new overflow.
- Focused component, theme-contrast, navigation, report, and snapshot tests passed (93 tests). The full suite passed 3,661 tests; three heavy person-report tests timed out only under full-suite CPU contention and passed when their two files were rerun alone (61 tests). Scoped ESLint, TypeScript, and the production build passed.
- The in-app browser surface exposed interaction and DOM inspection but not a console-message API. Browser-triggered open/close interactions completed without a visible runtime failure; automated component tests cover both state transitions.

## Follow-up polish

No P3 follow-up is required for this focused color-state correction.

---

# Design QA — team diligence emphasis (issue #142)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-22 at 10.45.44 PM.png`
- Source focus crop: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/team-section-142/source-team-crop.png`
- Implementation screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/team-section-142/implementation-narrow.png`
- Dark implementation screenshot: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/team-section-142/implementation-dark-narrow.png`
- Combined comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/team-section-142/comparison.png`
- Source: 3478 × 1714 physical pixels at desktop density; focused crop 2900 × 1150 pixels, normalized to 1000px wide
- Implementation viewport: 673 × 1504 CSS pixels in the in-app browser
- State: light theme, saved `$STONKBROKER` investigation with one source-grounded operator and one project-claimed founder

## Findings and iteration history

The source comparison exposed one P1 hierarchy issue: the team evidence was a compact row with no visible distinction between verified people, claimed people, and identity gaps. It appeared less important than the token and creator summaries even though identity is a core diligence question.

The implementation promotes People with a direct chapter title, a dedicated diligence surface, a three-part evidence summary, larger person cards, visible roles, and separated source-grounded versus project-claimed identities. No actionable P0, P1, or P2 issue remains after the first paired comparison. The section is deliberately taller than the token and creator cards and remains readable at the narrow viewport.

The paired artifact compares the supplied desktop source with the available narrow in-app browser viewport, so it is a hierarchy and responsive comparison rather than a pixel-geometry match. The component retains its existing two-column desktop grid and uses the new full-width team panel beneath it.

## Required fidelity surfaces

- Typography: existing ARGUS sans and mono families remain; the team title now uses the chapter's editorial display scale and person names use a stronger readable weight.
- Spacing and rhythm: the panel gains clear header, summary, roster, and claim zones while staying on the existing report grid and spacing tokens.
- Colors and surfaces: existing panel, line, ink, signal-green, caution, and shadow tokens are reused in light and dark themes.
- Assets and icons: real Phosphor people and warning icons are used. Existing avatar behavior is preserved; no placeholder art or custom SVG was introduced.
- Copy and information: all names, roles, evidence, source links, leader-currency records, advisor data, and review actions remain. New counts are derived from the same existing team collections.
- Responsive behavior: at 673px the summary remains three readable columns, person evidence wraps without clipping, and project claims retain their review action. At 639px and below the header, summary, and person cards stack to one column.

## Interaction and accessibility checks

- The People story link lands at the promoted chapter.
- The diligence panel has a named region and its count strip has an accessible summary label.
- Role-proof and project-claim source links remain external links.
- Each resolvable person retains the existing Review action and audit limit behavior.
- Focused component tests cover the heading, summary counts, founder count, and rendered person-card count.

## Follow-up polish

No P3 follow-up is required for this focused hierarchy change.

---

# Design QA — referral credits and cash earnings (issue #146)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-22 at 4.48.55 PM.png`
- Source focus crop: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/referrals-146/source-referrals-crop.png`
- Final light implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/referrals-146/implementation-light-top-final.png`
- Dark implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/referrals-146/implementation-dark-top-v2.png`
- Lower-page implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/referrals-146/implementation-narrow-lower.png`
- Combined comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/referrals-146/comparison-top-final.png`
- Source pixels: 3396 × 2028 at 144dpi; implementation pixels and CSS viewport: 673 × 1504 at 1× browser capture density
- State: authenticated member, light and dark themes, representative current-user earnings, payout tracking inactive

## Findings and iteration history

The source exposed one P1 product-hierarchy gap: it described referral credits but did not present the existing subscription commission, cash split, earned balance, or payout state. The page read like an access leaderboard rather than an earnings product.

The first implementation comparison added a direct earnings narrative, a 20% reward term, the existing 25% credit / 75% cash split, a real total earned value, a separate cash-earned value, a primary invite action, four operational metrics, an explanatory reward model, and cash/credit columns in the leaderboard. No referral link, masked code, rank, access state, qualified count, available-credit balance, or leaderboard row was removed.

The first dark-theme pass found one P2 contrast and brand-consistency issue: the shared dark `on-signal` token rendered black text on a bright green earnings card. The final pass locally fixes the card foreground to white, deepens the brand green, quiets the internal panels, and raises secondary-label opacity. The post-fix light and dark captures have no remaining P0, P1, or P2 finding.

The source is a wide 2× desktop screenshot and the controllable in-app browser was a 673px-wide panel. The combined artifact therefore evaluates hierarchy, density, content preservation, and responsive behavior rather than claiming pixel-identical desktop geometry. At desktop breakpoints the existing workspace remains fluid and the hero uses the intended two-column story/earnings composition.

## Required fidelity surfaces

- Fonts and typography: existing ARGUS system sans and mono families remain. The new editorial headline, tabular money, compact labels, and leaderboard values use the established hierarchy and optical weights.
- Spacing and layout rhythm: the flat stack becomes a clear story, earnings surface, invite action, metric grid, reward explanation, and leaderboard. Existing workspace gutters and fluid full-width behavior remain.
- Colors and visual tokens: panel, line, sidebar, ink, and signature-green tokens remain the base. The earnings card uses a deeper mix of the ARGUS green with a white local foreground in both themes.
- Image quality and assets: the existing ArgusMark and profile-photo behavior are preserved. New functional symbols are real Phosphor icons; no placeholder art, custom SVG, CSS illustration, or emoji was introduced.
- Copy and content: the page now states both earning paths without promising unavailable payouts. It uses the existing `commission`, `revenueShare`, `cashPayoutsActive`, credit balance, rank, and leaderboard fields.
- Responsive behavior: at 673px the hero stacks, metrics form a two-column grid, the invite control remains usable, reward steps stay readable, and the leaderboard retains its intentional horizontal table scroll rather than clipping data.

## Interaction and accessibility checks

- `Copy invite link` writes the full personal URL and changes visibly to `Copied`.
- The invite link remains read-only and labeled; the earnings and performance surfaces have named regions.
- Cash is labeled as earned while payout availability is stated separately. When payouts are inactive, the UI says the balance is tracked and does not claim it is payable.
- The public leaderboard continues to expose only masked code tails.
- Light and dark renders preserve white-on-green earnings text and visible focusable controls.

## Follow-up polish

No P3 follow-up is required for this focused redesign.

final result: passed

---

# Design QA — project identity rail (issue #134)

- Selected visual target: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/project-identity-rail-134/selected-option-1.png`
- Light implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/project-identity-rail-134/implementation-light-v2.jpg`
- Dark implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/project-identity-rail-134/implementation-dark.jpg`
- Mobile implementation stage: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/project-identity-rail-134/implementation-mobile-stage-v3.jpg`
- Full paired comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/project-identity-rail-134/comparison-full-v2.jpg`
- Focused paired comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/project-identity-rail-134/comparison-rail-focused-v2.jpg`
- Desktop viewport: 1280 × 720 CSS pixels
- Mobile iframe viewport: 390 × 844 CSS pixels
- State: representative Interfold project with official site, X, Telegram, Docs, Discord, GitHub, Ethereum contract, and report verdict

## Findings and iteration history

The first implementation comparison retained the selected three-part hierarchy but the resource labels and contract metadata were slightly denser than the target. The second pass tuned group spacing, icon scale, label hierarchy, and the signature-green copy affordance. No actionable P0, P1, or P2 differences remain after the second paired comparison.

The implementation intentionally uses the existing ARGUS report type scale and surface tokens rather than copying the larger concept scale literally. The selected hierarchy is preserved: one dominant official-project destination, a quiet icon ledger for supporting resources, and a distinct contract block.

## Required fidelity surfaces

- Fonts and typography: existing ARGUS sans and mono families are retained, with uppercase mono group labels and compact readable destination labels.
- Spacing and layout rhythm: the rail spans the report width, uses the report's border rhythm, and collapses from three columns to two or one according to available groups and viewport width.
- Colors and visual tokens: existing ink, panel, line, and signature-green brand tokens are used in light and dark themes.
- Assets and icons: real Phosphor platform and utility icons are used; no drawn or placeholder icons were introduced.
- Copy and content: every supplied URL remains available. Labels are normalized to X, Telegram, Docs, Discord, and GitHub, while the official site label, chain, and copyable contract remain explicit.
- Responsive behavior: at 390px, `innerWidth`, `documentElement.clientWidth`, `body.scrollWidth`, and `documentElement.scrollWidth` all measured 390px, confirming no document-level horizontal overflow. Resource items wrap while preserving tap targets.

## Interaction and console checks

- Official project and resource destinations retain external-link behavior.
- The contract button copies the full address and changes its visible state to `Copied`.
- Empty groups collapse without blank columns; this behavior is covered by a focused component test.
- Light and dark renderings completed successfully.
- Browser console check found 0 errors and 0 warnings in the isolated component preview.

## Follow-up polish

No P3 follow-up is required for this component.

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

---

# Social activity design QA

## Comparison target

- Source visual truth: `docs/design-qa/social-activity-2026-08-22/source-option-1.png`
- Browser implementation: `docs/design-qa/social-activity-2026-08-22/implementation-v2.png`
- Focused comparison: `docs/design-qa/social-activity-2026-08-22/comparison-v2.png`
- Viewport: 1536 x 1024 CSS pixels at device scale 1
- Source pixels: 1596 x 985
- Implementation pixels: 1536 x 1024
- Normalization: the source panel and implementation panel were cropped to their visible card bounds and normalized to 1440 x 535 before the side-by-side comparison.
- State: light theme, complete X collection, 24-hour view, CLUTCH fixture

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation preserves the source's strong count-first hierarchy, compact report typography, restrained weights, and monospaced evidence metadata. The project name is inserted from the bound report identity rather than hard-coded UI copy.
- Spacing and layout rhythm: the title, toggle, lead metric, movement, score, supporting metrics, chart, and source note follow the source order and density. The implementation uses the report's existing panel radius, border, and spacing tokens so it fits the surrounding design language.
- Colors and visual tokens: the selected source's white report surface, neutral controls, black text, and green activity accents map to existing ARGUS theme tokens. Green communicates activity emphasis here and is explicitly separated from the safety verdict.
- Image and asset fidelity: the source has no photographic or illustrative asset. Interface icons use the project's existing Phosphor icon library. The chart is generated from the saved hourly data rather than a decorative image.
- Copy and content: the implementation retains the source's plain-language lead, comparison, activity score disclaimer, account breadth, post volume, concentration, capture time, and source basis. It adds an expandable exact-query receipt and honest partial and unavailable states.
- Accessibility and interaction: the 24-hour and 7-day controls expose `aria-pressed`; the chart has an accessible summary; the seven-day state was exercised in the browser and updated both the lead metric and pressed state.

## Focused evidence

The focused side-by-side comparison was required because the full source includes a report shell while the local harness isolates the new section. It confirms that the main card hierarchy, metric grouping, activity-score treatment, green histogram, and source footer match the selected direction. The source mock depicts more bars than a literal hourly 24-hour view; the implementation intentionally renders 24 hourly buckets so the label and data window agree.

## Comparison history

### Iteration 1

- Finding: P2, the histogram inherited the neutral interaction token and rendered black, while the selected design uses green activity bars.
- Finding: P2, the activity score was oversized plain text instead of the compact bordered score treatment in the source.
- Finding: P2, the lead sentence said "this project" instead of naming the bound project, weakening the report-specific read.
- Fixes: mapped histogram bars to the ARGUS brand-green token, adopted the compact bordered score treatment, removed the extra eyebrow, and used the bound project name in the lead sentence.
- Post-fix evidence: `docs/design-qa/social-activity-2026-08-22/implementation-v2.png` and `docs/design-qa/social-activity-2026-08-22/comparison-v2.png`.

## Primary interactions and runtime checks

- Switched from 24 hours to 7 days in the browser.
- Verified `aria-pressed="true"` on the seven-day control.
- Verified the lead changed to the seven-day account breadth.
- Checked browser console errors after the final reload: none from the application.

## Follow-up polish

- P3: the generated source uses a denser chart whose apparent time span conflicts with its 24-hour label. The implementation favors data correctness with one bar per captured hour.

final result: passed

---

# Design QA — remove saved example from New Investigation (2026-08-23)

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-23 at 12.07.57 AM.png`, with the user's explicit direction to remove the shown saved-report strip
- Desktop implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/remove-saved-example/implementation-desktop.jpg`
- Mobile implementation: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/remove-saved-example/implementation-mobile.jpg`
- Focused comparison: `/Users/kyle/.codex/visualizations/2026/08/22/01a02b5f-5cc0-7f63-8391-250cbbe26c8f/remove-saved-example/comparison-focused.png`
- Viewports: 1440 × 1000 desktop and 390 × 844 mobile at browser-normalized 1× capture density
- State: authenticated light-theme New Investigation page, default decision intent, empty subject input

## Findings and comparison history

The source contained the saved-Uniswap explainer, divider, and action the user asked to remove. The implementation removes the entire region and its landing-specific routing prop, then closes the layout directly from the provider-cost disclosure into the report-method section. The focused comparison shows the removed strip on the left and the clean handoff on the right. No actionable P0, P1, or P2 issue remains after the first comparison.

## Required fidelity surfaces

- Fonts and typography: unchanged; existing ARGUS landing hierarchy remains.
- Spacing and layout rhythm: the empty strip and its border are removed; the next section retains the existing 48px responsive chapter gap.
- Colors and tokens: unchanged; existing light and dark tokens remain.
- Image quality and assets: unchanged; no image or icon asset was added or replaced.
- Copy and content: only the user-targeted saved-example copy and link were removed. Investigation inputs, intent choices, privacy, provider-cost disclosure, report outcomes, and navigation remain.

## Verification

- Desktop and mobile in-app browser renders contain zero saved-example text and zero console errors or warnings.
- Mobile body width equals viewport width at 390px, with no horizontal overflow.
- Focused landing and App routing tests pass (41 tests); TypeScript and scoped ESLint pass.

final result: passed

---

# Design QA — condensed-header logo parity (2026-08-23)

- Source visual truth: `docs/design-qa/mobile-logo-parity-2026-08-23/source-old-mobile-logo.png`, showing the inconsistent legacy eye in the condensed header
- Browser implementation: `docs/design-qa/mobile-logo-parity-2026-08-23/implementation-mobile-v1.png`
- Focused implementation: `docs/design-qa/mobile-logo-parity-2026-08-23/implementation-header-v1.png`
- Combined comparison: `docs/design-qa/mobile-logo-parity-2026-08-23/comparison-v1.png`
- Viewport: 390 × 844 CSS pixels at device scale 1; the in-app capture transport produced 395 × 795 pixels
- Source pixels: 245 × 159; focused source header crop: 245 × 58
- Implementation focused pixels: 390 × 56, preserving the native condensed-header CSS height
- State: authenticated light-theme New Investigation page, mobile/condensed shell, drawer closed

## Findings

The P2 responsive identity mismatch shown in the source is resolved. No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the condensed wordmark now uses the same semibold interface treatment and 0.045em tracking as the expanded lockup, scaled to 14px for the 56px header.
- Spacing and layout rhythm: the selected 28px seal replaces the 22px legacy almond without changing the menu target, 56px header height, or surrounding mobile content position.
- Colors and visual tokens: the iris uses the ARGUS brand-green token and the remaining mark colors inherit the same theme-aware tokens as the expanded sidebar.
- Image quality and asset fidelity: the condensed header now renders the selected option 3 point-field seal rather than the old eye. Its aperture, iris, pupil, and catchlight remain sharp at 28px.
- Copy and content: the `ARGUS` wordmark and `New investigation` context are unchanged.
- Motion and accessibility: the mobile mark uses the same slow pupil-only observing loop and the same reduced-motion override as the expanded logo.

## Full and focused evidence

The full mobile capture confirms the header remains stable above the responsive landing page. The focused before/after comparison was required to make the small mark legible and confirms that the old almond is gone while menu spacing and wordmark position remain consistent.

## Comparison history

### Iteration 1

- Earlier finding: P2, the condensed header used the legacy default eye while the expanded sidebar used the selected option 3 seal.
- Fix: passed the brand tone, seal variant, and observing pupil motion into the mobile AppShell header; aligned its wordmark treatment with the expanded header.
- Post-fix evidence: `docs/design-qa/mobile-logo-parity-2026-08-23/comparison-v1.png`.

## Runtime checks

- Browser measurement: 28 × 28 seal inside a 395 × 56 rendered mobile header; `data-argus-eye-variant="seal"` and brand tone confirmed.
- Browser console: zero errors and zero warnings.
- Automated verification: 18 focused AppShell, mark, and navigation tests passed; production build passed.

final result: passed
