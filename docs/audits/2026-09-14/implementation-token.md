# Threat lane parity: audit caps, per-chain liquidity, factory-aware attribution and honest owner state

Group D of the 2026-09-14 deep-dive review (`docs/audits/2026-09-14/deep-dive-review.md`, token lane findings 1-16). Branch `fix/token-threat-parity-2026-09-14` from `origin/main` at `042a271`.

Every regression test below fails on `042a271` and passes on this branch. No migration. No new dependency. `api/_collector.js` and `api/_sweep.js` were regenerated from source (`node scripts/build-collector.mjs`) because the collector bundles `src/token/audit.ts`.

## Shared-flag treatment (finding 13, the one product decision in this group)

`cannot_sell_all` is honeypot-class in both lanes. The token audit now caps it at the AVOID line (ceiling 10, so verdict AVOID), matching the threat judge, which already treated it as a RUG trap. `src/lib/decisionBoundary.ts` carries the same ceiling. The alternative (moving the AVOID threshold to 15) would have widened AVOID to every cap at 15, which nothing else uses; lowering the one cap keeps the AVOID line where it was.

The general rule now enforced in the judge (finding 1): any audit cap that forces AVOID is a trap in the threat lane (RUG at 100), and any cap below PASS is at least a flag. The judge no longer whitelists `honeypot_confirmed` alone.

## P1

### 1. Judge honours every audit cap
- `src/threat/scan.ts` (`judge`): new "audit's own verdict caps" block. OFAC hit (`capApplied === "ofac_sanctioned_address"` or `sanctionsScreen.sanctioned.length > 0`) is a trap with its own flag line; any other `verdict === "AVOID"` is a trap (future caps can never be silently dropped); `documented_scanner_concealment` adds 20 and flags the source quote; `cloneCheck.audited === "later"` adds 25 and flags the collision; severe Arkham paths (`SEVERE_RISK_CATEGORY`, now exported from `src/token/audit.ts`) add 30 and flag, soft paths warn.
- `buildChecks` (now exported for tests): new `sanctions` row (fail / pass / na with the unscreenable and unavailable reasons spelled out); `authenticity` fails on a later-minted collision; `code` fails on documented concealment; `deployer` fails on a severe funding path and explains a factory creator.
- Test: `src/threat/scan.auditCaps.test.ts` ("finding 1" blocks).

### 2. OFT cross-chain liquidity summed per chain
- `src/threat/crosschain.ts`: each peer leg resolves only pairs whose `chainId` equals the peer chain; a peer with no same-chain pool stays `liquidityUsd: null`. `src/threat/launch.ts` applies the same filter to its quote/dexId re-read.
- Test: `src/threat/crosschain.test.ts` ($515K mesh, not $1.01M; Optimism leg unresolved).

### 3. Known-rug-clone detector is template-aware
- `src/threat/scan.ts`: a fingerprint match is +50 only when the matched receipt is a confirmed trap (`RUG`) and this token is not a launchpad mint (`launch.kind !== "launchpad"`). A prior `DANGER` (market conduct) or any match on a launchpad template is a warning with no points; the emit tone follows. `knownRugClones` still returns both verdicts so the judge can explain the match.
- Test: `src/threat/scan.auditCaps.test.ts` ("finding 3").

## P2

### 4. Honest owner state
- `src/token/audit.ts` `evmSafety`: new `ownerAssessed` (GoPlus reported `owner_address` as a string); `ownerRenounced` requires a measured owner that is `0x0`/empty AND no `hidden_owner` AND no `can_take_back_ownership`. Solana sets `ownerAssessed` from the mint/freeze statuses. The "Ownership renounced; no mint or take-back" positive is gated on `ownerAssessed` and `!hiddenOwner`; `ownerActive` is true for hidden/take-back/unmeasured owners and the owner-power findings carry an "owner could not be identified, so this control is treated as live" note when unmeasured.
- `src/threat/scan.ts`: `disarmed` requires a renounce no hidden owner or take-back survives; the "no owner powers remain" positive checks `ownerAssessed` and `!hiddenOwner`; the `owner` check row is `na` with an explanation when the owner is unmeasured.
- `NormalizedSafety.ownerAssessed?` added (optional, frozen reports read as unmeasured).
- Tests: `src/token/audit.tokenParity.test.ts` ("finding 4", scenarios A and B from the lane plus take-back and the genuine renounce), `src/threat/scan.auditCaps.test.ts` ("finding 4").

### 5. Threat-lane RugCheck insider math
- `src/threat/deepsources.ts`: `insiderPct` is the largest cluster via `largestInsiderClusterPercent` / `supplySharePercent` from `src/token/sources.ts` (range-checked); `insidersDetected` is `graphInsidersDetected`, falling back to the largest cluster's size.
- Test: `src/threat/rugcheckInsiders.test.ts`. The existing `deepsources.test.ts` fixture (one cluster, no graph count) still passes.

### 6. `auditToken` cache key includes the requested chain
- `src/token/audit.ts`: key uses `opts?.chain ?? input.chain ?? ""`, the same expression resolution uses.
- Test: `src/token/audit.tokenParity.test.ts` ("finding 6").

### 7. `/api/threat-scan` keyed by chain:address
- `api/threat-scan.ts`: `ref = assetKey(chain, address)` (same shape as `_ledger.js`); POST requires `scan.chain`; GET requires `chain` (a lookup without it is a miss, never a guess) and refuses a hit whose stored `scan.chain` differs.
- `src/components/ThreatScanPage.tsx` (client group file, two-line edit): both GETs pass `chain`.
- Test: `api/threat-scan.test.ts`.

### 8. Excluded pool no longer republished as the top holder
- `src/token/audit.ts`: `concentrationTopPct = topWalletPct` (null when every row is infrastructure); the `?? s.topHolderPct` fallback that re-read the raw provider row 0 is gone. `src/lib/scanChecklist.ts`: the older-dossier fallback skips contract rows.
- Test: `src/token/audit.tokenParity.test.ts` ("finding 8": `safety.topHolderPct` null, T4 rationale without "top holder", checklist not "finding").

### 9 and 16. Factory-aware EVM creator attribution
- `src/token/audit.ts`: `resolveEvmCreatorKind` asks `/api/bytecode` (one `eth_getCode`) whether GoPlus's `creator_address` is a contract; a contract creator is recorded as `{ kind: "attributed", method: "contract factory" }` (`FACTORY_ATTRIBUTION_METHOD`) with a trace step. New `deployerWalletAddress(dossier)` returns null for a factory. The Arkham trace is skipped for a factory (16); OFAC still screens it (a sanctioned contract is still exposure, the Tornado Cash precedent).
- `src/threat/scan.ts`: `deployerRep`, `sellStructure` and the receipt's `deployer` use `deployerWalletAddress`, so a factory never inherits ledger history, a dev-sold read, or indexes the ledger.
- Limitation: the route only resolves in a browser (same pattern as `resolveDeployerViaRoute`); server/Node audits keep the provider attribution as recorded.
- Test: `src/token/audit.tokenParity.test.ts` ("findings 9 and 16").

### 10. Helius "tokens created" counts only mints the wallet paid for
- `api/deployer.ts`, `api/deployer-origin.ts`: `t.feePayer === wallet` gate.
- Tests: new case in `api/deployer.test.ts` (five airdrops + one bought-into CREATE count as 0); fixtures in both suites now carry `feePayer` (changed because they encoded the buggy count).

### 11. EVM launch-block snipe read
- `api/launch.ts` (`evmSnipe`, exported for tests): supply is the sum of every `from=0x0` transfer; the pool is the `pair` query parameter when the caller knows it, the fan-out heuristic only otherwise. `src/threat/launch.ts` passes `dossier.pairAddress`.
- Test: `api/launch.snipe.test.ts`.

## P3

### 12. Liquidity risk monotone
- `src/threat/scan.ts`: a dust pool that is also a paper-value trap scores 15, not 10.
- Test: `src/threat/scan.auditCaps.test.ts` ("finding 12").

### 13. See "Shared-flag treatment" above. Test: `src/token/audit.tokenParity.test.ts` ("finding 13"); `src/lib/decisionBoundary.test.ts` updated (it encoded the 15 ceiling).

### 14. Burned share measured against the original supply
- `api/burns.ts`: events carry their burn address; `originalSupply = totalSupply() + burnedTo0x0`.
- Test: `api/burns.test.ts`.

### 15. RugCheck `lpLockedPct` zero is unmeasured
- `api/holders.ts`: `lockedShare(d.lpLockedPct, d.markets)`.
- Test: `api/holders.test.ts`.

## Skipped or narrowed

- Finding 3, ledger side: `api/_ledger.js` (fingerprint query without chain scope) was not changed; the template guard in the judge removes the cascade without touching the shared ledger helper, which the API group owns.
- Finding 6, "only cache successful dossiers": not changed. Null results are still cached for 60s; the existing "does not cache a DEX outage" test covers the outage case and a null-for-not-found cache is the intended fast path.
- Finding 9: OFAC screening still includes a factory creator (deliberate, see above).

## Files changed

`src/threat/scan.ts`, `src/threat/crosschain.ts`, `src/threat/deepsources.ts`, `src/threat/launch.ts`, `src/token/audit.ts`, `src/lib/scanChecklist.ts`, `src/lib/decisionBoundary.ts`, `src/components/ThreatScanPage.tsx` (2 lines), `api/threat-scan.ts`, `api/launch.ts`, `api/burns.ts`, `api/holders.ts`, `api/deployer.ts`, `api/deployer-origin.ts`, `api/_collector.js`, `api/_sweep.js` (regenerated); tests as listed.
