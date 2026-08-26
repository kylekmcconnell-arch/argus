# Report-opening narrative and overflow repair - design QA

## Evidence

- Broken production reference: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 11.39.13 AM.png`
- Narrative reference: `/Users/kyle/Downloads/Screenshot 2026-08-18 at 2.04.59 PM.png`
- Tested implementation: `http://127.0.0.1:4173/?design-preview=earn-dual-score`
- Responsive viewport: 319 CSS pixels wide.
- Same-input visual comparison: broken reference, Auric narrative reference, and the full-page implementation capture were reviewed together.

## Comparison

The broken reference publishes the raw X bio, emoji separators, and a full contract address beneath the title. The address crosses the narrative column and collides visually with the score composition. The repaired opening instead gives two compact, readable sentences: what EARN on Hood does and how the linked `$EARN` token relates to it. No contract address or raw social-profile formatting appears.

The Auric reference establishes the intended story order: identify the product, state the operating context, then explain why the score landed where it did. The implementation now follows that order. The opening provides product orientation and the `Why` paragraph uses the Grok-generated report conclusion as its narrative spine before describing what could change the result.

## Findings and fixes

- [P1] Raw X biography and contract data overflowed the report hero. Fixed by prohibiting raw-bio publication, stripping URLs/contracts/social formatting, and adding defensive wrapping.
- [P1] The opening did not explain what the product or token actually does. Fixed by preserving Grok subject orientation in the dossier and preferring its source-bound product explanation.
- [P1] The score explanation read like disconnected deterministic fragments. Fixed by using the Grok report headline as the primary `Why` narrative.
- [P2] Existing saved reports may not contain the newly improved Grok orientation. Fixed with an evidence-safe fallback built from official product facts, the first-party site, and verified token linkage.

## Browser and automated verification

- Browser DOM check: no EVM contract in the opening, expected product/token summary present, and two score cards present.
- Overflow check: `document.documentElement.scrollWidth === document.documentElement.clientWidth` at 319 CSS pixels.
- Narrative check: the `Why` section contains the report conclusion rather than concatenated score fragments.
- Runtime check: no Vite error overlay or visible runtime error.
- Automated checks: TypeScript passes; 3,984 tests pass across 376 files; targeted ESLint passes; production build passes.

final result: passed
