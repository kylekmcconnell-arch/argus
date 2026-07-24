# Cross-case report system audit

Date: 2026-07-24

Production target: `https://argus-one-flax.vercel.app`

## Scope

This pass tested saved and rendered reports across people, protocols, tokens, and investigations. The sample included Brian Armstrong, World, Pons, VVV, Uniswap, Aave, Stani Kulechov, Jupiter, gakonst, Drift, Anatoly Yakovenko, 0xsupergemma, and known negative controls.

## Health

1. Decision routing: healthy after regression coverage for established protocol and named-founder biographies.
2. Verdict integrity: healthy. Offline canaries and the full calibration set show no false passes, false avoids, unsafe conclusions, or identity misses.
3. Report truthfulness: improved. Empty founder summaries, token warnings without token candidates, non-applicable follow-ups, and duplicate conflict counts are now suppressed.
4. Navigation consistency: improved. Recent-case outcomes are reconciled against the active immutable report instead of a stale audit row.
5. Report layout: improved. The desktop sidebar keeps its full 248 pixel width while viewing a report.
6. Historical snapshots: improved. Upgrade notices now describe checks relevant to the subject type.

## Before

- `01-brian-top.png`: the person report displayed a token-identity warning even though the frozen evidence contained no token candidate.
- `02-brian-founder-pattern.png`: the report displayed `Unproven` and `none` from an empty structured summary even though the cited role evidence documented a major founder outcome.

## Strengths retained

- Frozen report versions remain immutable.
- Evidence lineage remains visible even when a non-applicable item is removed from the investor follow-up list.
- Legitimate abstention remains available for subjects whose decision-critical axes truly have no terminal evidence.
- Existing report typography, color system, card language, and navigation model remain unchanged.

## Remaining risks and limits

- Old model-written narrative remains frozen, even when later engine versions use stricter wording.
- This visual review used desktop production states. It did not include assistive-technology testing or a complete keyboard-only audit.
- The repository-wide lint command currently includes 258 pre-existing errors in legacy, generated, and unrelated files. Every file changed in this pass passes scoped lint.

## Validation

- Source-of-truth contract: passed
- Deterministic release canaries: 7 of 7
- Calibration cases: 19 of 19
- Test suite: 2,001 of 2,001
- TypeScript checks: passed
- Production build: passed
