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
