# Canonical report header QA

## Comparison target

- Source visual truth: `/Users/kyle/Downloads/Screenshot 2026-08-24 at 12.19.07 AM.png`
- Browser-rendered implementation: `implementation.png`
- Source pixels: 1145 × 208
- Implementation pixels: 1280 × 759
- CSS viewport: 1280 pixels wide, device scale 1; implementation captured full-page
- Normalization: the source header and implementation header were reviewed together in one comparison input at their natural aspect ratios.
- State: light theme; token investigation; official site, X, GitHub, Robinhood Chain contract; early score with open checks.

## Findings

No actionable P0, P1, or P2 differences remain in the canonical top block. The implementation preserves the reference hierarchy: compact investigation label, large subject name, right-aligned copy action, hairline divider, then Project / Resources & Community / Contract groups. It reuses the existing ARGUS gradient, radius, typography, icons, borders, and spacing tokens.

The decision brief directly below the top block shows the saved `20 / 100` risk score. `71%` appears only inside the explicitly labeled Report checks region, with `5/7 checks complete` kept separate from the score.

## Fidelity surfaces

- Fonts and typography: display and mono styles match the reference hierarchy and casing.
- Spacing and layout rhythm: header padding, dividers, three-column identity rail, and compact copy action align with the reference.
- Colors and visual tokens: existing void, panel, line, signal, caution, and ink tokens are unchanged.
- Image quality and asset fidelity: production subject images remain in place; all interface icons use the existing Phosphor set.
- Copy and content: investigation kind, subject, official destinations, contract network/address, score, and check completion are explicit.

## Browser checks

- Confirmed the top block exposes one canonical report-header marker.
- Confirmed official website, X, GitHub, and copyable contract controls.
- Confirmed `20 / 100` is distinct from `71%` report-check coverage.
- Confirmed no browser console errors or warnings.

## Comparison history

- Initial production finding (P1): report paths used different subject-header structures.
- Initial production finding (P1): the shared decision header hid the saved score behind check-completion percentage.
- Fix: standardized person, project, token, and investigation renderers on the reference investigation-cover and identity-rail structure; added an explicit score contract to the shared decision canvas.
- Post-fix evidence: `implementation.png`.

## Follow-up polish

None required for this focused correction.

final result: passed
