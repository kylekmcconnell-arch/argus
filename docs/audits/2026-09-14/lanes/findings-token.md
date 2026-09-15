# Token scoring / threat scan / on-chain forensics lane — findings

Checkout: `/Users/kyle/Documents/ARGUS/.claude/worktrees/review-main` @ 042a271. All line refs are on this checkout.

Bundle sync: `node scripts/build-collector.mjs` regenerated `api/_collector.js` and `api/_sweep.js` with zero diff against the committed files (`git status --short api/` empty), so `api/_sweep.js` is in sync with `server/sweep.ts`. Nothing needed restoring.

Probe tests: four throwaway `*.probe-token.test.ts` files were written, run (8/8 reproduced), and deleted; my files are gone from the worktree (other lanes' `*.probe-*.test.ts` files are still present and are not mine). Findings marked **repro: yes** were confirmed by those probes with the exact inputs described.

Skipped as already known: F01–F17 (2026-09-09 review), the open issues list, and the PR 410/412 items (DexScreener overflow cap, incomplete swap counts, GoPlus pause flag with 0x0 owner, LP list mostly token contract, Arkham 429/401 cost tags, Helius JSON-RPC error rows).

---

## P1

### 1. `judge()` ignores the audit's OFAC sanctions verdict: a sanctioned deployer scans SAFE in the threat lane
- **Files:** `src/threat/scan.ts:253-264` (`capped()` only consulted for `"honeypot_confirmed"`; `confirmedBad("honeypot")` is the only findings-tone read), `scan.ts:578-588` (verdict), `scan.ts:604-716` (`buildChecks` has no sanctions row), `scan.ts:199-205` (receipt records `call.verdict`); vs `src/token/audit.ts:1300-1316` where the audit forces `verdict="AVOID"`, `score<=5`, `capApplied="ofac_sanctioned_address"`.
- **Mechanism:** the threat judge re-derives risk from raw safety flags plus a whitelist of audit conclusions. The audit's hard AVOID for an SDN hit (and its `deployerRisk` severe Arkham paths, `cloneCheck.audited==="later"` ticker collision, and `documented_scanner_concealment` cap) are never read. `grep sanction|ofac|deployerRisk|cloneCheck src/threat` returns nothing outside comments.
- **Failure scenario:** deployer or a top holder is on the OFAC SDN list; contract is otherwise clean. `auditToken` → AVOID/5. `threatScan` → `judge` returns `{verdict:"SAFE", risk:0, action:"No mechanical red flags"}`, `buildChecks` shows every row pass, `recordReceipt` writes verdict SAFE to the shared ledger, `/api/threat-scan` caches SAFE for 1h, `scanWallet` counts the position as SAFE, and `deployerRep` for future tokens sees "none flagged". **Repro: yes** (dossier with `capApplied:"ofac_sanctioned_address"` + bad OFAC finding → `SAFE`, risk 0, positives include "Ownership renounced - no owner powers remain").
- **Fix:** in `judge()` treat `d.capApplied === "ofac_sanctioned_address"` (or `d.sanctionsScreen?.sanctioned.length`) as `trap=true` with its own flag line; add a `sanctions` row to `buildChecks`; also consume `d.deployerRisk` severe paths (add), `cloneCheck.audited==="later"` (flag), and `documented_scanner_concealment` (add). Generally: any audit cap ≤ AVOID must be a trap in the judge.
- **Confidence:** high.

### 2. OFT cross-chain liquidity is summed without a chain filter, multiplying the deepest pool once per peer
- **Files:** `src/threat/crosschain.ts:35` (`pickPair(await dexByToken(p.address), p.address)` — no `chainId === p.chain` filter), `crosschain.ts:41-49` (`totalLiquidityUsd` sums legs), consumed at `src/threat/scan.ts:505-520` (`effectiveLiq = max(liq, oftTotal)` gates every thin-liquidity read) and `scan.ts:509` (positive "~$X total liquidity across the mesh").
- **Mechanism:** LayerZero OFTs are routinely deployed at the same address on every chain. `dexByToken(address)` returns pairs from all chains; `pickPair` picks the deepest matching base token regardless of chain, so each peer leg resolves to the single deepest pool in the mesh.
- **Failure scenario:** token at one address on Ethereum ($500k), Base ($10k), Arbitrum ($5k); scan the Base token. Legs read 10k + 500k + 500k = **$1,010,000** (truth: $515k); the Arbitrum leg is reported as $500k. Thin/dust-liquidity warnings for the $10k Base pool are suppressed and the report asserts a fabricated mesh depth. **Repro: yes.**
- **Fix:** `pickPair((await dexByToken(p.address)).filter((x) => x.chainId === p.chain), p.address)` (as `src/threat/wallet.ts:92` already does); mark a leg `liquidityUsd:null` when no same-chain pair exists. Same pattern in `src/threat/launch.ts:265` (quote/dexId re-read across all chains).
- **Confidence:** high.

### 3. Known-rug-clone detector treats every factory-minted token as a clone of any flagged sibling (self-reinforcing +50)
- **Files:** `api/bytecode.ts:141-142` (fingerprint = sha256 of runtime code minus CBOR metadata), `src/threat/deepsources.ts:208-222` (`knownRugClones` matches on fingerprint only, any verdict RUG/DANGER), `src/threat/scan.ts:276-280` (`add(50)` "same trap redeployed"), `api/_ledger.js:162-166` (fingerprint query has no chain scope).
- **Mechanism:** tokens minted by a launchpad factory (Clanker `...b07`, Pons, four.meme, Doppler/Bankr, any OZ-template deployer) share byte-identical runtime code; only storage differs. The fingerprint is therefore a template id, not a contract id. DANGER is reachable at 40 points from ordinary signals (dev sold 20 + <24h 10 + thin liquidity 10), so once one template token in the org's ledger is DANGER, every later scan of the same template gets +50 → DANGER → itself becomes a match.
- **Failure scenario:** analyst scans Clanker token A (dev sold, thin, new) → DANGER, receipt stored with fingerprint F. Any subsequent Clanker token B (same F) → "Byte-identical to 1 token we already flagged ($A) - the same trap redeployed under a new name", +50, DANGER regardless of B's own evidence. Cascades org-wide.
- **Fix:** exclude fingerprints that the ledger already associates with ≥N distinct deployers/creators or with a known launchpad venue (`launch.venue != null` on either side); require the matched receipt's verdict to have come from a trap (honeypot/siphon) rather than soft points; or fingerprint over code+immutable constructor storage. At minimum downgrade to a warning when `launch.kind === "launchpad"`.
- **Confidence:** high on mechanism; the premise (factory templates share runtime bytecode) is standard EVM behaviour.

---

## P2

### 4. "Owner renounced" gates all owner-power vectors but ignores `hidden_owner` / `can_take_back_ownership` / missing `owner_address`
- **Files:** `src/token/audit.ts:458` (`ownerRenounced: !gp?.owner_address || /^0x0+$/...` — undefined reads as renounced), `audit.ts:868` (good finding lacks `!s.hiddenOwner`), `audit.ts:874-889` (`ownerActive = !s.ownerRenounced` suppresses balance-rewrite cap 20, tax-modifiable, blacklist, cooldown), `audit.ts:1118-1128` (T2 not docked), `src/threat/scan.ts:376-386` (`disarmed = s.ownerRenounced || established` downgrades high-severity code flags to soft), `scan.ts:359` (balance-rewrite +50 keyed on the suppressed audit finding), `scan.ts:574-575` (positive checks `!takeBack` but not `!hiddenOwner`).
- **Mechanism:** GoPlus reports `owner_address` as the visible (renounced) `0x0…0` while `hidden_owner="1"` or `can_take_back_ownership="1"` says the renounce is not effective; and omits `owner_address` entirely when it cannot detect one (the code anticipates this at line 442 but the findings block runs on `s.available`, not `contractPropertiesAssessed`).
- **Failure scenario A (repro: yes):** `hidden_owner=1, owner_address=0x0, owner_change_balance=1, is_blacklisted=1, slippage_modifiable=1`. Audit findings: "Hidden owner detected." **and** "good: Ownership renounced; no mint or take-back."; no balance-rewrite/blacklist/tax-modifiable findings; cap is `reclaimable_ownership` (35) not `owner_can_modify_balance` (20). Judge: positives "Ownership renounced - no owner powers remain" beside flag "HIDDEN OWNER"; the high-severity code flag is filed as "ownership renounced - the switch has no hand on it"; the +50 balance-edit flag never fires.
- **Failure scenario B (repro: yes):** `owner_address` absent, `owner_change_balance=1, is_blacklisted=1` → `contractPropertiesAssessed:false` yet the report publishes "good: Ownership renounced; no mint or take-back." and suppresses both vectors (null read as safe).
- **Fix:** `ownerRenounced = typeof owner_address === "string" && /^0x0+$/.test(owner_address) && !hiddenOwner && !takeBack`; add `ownerAssessed` and gate the line-868 positive and the judge's `disarmed`/line-574 positive on it; when owner is unmeasured, keep owner-power vectors as findings with an "unmeasured controller" note (as `server/adapters/tokenHolders.ts:341-351` already does).
- **Confidence:** high.

### 5. Threat-lane RugCheck parse sums overlapping insider networks (token lane explicitly forbids this)
- **Files:** `src/threat/deepsources.ts:36-38, 53` (`insidersDetected` = Σ size, `insiderPct` = Σ tokenAmount / supply) vs `src/token/sources.ts:616-630` and `api/holders.ts:44-47` ("Networks OVERLAP... adding them up invents supply that does not exist"; largest cluster only). Consumers: `src/threat/scan.ts:324-331` (`insiderPct >= 25 && !established` → **+25 flag**), `scan.ts:543` (`bundleProven`), `scan.ts:698` (holders check fail at ≥25).
- **Failure scenario (repro: yes):** two overlapping clusters of 40% each → threat lane `insiderPct=80`, `insidersDetected=40`; token lane on the same payload says 40%. A 20%-per-cluster token (below every threshold in the token lane) is reported at 40%, crosses the 25% "Insider network" flag, +25 risk, holders check FAIL. Also un-gated: `tokenAmount/supply` is not range-checked (>100% possible), unlike `supplySharePercent`.
- **Fix:** reuse `largestInsiderClusterPercent` / `supplySharePercent` from `src/token/sources.ts`; report `graphInsidersDetected` rather than Σ size.
- **Confidence:** high.

### 6. `auditToken` cache key omits `input.chain`; same EVM address on two chains returns the wrong chain's dossier for 60s
- **Files:** `src/token/audit.ts:581` (key = `${opts?.chain ?? ""}:${via}:${ref}:...`), `audit.ts:633` (resolution uses `opts?.chain ?? input.chain`). Callers that pass `input.chain` without `opts.chain`: `src/lib/scanrunner.ts:99`, `src/lib/investigation.ts:306`, `src/lib/runner.ts:112,176` (candidates built by `src/token/resolveSubject.ts:39` with `chain`).
- **Failure scenario (repro: yes):** ambiguous resolution lists the same `0x…` on Base and Ethereum; analyst scans Base, then Ethereum within 60s (or two tabs / runner retry) → the Ethereum run returns the Base dossier (chain "base", Base symbol, Base market and safety) and it is persisted under the Ethereum case.
- **Fix:** key on `opts?.chain ?? input.chain ?? ""`; better, key on the resolved `(chain, address)` after resolution and only cache successful dossiers.
- **Confidence:** high.

### 7. `/api/threat-scan` shared-report cache is keyed by address only (no chain)
- **Files:** `api/threat-scan.ts:26, 45-53, 63-67` (`ref: address`, `on_conflict=organization_id,ref,kind`, GET filters `ref=eq.address`), client `src/components/ThreatScanPage.tsx:1021, 1147` (GET with `address` only).
- **Failure scenario:** same EVM address on Base and Ethereum (CREATE2 / same-nonce deploys are common for both legitimate multichain tokens and scam clones). A scan of the Ethereum token overwrites the Base row; anyone opening the Base share link within 1h (same build) is served the Ethereum scan as a `hit` with the other chain's verdict. F04 fixed `_ledger.js`/`threat-recheck` identity but this route was not covered.
- **Fix:** `ref = assetKey(chain, address)` exactly as `_ledger.js:33`; client passes `chain`; refuse a hit whose `scan.chain` differs from the requested chain.
- **Confidence:** high.

### 8. Holder-concentration fallback publishes the excluded pool as the top holder when every wallet row is infrastructure
- **Files:** `src/token/audit.ts:1040-1042` (`concentrationTopPct = topWalletPct ?? s.topHolderPct`; `s.topHolderPct` is the raw provider row 0 from `audit.ts:422`), `audit.ts:1037-1038` (`holdersReliable` true because the empty EOA list sums to 0), `audit.ts:1147-1153` (T4 −8 at >50), `audit.ts:1375` (`safety.topHolderPct = concentrationTopPct` frozen into the dossier), `src/lib/scanChecklist.ts:336-343` (holder-distribution check becomes "finding" at >50), `src/lib/dimensionChapters.ts:158-159`.
- **Failure scenario (repro: yes):** GoPlus holders = pool 60% (`is_contract:1`, matches `pairAddress`) + staking contract 30%. Report says "Excluded from concentration: liquidity pool (60.0%). These are the market itself" and, in the same dossier, `safety.topHolderPct = 60`, T4 rationale "top holder 60%", T4 score 3/16, checklist "finding · top 60%".
- **Fix:** when `eoaHolders` is empty, keep `topPct = null` (unmeasured) and drop `?? s.topHolderPct`; only use `s.topHolderPct` when it came from the explorer path (and contract-filter that too).
- **Confidence:** high.

### 9. EVM creator/deployer attribution has no factory guard; launchpad factory contracts become "the deployer" and inherit ledger, sell-structure, OFAC and Arkham attribution
- **Files:** `src/token/audit.ts:762-770` (`creator_address` accepted verbatim with `kind:"deployer"`, no contract/program check; contrast the Solana path `api/resolve-deployer.ts:21-30` `NOT_A_DEV`), consumers `src/threat/scan.ts:210-220` (`sharedByDeployer` → `priorRugs` → +30 "rug factory pattern"), `scan.ts:110` (`sellStructure(..., dossier.deployer)` → `devSold`), `audit.ts:1272-1277` (OFAC + Arkham trace on it), `api/launch.ts:117-127, 160` (repo itself documents that the token's creator record for Pons is `PonsLaunchFactory`).
- **Failure scenario:** for a Pons/Clanker/four.meme token GoPlus' `creator_address` (or Blockscout's `contractCreator`) is the factory. Then: every other flagged token from that factory in the org ledger counts as this deployer's "prior rugs" (+30 flag on every launchpad token once one is DANGER); `devSold` measures whether the *factory* sold; Arkham/OFAC screens are run on a contract. Attribution-boundary invariant violated (a venue lends history to every token it minted).
- **Fix:** resolve `is_contract`/bytecode for `creator_address` (one `eth_getCode`, or Etherscan `getcontractcreation.contractFactory` vs `contractCreator`), and when it is a contract record `kind:"attributed"` with method "factory"; never feed a factory into `sharedByDeployer`/`sellStructure`.
- **Confidence:** medium (mechanism certain; whether GoPlus returns the factory or the EOA for a given launchpad was not verifiable offline — the repo's own Pons notes indicate the factory).

### 10. Helius "tokens created" counts any TOKEN_MINT transaction involving the wallet, not mints it signed
- **Files:** `api/deployer.ts:176-193` and `api/deployer-origin.ts:181-198` (`/v0/addresses/{wallet}/transactions?type=TOKEN_MINT|CREATE` → count distinct `tokenTransfers[].mint`; no `feePayer`/authority check), consumers `serialDeployer = created >= 5` (`deployer.ts:417-420`), `src/lib/investigation.ts:345` (tone "bad" on `serialDeployer`), `src/components/FindWallet.tsx:364` ("N+ tokens minted · serial").
- **Failure scenario:** a wallet that received five airdrops minted directly to it (or five launchpad `CREATE` txs it merely bought in) is labelled a serial minter/serial deployer with "bad" tone; the comment at `deployer.ts:410-416` claims the count is "launches this wallet minted itself", which the code does not check.
- **Fix:** require `t.feePayer === wallet` (or the mint authority in `t.instructions`) before counting.
- **Confidence:** medium (depends on Helius enhanced-API semantics: the address endpoint returns all transactions the address participates in).

### 11. EVM launch-block snipe read: supply = first mint transfer only, pool = max fan-out sender in the first 300 transfers
- **Files:** `api/launch.ts:41-54` (pool heuristic), `launch.ts:68-72` (`supply` from the first `from=0x0` row; `pctOfSupply = min(100, taken/supply)`), consumer `src/threat/scan.ts:465-472` (`pctOfSupply >= 20` → **+15 flag** "Launch-block snipe").
- **Failure scenario:** token mints 5% to treasury first, then 95% to the LP (two mint events) → `supply` = 5% tranche → any launch-block buys ≥1% of true supply read as ≥20% "of supply" → flag. Separately, a pre-pool airdrop from the deployer to N wallets makes the deployer the "pool" and the airdrop block the "launch block" → `sameBlockBuyers = N` → +15 "coordinated entry at t=0".
- **Fix:** sum all `from=0x0` transfers for supply (or call `totalSupply()`); identify the pool from the DexScreener `pairAddress` the dossier already holds instead of fan-out.
- **Confidence:** high.

---

## P3

### 12. Judge liquidity risk is non-monotone in liquidity
- `src/threat/scan.ts:517-518`: `effectiveLiq < 2500 → +10` is checked before `liqRatio < 0.05 && mcap ≥ 250k → +15`. **Repro: yes** — $2,400 depth under $10M cap scores 10; $2,600 scores 15. Fix: order the ratio branch first, or make dust = max(10, ratio points).

### 13. `cannot_sell_all` is documented "honeypot-class, never relaxed" but caps at 15 → FAIL, while the judge treats it as a RUG trap
- `src/token/audit.ts:817` vs `audit.ts:1228` (`ceiling <= 10 ? "AVOID"`) vs `src/threat/scan.ts:265`. The two lanes disagree on the same flag. Fix: cap at 10 or make the AVOID threshold `<= 15`.

### 14. Burned-supply percentage divides by post-burn `totalSupply`
- `api/burns.ts:57-63, 146-158`: burns via `burn()` emit Transfer→0x0 **and** reduce `totalSupply`, so `totalBurned / currentSupply` overstates (50% burned → reported 100%, clamped). Consumed as a positive in `src/threat/tokenomics.ts:223, 231` and `scan.ts:523`. Fix: divide by `supply + burnedTo0x0` (original supply) or use the pre-burn supply from the mint events.

### 15. `api/holders.ts:84` publishes RugCheck `lpLockedPct` raw (0 = unmeasured) while `src/token/sources.ts:572-578` explicitly documents that 0 is ambiguous
- Panel says "0% locked" for a mint RugCheck holds no market for. Fix: reuse `lockedShare(d.lpLockedPct, d.markets)`.

### 16. Arkham deployer-trace contract guard only excludes the token CA
- `src/token/audit.ts:1275-1277` skips the trace only when `deployer === address`; a factory/program deployer (see #9) is traced and OFAC-screened as if it were a wallet. Fix together with #9.

---

## Looked suspicious, turned out correct (no action)
- **Honeypot trap when OFAC overrides `capApplied`:** `capped("honeypot_confirmed")` is false but `s.honeypot && confirmedBad("honeypot")` still traps (`scan.ts:261`).
- **`tokenomics.ts:146-148` realHolderTopPct fallback** uses `safety.topHolderPct`, which `audit.ts:1375` already rewrote to the pool-excluded figure — consistent (modulo #8).
- **`api/arkham-token-holders.ts:51-54` `percent()` ≤1 → ×100 heuristic:** the fixture (`arkham-shaping.test.ts:19,32`) shows Arkham returns fractions, so the heuristic is consistent for that shape.
- **`_ledger.js:238` JSONB numeric comparisons** for `checkedAt`/`recheckAfter` are valid PostgREST; `ledgerDueReceipts` scoping and `withLedgerOrganization` enforcement are correct.
- **`api/evm-cluster.ts` funder/transfer union**, **`api/early-buyers.ts` truncated/unresolved handling**, **`api/deployer.ts` `walletAgeAtLaunch`** (negative span → null), **`api/nftlock.ts`** Mint-data slicing (`amount` at word 2) and `ownerOf` revert handling, **`api/evm-launch-buyers.ts`** BigInt arithmetic — all read correctly.
- **`src/token/sources.ts` LP percent range gates** (`>100` dropped) and **`supplySharePercent`** correctly refuse out-of-range payloads.
- **`server/adapters/tokenHolders.ts:341-351`** handles the missing-owner case correctly (it is the model for fix #4).
- **`src/threat/receipts.ts` / `assetIdentity`** case handling is chain-aware (F06 appears fixed on main).
- **`server/adapters/operatorLaunches.ts` peak gating / ordinal logic** — reviewed lightly per instructions; nothing new beyond the Sep 11 review.
- **`api/threat-recheck.ts`** now uses `marketObservation` (F05 fixed on main); `_ledger.js` uses `assetKey` (F04 fixed for ledger/recheck, but not for `api/threat-scan.ts`, see #7).
