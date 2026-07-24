# Report system quality audit, 2026-07-24

This is the evidence set from the production report-system audit that followed
the `@ponsdotfamily` review. It covers one early project, one established
project, and one founder report.

## Audit steps

1. Opened the active Uniswap report and compared its headline funding number
   with its frozen funding sources.
2. Repaired the funding projection and reopened the same immutable report.
3. Opened the Pons v5 project report, reviewed its result language, coverage
   disclosure, provider failures, and responsive layout.
4. Deployed the fixes and ran one fresh paid validation scan for Pons.
5. Opened the exact saved Pons v6 report and compared its cost and provider
   ledger with v5.
6. Opened the saved `@gakonst` founder report and reconciled its score history,
   adverse-finding summary, and identity-confidence label with its frozen
   evidence.
7. Re-ran the offline release canary, calibration set, complete test suite,
   typecheck, and production build.

## Results

### Uniswap

Before the fix, the report paired an $11M headline with source material that
documented a $165M Series B and an $11M Series A. It also treated an amountless
DeFiLlama investor row as a BlackRock funding round.

The corrected report now shows a documented lower bound of at least $176M
across two evidenced rounds. The detailed card lists the $165M Series B led by
Polychain Capital and the $11M Series A. BlackRock is absent.

Health: healthy after repair.

### Pons

The report now says that the scored evidence falls in the caution band. It no
longer calls a coverage-limited CAUTION result a material risk finding.

The fresh v6 scan reduced the team-page search from 48 requests to 16 and
stopped presenting normal 404 responses as provider failures. Total estimated
scan cost fell from $0.58 in v5 to $0.36 in v6. The provider banner fell from
three operations and 52 failed attempts to one actual provider operation and
three failed attempts.

The remaining provisional state is evidence-based. Five of seven applicable
checks recorded outcomes. The named team, canonical token binding, and one
provider path remain unresolved.

Health: honest and useful, still provisional by design.

### `@gakonst`

The founder report now shows a score history of 83 to 84, matching the visible
84 score. A non-following claimed relationship is treated as uncorroborated,
not adverse. The hero now reports five clean screens and zero adverse findings.
Its identity label is confirmed because the frozen snapshot already records a
licensed full-name resolution plus an independent GitHub identity link.

Health: healthy after repair.

## Responsive and accessibility observations

The report sidebar remained 247 to 248 pixels wide at 1024 and 1280 pixel
viewports. The document did not horizontally overflow at either width.

The reviewed pages expose a skip link, semantic headings, report regions,
button names, result labels, and accessible score-history text. This was a
targeted visual and accessibility-tree review, not a complete keyboard,
screen-reader, zoom, or contrast certification.

## Selected screenshots

- [Uniswap hero before](01-uniswap-before.png)
- [Uniswap funding contradiction before](02-uniswap-funding-before.png)
- [Uniswap funding card after](04-uniswap-funding-card-after.png)
- [Pons v6 after system fixes](10-pons-v6-after-system-fixes.png)
- [Uniswap final](11-uniswap-final.png)
- [`@gakonst` final](12-gakonst-final.png)
