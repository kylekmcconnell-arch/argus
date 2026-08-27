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
