# Review: `codex/investigation-canvas-ux` @ 3e650aa — pre-merge punch list

Reviewed 2026-07-13 against `origin/main` (3af0c73). Method: full quality gates run in an
isolated worktree, 5-area code review, 12 adversarial verifications of every claimed
regression, and live QA of the canvas + report flows in both themes (fixture collector).

## Gates (all green)
`npm run build` ✓ · `npm run typecheck` ✓ · `npm test` 1438/1438 ✓ · `npm run truth:check` ✓ ·
`npm run canary:offline` 6/6 ✓ (0 unexpected provider URLs).
Note: with the stray `node_modules 2/` Finder-duplicate present, vitest reports 23 phantom
suite failures (vendored zod tests). Fix at the root: add a `node_modules*` exclusion to
vitest discovery and delete the `* 2` duplicates.

## Overall verdict
Strongest branch so far — the evidence-correctness arc is real (leads-until-fetched basic
facts, attribution scopes, atomic persistence bundle, blocked-fetch ≠ dead product,
identity-verified project tokens, placeholder-entity cleanup) and the canvas UX is a genuine
upgrade. **Two confirmed HIGH regressions should block merge**; both are cheap to fix.

---

## HIGH — fix before merge

### H1 · Decision-readiness gate silently hollowed out
`completeness` and `deriveDecisionReadiness` now count only `decisionCritical` checks
(`server/checks.ts:256-261`, `src/lib/scanChecklist.ts:44-49`, `src/lib/decisionReadiness.ts:64`).
No role marks `ofac-sanctions-name`, `us-legal-history`, `identity-continuity`, or
`trust-graph-connections` as critical (`server/checks.ts:42-68` — `criticalFor` NONE for all).
Because `presentPublicReport` fail-closes off this exact state, a KOL/INVESTOR report can now
present a full PASS **clearance** with the OFAC screen never run. On main it presented
INCOMPLETE. The old gating tests were rewritten with flipped expectations rather than the
semantics being decided explicitly.

**Fix:** mark `ofac-sanctions-name` + `us-legal-history` (when a real name resolved) +
`trust-graph-connections` as `criticalFor` every person role — or floor readiness at a
non-ready state while they are unresolved. Add a regression test: a snapshot with completed
critical checks but an unresolved sanctions screen must NOT present as clearance. Restore
the original all-checks gating tests alongside the role-scoped ones.

### H2 · Unverified press headlines set score FLOORS
`deriveProjectStrengthBands` classifies any `kind:"press"` sourceArtifact by regex over
title + outlet (`server/agent.ts:1055` MATERIAL_RELATIONSHIP_PRESS, `:1221-1229`, `:1345+`)
and derives `minScore` floors the analyst cannot go below. Press artifacts are unfetched
Google News RSS headlines (`server/adapters/offchain.ts:157-168`) — never passage-verified.
This is the branch's own "search output is only a lead" sin, in the flattering direction.

**Fix:** floors (`minScore`) may derive only from `artifact_verified === true` records;
unverified evidence may set ceilings, never floors.

---

## MEDIUM

- **M1 · `api/audit.ts` activation skip broader than its contract.** JSDoc says "persist
  without publishing over a prior decision-bearing report" but `isDecisionlessIncomplete`
  skips activation unconditionally (`api/audit.ts:31-56`, `:121-141`) — including brand-new
  subjects, where the DB guard (`20260712212737:192-236`) would have activated correctly.
  Narrow to prior-report-exists, or delete and let the DB guard decide.
- **M2 · Broken migration + same-branch repair.** `20260713181834` ships PL/pgSQL 42702
  ambiguity; `20260713185911` repairs it. If no shared DB has applied the broken one, squash
  into one correct migration (check the migration ledger first).
- **M3 · Migration "contract" tests are static text assertions** (`api/provenance.test.ts`
  "static SQL assertions only") — they restate the SQL, they don't execute it. Wire
  `supabase/tests/report_activation_quality_guard.sql` into an executable CI gate.
- **M4 · DecisionBasis hides recorded gaps.** `investorQuestion()` nulls any gap matching a
  provider/api/artifact/lineage keyword blocklist and gap-artifact rendering was dropped
  (`src/components/DecisionBasis.tsx:74-100`, `:282-315`). Restore at least a count or a
  collapsible list; an investor should see that gaps exist even when they're "plumbing".
- **M5 · Euphemism drift.** "No support" → "Limited evidence", "Contested" → "Mixed
  evidence" (`DecisionBasis.tsx:14-19` vs `decisionBasis.ts:146-155`). `gap` means ZERO
  qualifying support — label it that way.
- **M6 · Self-contradictory readiness result.** `deriveDecisionReadiness` can return
  `status:'incomplete'` with title "Assessment is provisional" + provisional guidance
  (`src/lib/decisionReadiness.ts:101-108` vs `:144-150`); the UI renders both. Derive
  title/guidance from the computed status.
- **M7 · Dark-mode input focus affordance nulled.** `:root[data-theme="dark"] .field:focus
  { border-color: var(--color-control-line) }` (`index.css:426-428`) cancels the base
  signal shift two rules above — resting and focused borders are the same color. Delete the
  override or use a visibly different mix.
- **M8 · First-run path deleted.** The $PEPE/$SHIB/$UNI one-click samples were removed from
  the landing with nothing replacing them. Restore 2-3 sample subjects as
  `btn-chip tint-signal` chips under the form, or a "see a worked case" link.

## LOW

- INCOMPLETE hero verdict wears `text-unverifiable` purple (`Report.tsx` hero) — conflates
  "suspected impersonation" with "not enough evidence". Use a neutral/caution treatment.
- "THE ARGUS EDGE" block renders all-zero tiles on thin reports, undercutting its own copy.
  Gate it on nonzero verified facts.
- `ReconPage.tsx:381` still ships the banned string-alpha (`m.color + "66"` on a var()) —
  convert to `tint-var`/`--tint` and drop the rgba `glow` field from VERDICT_META.
- Nav labels ≠ page H1s: "Market signals" opens "Trending"; "Data sources" opens
  "Providers". Make them agree.
- DESIGN.md drift: §4 sidebar groups, §3 avatar fallback (`text-signal-lift`), and the new
  tokens (`signal-lift`/`on-signal`/`control-line`/`eye-pupil`) aren't documented. Reconcile
  in one commit.
- Dead code: `run.pct` still computed/stored in `runner.ts`/`scanrunner.ts` with no consumer
  after the AuditConsole rewrite.
- `decisionReadiness.test.ts:150` test name promises "preserving provider diagnostics" while
  asserting they're dropped (`providerUnavailable: 0`). Rename or surface a
  `supplementalUnavailable` count.
- Landing sets multi-sentence copy at 11px (INVESTIGATION_OUTPUTS details, subject-help) —
  off the DESIGN.md ramp for body copy on the flagship page; 12.5px reads better.
- `.landing-cta-signal` restyles btn-primary's disabled state only under dark theme —
  theme-asymmetric one-off in the global stylesheet.

## Reviewed and REFUTED (don't chase)
- "Token trading volume pollutes P5 protocol traction": false — `trading volume|volume`
  lives in `TOKEN_MARKET_ONLY_TRACTION` (the exclusion set, `server/agent.ts:1149`), not in
  `PROJECT_PROTOCOL_TRACTION`. The separation works as designed.

## Confirmed genuinely improved (no action)
Leads-until-fetched BasicFacts with passage verification · attribution scopes for
legal/sanctions · atomic `persist_report_version_bundle` · sitecheck access_blocked ≠ dead ·
project-token identity + price corroboration · placeholder-entity graph cleanup · founder
handle-adjacency binding · PROJECT dox-bonus double-count removed · narrative-contradiction
rejection · graphite token system + WCAG contrast tests · offline release canary.

---

## 2026-07-13 (round 2) — live prod audit of Stani Kulechov (@StaniKulechov) + AAVE

Ran both live in prod. The token/anti-ambiguity/console UX is genuinely strong. Two real defects, one now FIXED, two handed back:

### FIXED in PR #35 — "AAVE can never complete" (was: legit mega-projects return INCOMPLETE)
Root cause: the biggest projects sit behind **Cloudflare bot management**. ARGUS fetches sites with Node `fetch`, whose TLS fingerprint Cloudflare flags → it's served an anti-bot challenge, not the homepage. Reproduced against the live `checkSiteSubstance`:
```
aave.com  →  access_blocked · anti_bot  ("served an anti-bot challenge instead of its homepage")
```
`applySiteSubstanceOutcome` correctly records that as `unavailable` (neutral, not adverse — good), but `project-product-substance` / `project-traction-liveness` then had NO other completion path, so a Cloudflare-protected protocol returned INCOMPLETE forever.
Fix (server/basicFactsProjection.ts `projectProviderBackedBasicFacts`): mint traction + product-substance facts from the verified canonical token's HARD market/on-chain signals (CoinGecko rank, market cap, on-chain liquidity, volume). These can't be hallucinated and don't need the homepage. Product gated to the established tier (rank ≤3000 or ≥$10M cap). +2 regression tests, all gates green.

### (b) HANDED BACK — treat a Cloudflare/anti-bot block as a weak POSITIVE, not just a neutral gap
A parked or dead domain is not behind enterprise bot management. When `checkSiteSubstance` returns `access_blocked/anti_bot`, that itself is mild evidence the domain is a real, live, protected property. Consider a soft-positive contribution (not a completion on its own, but it should not read as "no live product surface" anywhere in the narrative). Optionally: fetch the homepage through a rendering/proxy path for the site-substance check so Cloudflare-protected sites can be positively verified.

### (c) HANDED BACK — founder real-world identity resolution is too strict (precision-over-recall)
The Stani audit found `@stanikulechov` from his posts but left identity "unresolved formal real-world identity" and surfaced no name — because the passage-level verifier couldn't independently fetch a page naming him. A basic search returns "Stani Kulechov, Founder & CEO of Aave" instantly. The leads-until-fetched bar (excellent for killing hallucinations) has over-corrected: the most famous, well-documented founders come back identity-unresolved. Recommend letting founder identity complete from the founder's own verified profile ("Founder & CEO @Aave") + the project team page naming them + corroborating press, rather than requiring one fetchable passage. This one trades precision for recall — worth a careful, tested pass (this is your engine's core call, so flagging rather than changing it).

Meta-note: (b) and (c) are the same theme — the verification pendulum swung from "believes too much" (old hallucination problem, now fixed) to "can't confirm the obvious." For a diligence tool, if AAVE/Uniswap/Stani can't clear, users lose trust. Worth a deliberate recall pass on the flagship-legit cases.

---

## 2026-07-13 (round 3) — HARDENED SPEC: web-corroboration recall (founder identity + non-token completion)

Designed under 3 adversarial reviewers (hallucination / H2-floor / soundness lenses). The concrete "legit token-projects can't complete" case is ALREADY FIXED by the market-liveness commit. This spec covers the remaining founder/person case (Stani: found @stanikulechov but "unresolved formal real-world identity"). It is a CORE-VERIFIER change — implement + LIVE-validate (re-run a founder audit on prod); it cannot be validated by unit tests alone.

### Root mechanism
`resolveBasicFactCandidates` (server/adapters/basicFacts.ts:2282) groups fetched candidates by EXACT `predicate::normalizedValue`, then requires `!official && independentHosts.size >= 2` (2306) to survive. Two articles both stating "Stani Kulechov, Aave founder" with slightly different normalized values land in different buckets, each with one host → both dropped. The strict single-passage gate (verifyBasicFactLead) is correct and stays; only the CROSS-SOURCE grouping is too rigid.

### The rule (additive; strict gate left byte-for-byte)
Run a SECOND pass over only the groups that returned []: re-group by `predicate::atomicAnchor`, apply story-dedup + hardened independence, and emit ONE fact per anchor when >=2 independent witnesses agree — status `corroborated`, `floorEligible:false`.

### Guardrails the reviewers proved are REQUIRED (do not ship without these)
1. **Independence by eTLD+1, not hostname** — markets.businessinsider.com and businessinsider.com are ONE witness. (Fixes an existing BYPASS in the strict gate too.)
2. **Exclude PR-wire + self-publishing hosts** from the witness count: prnewswire/globenewswire/businesswire/accesswire/einpresswire/prweb/newsfilecorp + medium/substack/mirror.xyz/wordpress/blogspot/dev.to/beehiiv. They may appear; they never COUNT toward N.
3. **Exclude self-hosts** — the subject's own profile/website scope is never one of the N independent witnesses (self-vouching). At least one witness must be non-self AND non-wire.
4. **Story-dedup** — collapse syndicated copies by content-hash / near-identical excerpt (add a real `publishedAt` + content fingerprint to BasicFactSource); do NOT dedup by model-supplied title alone.
5. **atomicAnchor is load-bearing and MUST be a unit-tested helper**: for official_identity/founder/current_role/executive = canonical org/name token-set; fold ROLE-SENIORITY in so "CEO/founder/chair" does NOT group with "advisor/investor/contributor" on the same org (else a minority "advisor" claim launders into "CEO"). Compute independence for the SPECIFIC emitted value, not the coarsened group.
6. **Bind subject→role per source** via the existing `passageBindsSubjectRole`/`governingClaimClause`, never mere token containment (`sourceMentionsSubject`) — blocks homonym / incidental-mention completion.
7. **Carve-outs preserved**: never emit for `public_security` (needs issuer/regulator); `legal_regulatory_event` only when `attributionScope==='direct_subject'` (never promote identity_unresolved); `official_token` unchanged.
8. **H2 preserved by ONE scoring edit**: add `&& fact.floorEligible !== false` to `verifiedFacts()` (server/agent.ts:1199-1202). Every floor tier derives from it, so recall facts are scoring-neutral (coverage/readiness improve, minScore never moves). Stamp `floorEligible:false` STRUCTURALLY at the single recall emission point (never per-call-site). Reconcile on `mergeProjectedFact` (basicFactsProjection.ts:316-332): a strict fact merging onto a recall fact re-enables flooring.
9. **Surface as "web-corroborated", not a strict "confirmed" green**, in the report.

### Test matrix (all required)
single non-self press host → NOT complete; self-profile only → NOT complete (nonSelf=0); two syndicated copies (same story) → ONE witness → NOT complete; two genuinely independent non-wire hosts binding the role → complete (floorEligible:false); public_security via press → still []; person legal event w/o identity binding → stays identity_unresolved; H2 positive+negative control (recall-only support leaves minScore at baseline; same fact WITHOUT the flag DOES floor); serialization round-trip (floorEligible survives buildScoringEvidencePacket → JSON.parse).

### Also fixed the same day (shipped)
- Market/on-chain liveness completion (projectProviderBackedBasicFacts) → Cloudflare-blocked established token-projects (AAVE) complete product+traction from CoinGecko rank / mcap / liquidity. Anti-bot block already treated as neutral, not "coming-soon" (that was old prod code).
