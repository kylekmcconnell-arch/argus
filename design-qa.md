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
