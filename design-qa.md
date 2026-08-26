# EARN on Hood · Report Style 2 design QA

## Comparison target

- Source visual truth: `/Users/kyle/Documents/ARGUS-earn-report-fix/design-references/earn-report-v2-option-1.png`
- Rendered implementation: `http://127.0.0.1:5173/?design-preview=earn-report-style-2`
- Primary implementation capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-top-1440x1024.jpg`
- Production token-route capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style2-production.png`
- Production Style 1 control capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style1-production.png`
- Production mobile token-route capture: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style2-mobile-production.png`
- Source / production comparison canvas: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-token-style2-comparison.png`
- Latest source / implementation comparison canvas: `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-report-style2-comparison.png`
- Latest same-width implementation captures:
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-signal-wide.png`
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-social-wide.png`
  - `/Users/kyle/Documents/ARGUS-earn-report-style2/design-references/qa/earn-style2-accusation-wide.png`
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

The source and implementation were placed together in the same comparison input at the same 1833 px desktop width. The implementation preserves the editorial decision-memo hierarchy, split verdict/score composition, restrained light palette, narrative triptych, and social/market signal strip. The latest comparison verifies the requested changes directly: the warning-shaped social-coverage error becomes a useful observed-activity reading, the market range becomes a broad market-cap percentile, and the sparse accusation card becomes an integrated social triage stage with source quality, verification status, and a concrete next check.

## Focused region comparison evidence

- Web & Product: the masthead entry and full web chapter are both visible, with the official domain, project binding, dates, product claims, explicit evidence limits, and working official-source links.
- People: the placeholder letter avatar was replaced by the real `@0xTharmas` profile image; the captured image is sharp, circularly cropped, correctly scaled, and paired with the exact role-source boundary.
- Loading: the capture names the currently active research phase and the remaining phases, so it does not read as an unexplained loading ring.
- Mobile: the 390 px production capture has no overlap or broken headline wrapping. The Style 1 / Style 2 control remains visible above the horizontally scrollable action row on the standalone token report; the project report retains the choice in its mobile actions menu.
- Social and accusations: the 24-hour / 7-day chart, notable mentions, observed activity level, minimum-count boundary, and direct-subject accusation stage remain one continuous chapter on desktop and mobile.
- Market: the saved `$1.53M` market cap now reads as `Top ~20%`, with the approximation stated next to the figure rather than buried in internal-provider language.

## Required fidelity surfaces

- Fonts and typography: passed. System sans and mono fallbacks preserve the source hierarchy; narrative, evidence, market, social, source-ledger, and verification copy received a readability increase. Desktop and 390 px captures show no clipping or collapsed hierarchy.
- Spacing and layout rhythm: passed. Desktop frame, split hero, card tracks, dividers, section rhythm, and focused Web/People grids are aligned and balanced. Mobile stacks cleanly with stable margins and usable tap spacing.
- Colors and visual tokens: passed. Paper, ink, lime identity, green support/pass, amber caution, red concern, and low-contrast dividers map consistently to the source.
- Image quality and asset fidelity: passed. The official site favicon and real creator profile image render successfully; no placeholder avatar, emoji, handcrafted SVG substitute, or CSS-art face remains.
- Copy and content: passed. Web analysis, observed social activity, notable mentions, direct-subject accusations, market-cap percentile, project-versus-token score meaning, sources, risks, and verification plan are explicit and coherent. Collection telemetry no longer reads like a report failure.
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
6. Latest finding — P1, social usefulness: partial author coverage was rendered as `score withheld`, even though the report had 152+ accounts and 328 posts. Fix: added a deterministic observed-volume tier, removed the warning treatment, retained minimum-count methodology, and kept social completely separate from safety/project scores.
7. Latest finding — P1, accusation discoverability: direct-subject allegations were visually detached from social activity and lacked triage. Fix: moved them to the end of Social Activity in both report styles, added source-quality labeling, verification status, and a next-check instruction, while preserving `unconfirmed · not scored`.
8. Latest finding — P2, unmeasured capital: the capital panel rendered holder count and provider failure copy when concentration was not measured. Fix: unmeasured concentration now produces no capital metric; measured TVL, fees, or holder distribution continue to render normally.
9. Latest finding — P2, market context: broad dollar ranges and internal fallback language were not decision-useful. Fix: added broad benchmarked market-cap percentile bands; EARN now reads `Top ~20%` with explicit approximate language.
10. Latest finding — P2, classic Web visibility: the classic report rail read as generic project links. Fix: the shared component now names `Web & product`, uses the real site favicon, and identifies the official first-party surface across project, token, and combined reports.

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
- [x] Approximate market-cap percentile replaces the broad market-size range when a reliable exact rank is unavailable.
- [x] Partial social collection produces an observed activity level, not a withheld-score error.
- [x] Direct-subject accusations appear at the bottom of Social Activity in both styles when present.
- [x] Unmeasured wallet concentration is omitted from Capital footprint.
- [x] The shared classic report rail visibly restores Web & Product.

final result: passed
