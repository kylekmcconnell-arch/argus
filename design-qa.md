# EARN on Hood · Report Style 2 design QA

## Comparison target

- Source visual truth: `/Users/kyle/Documents/ARGUS-earn-report-fix/design-references/earn-report-v2-option-1.png`
- Rendered implementation: `http://127.0.0.1:5173/?design-preview=earn-report-style-2`
- Primary implementation capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-top-1440x1024.jpg`
- Production token-route capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style2-production.png`
- Production Style 1 control capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style1-production.png`
- Production mobile token-route capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style2-mobile-production.png`
- Source / production comparison canvas: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style2-comparison.png`
- Focused captures:
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-web-1440x1024.jpg`
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-people-1440x1024.jpg`
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-loading-1440x1024.jpg`
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-mobile-390x844.jpg`
- Source pixels: 1487 × 1058.
- Desktop implementation pixels / CSS viewport: 1440 × 1024 at device density 1.
- Mobile implementation pixels / CSS viewport: 390 × 844 at device density 1.
- Density normalization: both desktop images were shown together in one comparison input and visually fit to the same comparison canvas; no @2x downsampling was required.
- State: light theme, completed loading sequence, report top; focused Web & Product and People states; mobile report top; named loading sequence in progress.
- Production route verified: `https://argus-one-flax.vercel.app/?s=0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3&kind=token&reportStyle=2`.

## Full-view comparison evidence

The source and final production token-route render were placed together in the same 2880 × 1024 comparison input at the matched desktop state. The implementation preserves the source's editorial decision-memo hierarchy, split verdict/score composition, restrained light palette, compact evidence typography, narrative triptych, and social/market signal strip. The intentional deviations improve the requested usefulness: each score segment names the dimension being added, the two scores are explicitly distinguished, Web analysis is visible in the masthead rather than discoverable only below the fold, and the authenticated report toolbar now exposes Style 1 and Style 2 on the canonical `$EARN` route.

## Focused region comparison evidence

- Web & Product: the masthead entry and full web chapter are both visible, with the official domain, project binding, dates, product claims, explicit evidence limits, and working official-source links.
- People: the placeholder letter avatar was replaced by the real `@0xTharmas` profile image; the captured image is sharp, circularly cropped, correctly scaled, and paired with the exact role-source boundary.
- Loading: the capture names the currently active research phase and the remaining phases, so it does not read as an unexplained loading ring.
- Mobile: the 390 px production capture has no overlap or broken headline wrapping. The Style 1 / Style 2 control remains visible above the horizontally scrollable action row on the standalone token report; the project report retains the choice in its mobile actions menu.

## Required fidelity surfaces

- Fonts and typography: passed. System sans and mono fallbacks preserve the source hierarchy; display text, score numerals, labels, long headings, and explanatory copy remain readable without truncation. The implementation uses sentence case for the verdict to improve editorial legibility while retaining the source scale.
- Spacing and layout rhythm: passed. Desktop frame, split hero, card tracks, dividers, section rhythm, and focused Web/People grids are aligned and balanced. Mobile stacks cleanly with stable margins and usable tap spacing.
- Colors and visual tokens: passed. Paper, ink, lime identity, green support/pass, amber caution, red concern, and low-contrast dividers map consistently to the source.
- Image quality and asset fidelity: passed. The official site favicon and real creator profile image render successfully; no placeholder avatar, emoji, handcrafted SVG substitute, or CSS-art face remains.
- Copy and content: passed. Web analysis, social coverage limits, market-size fallback, project-versus-token score meaning, sources, risks, and verification plan are explicit and coherent.
- Icons: passed. Phosphor icons use a consistent stroke family and align correctly in buttons, evidence notes, source rows, and the loading sequence.
- Accessibility: passed. Semantic headings, navigation, buttons, labels, alt text, focus treatments, disabled states, and reduced-motion behavior are present. Mobile controls meet practical tap height.

## Primary interactions tested

- Initial named loading sequence and Replay analysis.
- Web analysis masthead anchor and full Web & Product chapter.
- 24-hour / 7-day social toggle.
- Show all / show fewer notable mentions.
- Connection-type filtering.
- Challenge text entry, enabled submit, and saved confirmation.
- Desktop and 390 px responsive states.
- Standalone `$EARN` token Style 1 / Style 2 switching, including URL add/remove behavior.
- Direct `reportStyle=2` token deep-link loading.
- No application error boundary or development-server error surfaced during the browser-rendered run.

## Comparison history

1. Initial finding — P1, Web discoverability: Web & Product existed below the fold but was not visible from the first screen. Fix: added a masthead `Web analysis · earnonhood.com` entry while retaining the complete Web & Product chapter. Post-fix evidence: top and web captures above.
2. Initial finding — P1, image fidelity: the team card used a placeholder `T`. Fix: replaced it with the live `@0xTharmas` profile photo and meaningful alt text. Post-fix evidence: people capture above.
3. Initial finding — P2, mobile access: the desktop style segmented control was hidden below the `sm` breakpoint. Fix: added the same Style 1 / Style 2 choice to the mobile report-actions menu. Post-fix evidence: 390 × 844 responsive capture and component inspection.
4. Final comparison: no actionable P0, P1, or P2 differences remain. The source's application shell is intentionally absent from the isolated development harness; production embeds Style 2 inside the existing authenticated ARGUS shell and report toolbar.
5. Production route finding — P1, integration: the first selector integration covered the combined-investigation renderer, but the recent `$EARN` case opens the standalone `TokenReport` renderer. Fix: wired the canonical EARN address into both renderers, added focused regression coverage, promoted a corrected artifact, and verified the exact `kind=token` route in the authenticated in-app browser.

## Follow-up polish

- P3: the stacked metadata block is deliberately roomy on narrow mobile screens; it could be condensed later if mobile above-the-fold density becomes a product priority.

## Implementation checklist

- [x] Style 1 remains the default.
- [x] Style 2 is available on both canonical EARN on Hood surfaces: `@earnonhood` and the `$EARN` token address.
- [x] Other project and token reports do not expose the EARN style control.
- [x] Style choice is URL-addressable with `reportStyle=2`.
- [x] Web analysis is visible above the fold and remains a full chapter.
- [x] Real creator image is visible.
- [x] Social activity and notable mentions are present.
- [x] Project diligence and token safety are visibly distinct.
- [x] Loading and score-composition animations name their current evidence dimension.
- [x] Market-size band replaces an invented rank when a reliable global rank is unavailable.

final result: passed
