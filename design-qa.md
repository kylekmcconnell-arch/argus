# Sticky report table of contents - design QA

## Evidence

- User reference: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 11.43.15 AM.png`
- Tested implementation: `http://127.0.0.1:4173/?design-preview=earn-dual-score`
- Visual state: canonical Style 2 opening with the new contents bar immediately above “State of the House.”
- Same-input comparison: the supplied report screenshot and the rendered sticky-navigation preview were opened together before final review.

## Design comparison

The reference establishes the insertion point and the report’s restrained editorial language: the navigation belongs between the subject context and the State of the House chapter, without turning into a second toolbar. The implementation uses the existing ARGUS border, panel, typography, icon, spacing, and active-state tokens. It remains a single quiet horizontal line above the story instead of adding a large navigation panel.

The table of contents is horizontally scrollable when destinations exceed the available width. It includes only sections present in the report: Decision, Summary, Risks, Market, Social, People, Connections, Evidence, Method, and Challenge where applicable. Counts remain attached to destinations that benefit from them.

## Findings and fixes

- [P1] The existing report guide began after the decision opening and became a right rail at large widths, so it could not orient readers at the start of the report. Fixed by placing the canonical contents bar before `#report-summary`.
- [P1] A static list would not tell readers where they are. Fixed with `IntersectionObserver`-based active-section tracking and `aria-current="location"`.
- [P1] Two simultaneous navigation systems would add clutter. Fixed by suppressing the old embedded guide navigation while preserving its status and next-step rail.
- [P2] Long destination lists could widen the page. Fixed with an independently scrolling navigation row; browser verification reports no page-level horizontal overflow.
- [P2] Anchor jumps could hide section headings beneath sticky chrome. Existing scroll offsets are retained, and the interaction check landed the target below both sticky headers.

## Interaction and automated verification

- Initial active destination: Decision.
- Deep-link test: `#preview-social` lands with the table of contents at 65px and the Social section at 128px.
- Scroll-spy test: Social becomes the active destination after navigation.
- Runtime check: no Vite overlay or visible runtime error.
- Layout check: no horizontal page overflow.
- Automated checks: targeted ESLint passes; TypeScript passes; 3,985 tests pass across 376 files; production build passes.

final result: passed
