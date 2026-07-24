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
7. Suspended project accounts: improved. A freshly fetched first-party site can recover the project identity only when it names the project and links the exact audited X account.
8. Canonical token identity: improved. Verified project names now feed the token lookup, while repeated press mentions remain leads until an official account, domain, counterparty, or on-chain record binds the asset.
9. Research-lead hygiene: improved. Project reports suppress generic namesakes, unbound social results, category errors, and market-cap text misclassified as financing, then collapse repeated metrics from one article into a single source-level lead.
10. Project null outcomes: improved. Completed team and disclosure searches now record terminal findings instead of leaving legitimate early projects permanently provisional, while operator identity remains separate from verified brand identity.
11. Analyst null-result semantics: improved. A completed search that found no verified operator no longer trips the named-team contradiction gate, and unverified team-search names are withheld in the live ledger.

## Before

- `01-brian-top.png`: the person report displayed a token-identity warning even though the frozen evidence contained no token candidate.
- `02-brian-founder-pattern.png`: the report displayed `Unproven` and `none` from an empty structured summary even though the cited role evidence documented a major founder outcome.

## After

- `03-brian-after.png`: the report hero no longer manufactures the empty founder-pattern or unrelated token warning.
- `05-brian-readiness-after.png`: readiness, coverage, score, and governing-role language share one clear visual hierarchy while the sidebar retains its full width.
- `06-world-followups-after.png`: the report keeps the highest-impact follow-ups concise and separates them from the full unresolved-question ledger.
- Fresh production scans verified Drift Protocol as a project, bound `$DRIFT` through the official X account and Solana contract, restored market and ATH visuals, and published `CAUTION 52` with complete decision coverage.
- Fresh production scan `PA-6507556704CC469FA570` publishes Pons v8 as decision-ready `CAUTION 42`, with 7 of 7 terminal checks, three verified facts, no canonical-token or named-operator claim, and six source-linked research leads. Unbound social, namesake, audit-null, and market-cap-as-funding rows are withheld.

## Pons token follow-up

The v8 result above exposed a false canonical-token null during user review.
Pons' official documentation names `$PONS` and publishes its Robinhood Chain
contract, while the identity-bound DexScreener record links the exact
`@ponsdotfamily` account and `ponsfamily.com` domain. The resolver had treated
CoinGecko as the complete token universe, so a new chain-native asset that was
not listed there could never reach the canonical token snapshot.

The corrected resolver now falls through from an empty or unbound CoinGecko
result to DexScreener, requires both the exact provider-frozen X account and
official domain, and freezes the contract, market, liquidity, volume, pool, and
GeckoTerminal price history when that dual binding succeeds. A completed
CoinGecko miss alone can no longer record a substantive "no token" outcome.
The immutable v8 report remains a historical artifact; a fresh production scan
is required to publish the corrected evidence.

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
- Test suite: 2,011 of 2,011
- TypeScript checks: passed
- Production build: passed
