# Canonical report restoration QA

## Artifacts

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-18 at 2.04.59 PM.png`
- Rendered implementation: `/tmp/argus-kyle-report-850.png`
- Combined comparison: `/tmp/argus-report-comparison.png`
- Sticky navigation evidence: `/tmp/argus-kyle-report-sticky-later.png`
- Source pixels: 2356 x 1520
- Implementation browser state: 850 x 712 CSS pixels, device pixel ratio 2
- Captured implementation pixels: 835 x 699 after browser chrome and panel cropping
- Comparison normalization: source scaled to 850 pixels wide and padded to 850 x 712; implementation scaled to 850 x 712; both placed in one 1700 x 712 comparison image
- State: EARN on Hood decision memo after the loading sequence completed

## Full-view comparison evidence

The restored report preserves the source's editorial hierarchy, light document canvas, large decision headline, restrained green accent, explicit score provenance, and generous section rhythm. The implementation intentionally replaces the older single-score state-of-the-house cover with the later approved decision memo hierarchy and separate project diligence and token safety scores.

The 850 pixel responsive state has no horizontal document overflow. The decision, source binding, scope, analyst, and recommendation remain legible before the score composition moves below the fold.

## Focused region comparison evidence

The sticky report contents bar was checked after scrolling to 2050 pixels. Browser geometry reported `position: sticky`, `top: 64`, and `bottom: 108`. The bar remained visible while the Web and product section moved beneath it. The restored page does not show the old right-side Report guide, Caution, or Check next rail.

The loading sequence was also observed before the memo appeared. It named the active work stage instead of presenting an unexplained loading ring.

## Fidelity surfaces

- Fonts and typography: the implementation keeps the strong display hierarchy and increases body readability relative to the earlier report. No overlapping titles or clipped labels were observed.
- Spacing and layout rhythm: document spacing, score grouping, and section boundaries remain consistent. The 850 pixel view reflows without horizontal overflow.
- Colors and visual tokens: the warm document canvas, black type, ARGUS green, caution amber, and token lime remain semantically distinct.
- Image quality and asset fidelity: the preview uses the supplied project mark and real interface icons. No placeholder art or improvised glyph assets were introduced.
- Copy and content: the opening describes the project and decision instead of repeating a social bio. Web, product, people, token, market, social, connections, evidence, risks, and method remain represented.

## Findings

- No actionable P0, P1, or P2 differences remain for the restoration scope.
- P3: the source and implementation are different approved report generations, so exact pixel matching is not a useful acceptance test. The comparison instead validates the shared editorial hierarchy and the later requested dual-score, narrative, and navigation changes.

## Comparison history

- Initial pass: no actionable P0, P1, or P2 visual issue was found. No visual fix was required after the comparison.
- Implementation-specific regression fixed before this pass: project, token, and person reports now share the sticky contents navigation and explicitly disable the old side guide rail.
- Post-fix evidence: focused report tests passed, the sticky bar remained visible after scrolling, and browser console errors were empty.

## Primary interactions tested

- loading sequence completes into the report
- sticky table of contents remains visible during scroll
- responsive 850 pixel report reflow
- all expected report sections are present in the rendered document
- browser console checked with no warnings or errors

final result: passed

---

# Persistent terminal evidence ledger — design QA

## Artifacts

- Source visual truth: `/var/folders/h7/6njc4p9d12s5cjfrwk2sr2080000gn/T/codex-clipboard-95a1c65d-939a-4017-9f4c-9f4241e35a9d.png`
- Light-mode implementation: `artifacts/evidence-ledger-light-mode-final.jpg`
- Responsive light-mode implementation: `artifacts/evidence-ledger-light-mode-responsive.jpg`
- Combined comparison: `artifacts/evidence-ledger-reference-vs-light.jpg`
- Source pixels: 1926 × 816
- Desktop browser state: 1280 × 720 CSS px at device density 1; the Codex panel exposed a 969 × 720 screenshot crop
- Responsive browser state: 760 × 900 CSS px at device density 1
- State: light application theme, live project investigation, four saved trace events

## Full-view comparison evidence

The light ARGUS workspace remains a white editorial surface while the evidence ledger becomes a bounded dark execution chamber. The implementation preserves the selected reference's near-black green surface, mint live indicators, mono metadata, explicit execution-trace column, semantic status colors and compact ruled rows without changing the surrounding application theme.

The source contains six example findings while the live fixture contains four real trace events. That content difference is intentional; component hierarchy and density remain consistent with the amount of saved evidence rather than adding placeholder rows.

## Focused region comparison evidence

The combined comparison verifies the persistent dark surface, live elapsed clock, trace lane, source icons, highlighted current row and confirmed/review/observed status hierarchy. Browser geometry confirmed the desktop ledger has no internal horizontal overflow and each row settles near 85 CSS pixels. At 760 px, the trace column collapses while source, finding and status remain visible and the document has no horizontal overflow.

## Fidelity surfaces

- Fonts and typography: existing ARGUS sans and mono families remain in use. Headline, source metadata, elapsed time and statuses preserve the reference hierarchy with readable light-on-dark contrast.
- Spacing and layout rhythm: the desktop five-column grid, ruled rows, compact header and terminal footer match the reference structure. The responsive state removes only the decorative trace lane and stacks finding copy without clipping.
- Colors and visual tokens: the ledger owns a local near-black, muted mint and semantic amber/red palette in both application themes. The surrounding light report does not inherit these terminal tokens.
- Image quality and asset fidelity: the section contains no raster imagery. Source and status marks use the existing Phosphor icon library rather than improvised graphics.
- Copy and content: all live evidence text, source names and statuses come from the actual trace. The added clock and column labels describe the running system without inventing findings.
- Accessibility and behavior: the live region semantics remain unchanged, elapsed time is represented with a `time` element, reduced-motion scrolling behavior remains covered, and the narrow layout has no horizontal overflow.

## Comparison history

1. Initial implementation: the pulse icon reserved a square 116 px box, making rows too tall and pushing earlier findings out of the visible ledger.
   - Fix: constrained the icon to a 116 × 24 px trace lane.
   - Post-fix evidence: desktop rows measure roughly 85 px and all four fixture events fit with the live tail.
2. Responsive verification: the five-column desktop grid would be too dense below 760 px.
   - Fix: hide only the execution trace, retain source/finding/status, and stack the header clock below the title.
   - Post-fix evidence: `artifacts/evidence-ledger-light-mode-responsive.jpg`; browser geometry reports no document or ledger overflow.

## Primary interactions tested

- live elapsed clock updates
- live/saved status treatment
- automatic tail-follow behavior and jump-to-latest behavior through the existing test suite
- reduced-motion scrolling
- desktop and 760 px light-mode rendering
- browser console checked with no warnings or errors

final result: passed

---

# Design QA — Rabbit-hole research CTAs

## Verification target

- Product audit: `/Users/kyle/Documents/ARGUS/.design-audit/rabbit-hole-ctas-2026-08-27/AUDIT.md`
- Visual language reference: `/var/folders/h7/6njc4p9d12s5cjfrwk2sr2080000gn/T/codex-clipboard-3233c4b2-d0fb-4145-8685-1b9d6e0dcca0.png`
- Running-state capture: `artifacts/design-qa/kyle-research-sheet-progress.png`
- Completed-state capture: `artifacts/design-qa/kyle-research-sheet-complete.png`
- Browser preview: `http://127.0.0.1:4173/?design-preview=kyle-intelligence#relationships`
- Desktop viewport: 1488 × 1058
- Responsive viewport: 720 × 900

## Implementation evidence

- Eligible relationship nodes now expose one consistent `Research this` action. The action opens a confirmation sheet before spending and separates free saved evidence from a fresh investigation.
- The confirmation state presents entity identity, source-report context, decision-impact reasoning, a 0.8–1.6 credit estimate, 2–4 minute estimate for people, current balance, private-search surcharge, and a maximum-charge confirmation label.
- Confirmation hands the request to the real fresh-scan path with stored-case reuse disabled. The app retains a `Back to {source report}` strip through resolving, live progress, and the finished report.
- The prototype sheet demonstrates live progress and completion states. In the real app the existing live-run surface takes over after confirmation and continues in the background.
- `Next rabbit holes` is limited to three source-backed entities, ranked by decision impact and diversified across relationship clusters. The verified ANYONE fixture resolves to a person, token, and second person rather than three generic popular accounts.
- Paid CTAs require high confidence, at least one saved source, a valid entity identifier, and kind-specific validation. Exact role-fragment input `Bloxroute. Senior` is covered by a regression test and receives `Verify identity first`, never a paid action.

## Accessibility and responsive evidence

- Dialog semantics, name and description are exposed to the browser accessibility tree.
- Focus moves to the sheet, remains trapped inside it, and returns to the originating `Research this` button after Escape.
- Price, progress, completion, and invalid-identity explanations use text and live-region semantics rather than color alone.
- The 720px pass preserves all confirmation details and stacks the actions without horizontal clipping.
- Reduced-motion CSS disables nonessential research animations.

## Fidelity surfaces

- Typography and color stay within the Kyle report lane’s editorial serif/mono hierarchy, neutral panels, green evidence accent, and black primary action.
- The sheet is deliberately narrower than the graph so the source relationship remains visible behind the modal context.
- Person portraits and entity imagery are reused from the evidence web; letter fallbacks remain truthful when no source-backed image exists.
- The research lifecycle preserves the selected Option 2 graph’s information architecture instead of introducing a separate generic checkout page.

## Iterations made

1. Replaced the first-pass single-credit modal with an explicit saved-versus-fresh decision sheet.
2. Added a source-backed identity gate after the audit revealed malformed role fragments could otherwise become billable subjects.
3. Diversified recommendations by graph cluster so team members do not crowd out a controlling asset or token.
4. Corrected a nested text selector that initially caused row labels and descriptions to sit on the same line; final browser DOM and responsive checks show the intended stacked hierarchy.
5. Added app-level return context and forced fresh execution so confirmation cannot silently reopen an old saved case.

## Automated and runtime checks

- Focused ESLint on all modified TS/TSX files: passed.
- TypeScript client, server and API projects: passed.
- Production build: passed.
- Full Vitest suite: 386 files and 4,048 tests passed.
- Browser console: no warnings or errors; Vite/React development messages only.
- Repository-wide lint remains red on 222 pre-existing errors outside this feature; no modified file contributes an error.

## Findings

No actionable P0, P1 or P2 findings remain in this scope.

P3 follow-up: a future billing service can replace the current estimate with an exact provider-specific reservation and refund receipt without changing the confirmation contract.

final result: passed

---

# Report typography accessibility QA

## Artifacts

- Source visual truth: `/private/tmp/argus-report-type.ZKOrOV/.design-qa/production-verdict-before.jpg`
- Rendered implementation: `/private/tmp/argus-report-type.ZKOrOV/.design-qa/readable-type-after.png`
- Combined report-crop comparison: `/private/tmp/argus-report-type.ZKOrOV/.design-qa/typography-verdict-before-after.png`
- Browser viewport: 1280 × 720 CSS pixels at device density 1
- Source and implementation pixels: 1280 × 720 each
- Comparison normalization: both captures were cropped to the verdict region and normalized to a 1020 × 540 comparison panel
- State: light-theme Kyle verdict with two score rings; the implementation uses fixture scores while preserving the production structure and content hierarchy

## Full-view comparison evidence

The production capture showed readable headlines but compressed secondary copy: 9–11px mono labels, 10–12px score annotations, and pale gray explanatory text. The implementation retains the same editorial hierarchy and two-ring composition while raising body copy to 15.5–16px, supporting evidence to 13–14.5px, and micro labels to an 11px minimum.

## Focused region comparison evidence

The verdict crop contains the report overline, saved-report metadata, thesis, score-ring labels, score context, completion labels, and the three fact columns. These are the highest-density type tiers in the opening and were large enough to judge at the normalized crop, so an additional detail crop was not needed.

## Fidelity surfaces

- Fonts and typography: existing serif, sans, and mono families remain unchanged; only undersized report tiers were raised, with line heights increased for supporting copy.
- Spacing and layout rhythm: the two score rings, headline measure, and fact grid remain intact at 1280px. Larger copy wraps naturally without collision in the verified opening and score preview.
- Colors and visual tokens: report-scoped dim and faint text are darker in light mode and brighter in dark mode; semantic pass, caution, and fail colors are unchanged.
- Image quality and asset fidelity: no image assets changed.
- Copy and content: no report copy, score, evidence, or navigation content changed.

## Findings

- No actionable P0, P1, or P2 typography or layout issues remain in the verified desktop verdict and score states.
- P3: dense tables may become taller because source notes now use a readable minimum size; this is intentional and preserves all content.

## Comparison history

- Initial finding: supporting report text fell below a comfortable reading floor and relied on low-contrast gray.
- Fix applied: Kyle-report contrast tokens, a utility-size floor, and explicit score, identity, people, and editorial-canvas sizing within Kyle's presentation lane.
- Post-fix evidence: normalized verdict comparison, full score-card preview, 107 focused tests, TypeScript, lint, and production build all passed.

final result: passed

---

# Content-sized resource links QA

## Artifacts

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-27 at 2.03.50 AM.png`
- Browser-rendered implementation: `/tmp/argus-resource-width.aoQcwe/.design-qa/project-links-implementation-full.png`
- Focused implementation crop: `/tmp/argus-resource-width.aoQcwe/.design-qa/project-links-implementation-crop.png`
- Combined comparison: `/tmp/argus-resource-width.aoQcwe/.design-qa/source-vs-content-sized-resources.png`
- Browser viewport: 1280 × 720 CSS px at device density 1
- Source pixels: 537 × 127; focused implementation pixels: 537 × 127
- Normalization: the implementation was cropped at native density to the same 537 × 127 region and alignment as the source
- State: light theme with X and Dexscreener as the only resource links

## Full-view comparison evidence

The local 1280 × 720 report-link preview preserved the three-column identity rail, its labels, site card, contract card, vertical alignment, and surrounding border rhythm. The resources surface no longer fills its grid column.

## Focused region comparison evidence

In the combined source/implementation crop, the source shows a 467 px-wide resources surface with unused space after Dexscreener. The implementation measures 162.84 px wide with a 161 px content width and scroll width, so the border closes immediately after the two available links without clipping or overflow.

## Fidelity surfaces

- Typography: labels, link text, font sizes, weights, line heights, and letter spacing are unchanged.
- Spacing and layout: only the resources surface width changed; internal padding, separators, height, radius, and alignment remain unchanged.
- Colors and tokens: the existing neutral border, background mix, icon treatment, and shadows remain intact.
- Image quality and assets: the existing official Dexscreener favicon and X icon are unchanged and render sharply.
- Copy and content: `Resources & community`, `X`, and `Dexscreener` remain unchanged.
- Behavior and accessibility: both anchors remain keyboard-focusable and horizontally scrollable when a larger link set reaches the 100% width cap. Browser console errors were empty.

## Findings

No actionable P0, P1, or P2 differences remain for the requested width correction.

## Comparison history

- Initial source finding: the resources surface stretched to its full grid track and left a large empty tail after two links.
- Fix applied: `width: fit-content` with `max-width: 100%` on the Kyle report resources ledger.
- Post-fix evidence: the focused native-density comparison shows the border ending after Dexscreener with no collision or overflow.

## Primary interactions tested

- X and Dexscreener links remain present and correctly ordered
- the surface width matches its rendered links
- the existing overflow cap remains in place for larger link sets
- browser console checked with no errors

final result: passed
---

# Team role title containment QA

## Artifacts

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 10.31.08 PM.png`
- Rendered implementation: `/private/tmp/argus-team-role-wrap.kJX5MR/artifacts/team-role-wrap-qa/implementation-light.png`
- Combined comparison: `/private/tmp/argus-team-role-wrap.kJX5MR/artifacts/team-role-wrap-qa/source-vs-implementation.png`
- Source pixels: 572 x 239
- Implementation browser viewport: 1100 x 360 CSS pixels at device pixel ratio 1
- Implementation capture: 1100 x 360 pixels; comparison uses the matching 572 x 239 top-left report crop
- State: light-theme ANYONE people roster with two report columns and a long first-party role title

## Findings

- No actionable P0, P1, or P2 differences remain after the containment fix.
- P3: exceptionally verbose first-party roles may occupy two lines. Preserving the full sourced title is preferable to truncation because the role is decision evidence.

## Full-view comparison evidence

The source shows the first role pill crossing its card boundary and painting over the adjacent team card. In the revised implementation the role occupies a dedicated metadata row, remains visually subordinate to the person's name, and stays entirely inside the card. The two-column grid, card proportions, avatar, evidence link, and source copy remain otherwise unchanged.

## Focused region comparison evidence

Browser geometry measured the first card's right edge at 544 CSS pixels and the long role pill's right edge at 467.7 pixels. The pill uses `white-space: normal` and `overflow-wrap: anywhere`; document-level horizontal overflow is false. The title therefore has more than 76 pixels of clearance before the card boundary in the supplied state and can wrap when longer.

## Fidelity surfaces

- Fonts and typography: name weight, role mono face, 11-pixel metadata size, and source-link hierarchy are preserved. The role now uses normal white-space and balanced wrapping instead of clipping or truncation.
- Spacing and layout rhythm: the role receives one full card row while its inner pill remains content-sized. Existing card padding, two-column gap, radii, and evidence indentation remain intact.
- Colors and visual tokens: existing light-theme panel, line, ink, and signal tint tokens remain unchanged.
- Image quality and asset fidelity: no image or avatar treatment changed in this fix.
- Copy and content: the complete first-party role title remains visible; no ellipsis or shortened paraphrase removes evidence.

## Comparison history

- Initial P1: the no-wrap role pill was wider than the card and obscured the adjacent person's content.
- Fix applied: removed the team role's non-shrinking single-line treatment, moved it to its own flex row, and enabled wrapping within the card boundary.
- Post-fix evidence: the combined comparison shows the title contained; browser geometry reports no component or document overflow; focused report tests and TypeScript pass.

## Primary interactions tested

- long team role in a two-column report grid
- complete role text remains readable
- role source link remains visible and clickable
- light-theme rendering at the supplied report density
- horizontal overflow and card-boundary containment

final result: passed
<!-- QA complete -->
---

# Official team portrait QA

## Artifacts

- Source visual truth, advisors: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 10.25.56 PM.png`
- Source visual truth, core team: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 10.25.47 PM.png`
- Rendered implementation: `/tmp/argus-team-portraits.16YLkY/artifacts/team-portrait-qa/implementation-light-clean.png`
- Combined comparison: `/tmp/argus-team-portraits.16YLkY/artifacts/team-portrait-qa/source-vs-implementation.png`
- Source pixels: 1318 x 765
- Implementation capture: 1280 x 870 pixels
- Comparison normalization: source scaled to 1280 x 742; implementation cropped to its first 742 pixels; both placed on one 2560 x 742 canvas
- State: light-theme ANYONE advisor roster using the ten portraits and roles published on the official team page

## Full-view comparison evidence

The source uses large portrait-led cards because it is the project's team page. ARGUS intentionally preserves its denser two-column evidence-card hierarchy so the people section remains part of a readable diligence report rather than becoming a site clone. The requested fidelity surface is the official portrait and its correct identity binding, not the source page's promotional layout.

## Focused region comparison evidence

All ten official advisor portraits load in the implementation and map to the same names shown by the source: Sean Carey, Slava Kreynin, Sergey Ilin, Nik Hawks, Max Gold, Theodore Agranat, Sadaf Jadran, Austin Seiberlich, Benjamin Erhart, and Matthew Paik. Initial-only placeholders are gone for these verified rows. Each card retains its role and first-party role-proof link.

## Fidelity surfaces

- Fonts and typography: existing ARGUS report typography remains unchanged and legible; names, roles, and evidence controls preserve their hierarchy.
- Spacing and layout rhythm: compact two-column cards use a 56-pixel square portrait with rounded corners, consistent gaps, and no overlap or horizontal overflow.
- Colors and visual tokens: the official cyan portrait artwork is preserved against the neutral report panels and ARGUS light-theme tokens.
- Image quality and asset fidelity: exact first-party image assets are used. No generated faces, search-result avatars, placeholder art, or improvised div illustrations are introduced.
- Copy and content: names and roles match the official page, and the report preserves the source link that establishes each team relationship.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested official-team-portrait scope.
- P3: ARGUS intentionally crops the source's full-height illustrations into compact evidence portraits so the team roster remains scannable inside the report.

## Comparison history

- Initial source finding: the official site published portrait art for the roster, while the saved report reduced many people to letter placeholders.
- Root cause fixed: the team-page adapter previously extracted names, roles, and profile links but discarded portrait image provenance during normalization.
- Post-fix evidence: the fetched first-party HTML yields twenty portrait anchors across the core team and advisors; exact name binding passed for all twenty; browser console warnings/errors were empty.

## Primary interactions tested

- official portrait extraction from fetched first-party team-page HTML
- deterministic name-to-image binding across Webflow `srcset` markup
- independently verified team rows retain their portrait through report normalization
- unverified model/search leads cannot acquire an official portrait
- official image display falls back safely to a trusted X avatar or initial when absent

final result: passed

---

# Dexscreener report-link visual QA

## Artifacts

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 10.25.00 PM.png`
- Rendered implementation, light focused region: `/tmp/argus-dex-logo.OfQ30R/artifacts/dexscreener-link-qa/implementation-light-focused.png`
- Rendered implementation, light full header: `/tmp/argus-dex-logo.OfQ30R/artifacts/dexscreener-link-qa/implementation-light-full.png`
- Rendered implementation, dark focused region: `/tmp/argus-dex-logo.OfQ30R/artifacts/dexscreener-link-qa/implementation-dark-focused.png`
- Combined comparison: `/tmp/argus-dex-logo.OfQ30R/artifacts/dexscreener-link-qa/source-vs-implementation.png`
- Source pixels: 103 x 174
- Implementation browser viewport: 1280 x 720 CSS pixels at device pixel ratio 1
- Focused implementation pixels: 395 x 58 in both themes
- Comparison normalization: source retained at native size; focused implementation retained at native size; both placed on one neutral 570 x 190 comparison canvas
- State: official website, one Dexscreener resource, Robinhood Chain contract; light and dark themes

## Full-view comparison evidence

The shared identity rail preserves its existing three-part hierarchy and spacing. The resource group now has a complete perimeter border, a theme-aware panel surface, and balanced first-item padding instead of appearing as an isolated vertical divider on the document background.

## Focused region comparison evidence

The source crop showed a generic chart glyph with gray duotone shading. The revised focused capture shows Dexscreener's official favicon at 21 x 21 pixels, with the same label and destination. The logo loaded at full intrinsic resolution, remained sharp at device pixel ratio 1, and retained sufficient contrast in both light and dark captures.

## Fidelity surfaces

- Fonts and typography: the existing 11px report-resource label, line height, and type hierarchy are preserved.
- Spacing and layout rhythm: the resource strip is 58px tall with equal 13px horizontal item padding, a 5px icon-to-label gap, and no first-item indentation exception.
- Colors and visual tokens: background, border, text, hover, and shadow use shared ARGUS theme tokens; the light state is neutral rather than gray-washed, and the dark state does not inherit a light panel.
- Image quality and asset fidelity: the generic Phosphor chart icon is replaced only for Dexscreener by the official `https://dexscreener.com/favicon.png` asset. Other platform icons remain unchanged.
- Copy and content: `Resources & community` and `Dexscreener` remain unchanged, and the link still targets the contract-specific Dexscreener search.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested logo and shading scope.
- P3: a remote official favicon depends on Dexscreener availability; the report label and link remain usable if the image is unavailable.

## Comparison history

- Initial source finding: generic chart mark, duotone gray fill, isolated left-divider treatment, and no resource-panel surface.
- Fix applied: official Dexscreener favicon, complete panel border, neutral theme-aware surface, balanced padding, and restrained hover/shadow tokens.
- Post-fix evidence: matched light/dark captures, 82 focused component/report tests passed, TypeScript passed, and browser console warnings/errors were empty.

## Primary interactions tested

- official favicon loads without a browser warning or error
- Dexscreener anchor remains contract-specific and accessible by its text label
- light and dark theme rendering
- hover/focus styling remains defined through shared theme tokens

final result: passed

---

# Dual score ring design QA

## Artifacts

- Source visual truth: `/tmp/argus-score-rings.64joov/.design-qa/enigma-score-reference.png`
- Rendered implementation: `/tmp/argus-score-rings.64joov/.design-qa/kyle-dual-rings-active.png`
- Completed state: `/tmp/argus-score-rings.64joov/.design-qa/kyle-dual-rings-final.png`
- Combined comparison: `/tmp/argus-score-rings.64joov/.design-qa/reference-vs-kyle-active.jpg`
- Viewport: 1280 × 720 CSS px at device density 1
- Source and implementation pixels: 1280 × 720 each; no scaling applied
- State: both score compositions actively adding their first dimension, with final saved-score state captured separately

## Comparison evidence

The Enigma reference establishes the behavior to preserve: two distinct scores, a visible composition for each, and a live `Adding …` label with points. The Kyle implementation preserves all three inside the existing editorial ring idiom. Project diligence remains dominant; token safety is smaller but still complete. The combined full-view capture is readable at native dimensions, so no additional detail crop was needed.

Browser DOM evidence independently confirmed the live labels and totals: `Team & leadership · +15 / 15 pts` and `Onchain health · +12 / 12 pts`, followed by final saved scores `55` and `84` with their verdicts and check coverage.

## Fidelity surfaces

- Typography: ring labels, active dimension names, saved numerals, verdicts, and check-state copy preserve Kyle's editorial serif/mono hierarchy and remain legible at both sizes.
- Spacing and layout: the 252 px project ring and 208 px token ring fit the hero grid without overlap. Existing breakpoints stack the hero below 1120 px and the rings below 580 px.
- Colors and tokens: both rings use existing score bands and real composition-segment colors; no new palette was introduced.
- Image quality and assets: no image asset is part of this component; it reuses the canonical score-ring component.
- Copy and content: each animation names the dimension currently being added and its point contribution before settling on the frozen saved score, verdict, context, and check coverage.
- Behavior and accessibility: both rings use real saved composition rows, retain accessible score labels, respect reduced motion, and produced no browser console errors.

## Findings

No actionable P0, P1, or P2 differences remain.

## Comparison history

The initial normalized comparison found no actionable P0/P1/P2 mismatch, so no correction loop was required.

final result: passed

---

# Score ring segment explanations — design QA

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-27 at 2.07.01 AM.png`
- Resting implementation: `/private/tmp/argus-ring-hover.azZNxg/.design-qa/ring-resting-1280x720.jpg`
- Explained implementation: `/private/tmp/argus-ring-hover.azZNxg/.design-qa/ring-explained-1280x720.jpg`
- Focused comparison: `/private/tmp/argus-ring-hover.azZNxg/.design-qa/ring-source-vs-explained.jpg`
- Browser URL: `http://127.0.0.1:5174/?design-preview=ring-interaction` (temporary visual harness, removed before commit)
- Viewport: 1280 × 720 CSS px, device scale factor 1
- Source pixels: 755 × 436
- Implementation pixels: 1280 × 720; the comparison crop was normalized to 436 px high before side-by-side review
- State: light theme, Kyle report lane, dual-score verdict hero; source in resting state and implementation in selected-segment state

## Evidence reviewed

- Full-view comparison: the 1280 × 720 resting implementation preserves the source hierarchy, score sizes, paired-ring proportions, verdict placement, supporting copy, and composition colors.
- Focused comparison: the side-by-side ring crop verifies that the selected arc becomes thicker, unrelated arcs recede, and the score center becomes a plain-language explanation without changing the ring geometry or pushing nearby content.
- Interaction surface: both rings expose every saved composition segment as a named, focusable control. The local browser fixture exposed six segment controls with the dimension, earned/available points, rationale, and evidence counts; production reports expose one control per saved dimension.
- Automated interaction coverage: hover, mouse leave, keyboard focus, selected-segment emphasis, accessible labels, and restored resting state are covered in `src/reports/kyle/KyleIntelligenceDecisionCanvas.test.tsx`.
- Console/runtime: the preview loaded without an error boundary or visible runtime error.

## Required fidelity surfaces

- Fonts and typography: passed. The explanation uses the existing Kyle mono/editorial hierarchy, with a compact kicker, readable dimension label, green points line, and darker rationale copy.
- Spacing and layout rhythm: passed. The explanation stays inside both 252 px and 208 px rings; no card, header, or adjacent ring shifts.
- Colors and visual tokens: passed. Existing composition colors remain authoritative; selection thickens the active arc and lowers competing arcs without introducing a new palette.
- Image quality and asset fidelity: passed. This interaction adds no image or icon assets and does not replace any source asset.
- Copy and content: passed. The selected state answers three direct questions: which dimension, how many points it contributed, and why.
- Accessibility and behavior: passed. Segment controls support hover, focus, tap/click, Escape, expanded hit strokes, full accessible names, and a visible selected state.
- Responsiveness: passed for the two production hero sizes represented by the source. The smaller token ring uses tighter type and a three-line rationale limit.

## Findings

No actionable P0, P1, or P2 findings remain.

P3 follow-up: a short first-use hint could improve discoverability for users who do not naturally hover chart marks, but the help cursor and immediate arc response make the interaction understandable without adding more persistent copy.

## Comparison history

1. First explained-state capture: the rationale was too light and truncated after three lines.
   - Fix: moved the rationale to the primary ink token, raised weight and size, and allowed four lines on the primary ring and three on the smaller token ring.
   - Post-fix evidence: `.design-qa/ring-explained-1280x720.jpg` and `.design-qa/ring-source-vs-explained.jpg`.

## Final result

final result: passed
