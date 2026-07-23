# Codex review brief: the uniswap-final workstream

**What this is.** A complete map of ~45 commits shipped to `main` between `b0e093f` and `0b7d7dc` (Jul 22-23, 2026), written by the other agent on this repo for YOUR adversarial second look. Everything here is live in prod. Read [architecture.json](architecture.json) first as always; this brief adds the why, the owner decisions you must not "fix", and an honest list of the places most worth attacking.

**How to review.** `git log b0e093f..0b7d7dc --oneline` is the exact range. Every claim below names its commit and files. Section 7 is the ranked "attack here first" list. Owner decisions (section 6) are settled with Kyle; challenge them with him, not with a reverting PR.

**Warning for your checkout.** Your working tree (`codex/investigation-canvas-ux`) has uncommitted edits to `server/basicFacts.ts`, `server/agent.ts`, `server/orchestrate.ts`, `server/config.ts`. This workstream changed all four heavily. Expect real conflicts; the invariants in section 6 must survive your resolution.

---

## 1. Scoring engine and verdict integrity

- **Public-record identity is Confirmed** (`47124f8`, [orchestrate.ts](../server/orchestrate.ts) `projectVerifiedBasicFacts`): a founder/executive fact verified across >=2 independent registrable domains (excluding `official_subject`) sets `identity_confidence = "Confirmed"`. `SuspectedImpersonation` still overrides.
- **Audit self-attestation arms the exceptional CEILING only** (`ffa4a65`, `7befc06`, `484e2cb`, [securityAudits.ts](../server/adapters/securityAudits.ts), [agent.ts](../server/agent.ts)): >=2 registry auditors found on the subject's own pages (unioned across <=4 candidate pages, plus URL-level attestation from DeFiLlama audit links without fetching PDF bodies) raises the P3/P6 band ceiling and mints a citable `floorEligible:false` fact. Floors still require corroboration on the auditor's own domain. H2 (no floors from soft evidence) is intact; verify that.
- **Top-of-band anchoring** (`dfb574e`, analyst system prompt + PROJECT_SCORING_POLICY): skepticism gates what counts as verified, but verified evidence is not discounted; overwhelming verification scores at the top of the justified band. This is a prompt change; its effect is bounded by the deterministic bands.
- **Band reasons can never be empty** (`0d49587`, [agent.ts](../server/agent.ts) `setBand` + P4): the persist boundary rejects a non-none band with empty `reasons` (strictStringArray min 1, no dups, 240-char items). The P4 investor-only path shipped exactly that and killed two immutable saves. `setBand` now dedupes, caps, and falls back to a generic reason. Regression tests in agent.test.ts ("project band reasons contract").
- **Budget model** ([investigationRuntime.ts](../src/lib/investigationRuntime.ts)): 600s ceiling, ANALYST_SCORING 180s, FINALIZATION_RESERVE 90s, COLLECTION_ANALYST_RESERVE 250s, TRUST_GRAPH_SCREEN_RESERVE 60s (`96478a7` widened it to stop blue-chip FINAL/PROVISIONAL flapping). Invariant `250-60>=180` is test-locked.

## 2. Evidence pipeline and knowledge base

- **providerProjection facts never round-trip the KB** (`066a651`, [basicFactsProjection.ts](../server/basicFactsProjection.ts), [basicFacts.ts](../server/adapters/basicFacts.ts) `loadReusableBasicFacts`, [orchestrate.ts](../server/orchestrate.ts) write-back): deterministic market/TVL/fee captures are regenerated free every run; storing and re-injecting them compounded a new "captured ..." copy per scan (the run-on paragraphs Kyle saw). Marked `providerProjection: true`; legacy polluted rows are caught by signature (captured-qualifier, liveness sentence). **Trap we hit: discovery-verified facts ALSO carry `evidence_origin: "deterministic"`; filtering on that field kills KB reuse entirely.** The marker exists precisely for this.
- **Monid management merges into webTeam as verified rows** (`d33487e`, `mergeManagementIntoWebTeam` in orchestrate.ts): the paid enrichment's leadership profiles were collected and dropped; now they join the roster at the same trust level as the funding facts from the same resolved company. Name-keyed company resolution is the identity-risk surface here.
- **Identity-link promotion in the team merge** (`066a651` + `d7c2fef`): a handle the deterministic record itself asserts (official account's role post, fetched team page) promotes `identity_link_evidence_origin`; and a grounded member is a verify-candidate ONLY when the identity link is model_lead (model-found projects alone no longer duplicate a bound founder into the candidates lane).
- **Prior outcome stamped structurally** (`d37d1f8`): finalize writes `dossier.priorOutcome` {version, score, verdict, completeness, capturedAt, delta} alongside the existing provider-ledger row.

## 3. The cost stack (all live in prod, verify at /api/health)

`/api/health` now reports `models: {analyst, discovery, discoveryRoute}`, `extraction`, `knowledgeBase.reuse`. Current prod: Sonnet 5 analyst (intro pricing), Haiku 4.5 discovery model, `discoveryRoute: grounded`.

- **Prompt caching** (`a282b0d`, [agent.ts](../server/agent.ts) `structuredClaude`, [basicFacts.ts](../server/adapters/basicFacts.ts) `claudeRequestBody`): cache_control on the analyst system+user blocks and on the discovery prompt + resent search rounds (only block types in `CACHEABLE_BLOCK_TYPES`; an exotic block must never 400 a batch). [cost.ts](../server/cost.ts) prices cache writes 1.25x and reads 0.1x so the ledger tracks the invoice.
- **Grounded discovery lane** (`0b1f083`, `discoverGroundedBasicFactLeadsDetailed`): `ARGUS_BASIC_FACTS_PRIMARY=grounded` routes primary discovery through Serper + page fetch + cheap extract with the SAME `discoveryPrompt` and `parseBasicFactLeads`; verification boundary unchanged. Unprovisioned falls through to the normal chain. A/B-validated against frozen ground truth before the prod flip (section 5).
- **NO SILENT FALLBACKS, owner policy** (`1be474f`, [config.ts](../server/config.ts) `providerFallbacksEnabled`, default OFF): failure-driven failovers (analyst claude->grok, discovery claude->grok, the generalWebSearch cascade past the first provisioned provider) require `ARGUS_PROVIDER_FALLBACKS=on`. With no Anthropic key at all, Grok is the configured primary, not a fallback. Finalize stamps `dossier.providerFailures` from the cost ledger, emits a tone-bad step, and [ScoreContext.tsx](../src/components/ScoreContext.tsx) `ProviderFailureNotice` renders the alert. Origin: a credit-dead local key silently rerouted a whole run onto per-source Grok billing.

## 4. Eval harness (record once, replay forever)

[server/evalHarness.ts](../server/evalHarness.ts) + [scripts/eval-harness.ts](../scripts/eval-harness.ts) (`0b1f083`..`0b7d7dc`):

- `npm run eval:record -- @handle`: ONE paid live audit with global fetch teed to `eval/recordings/<slug>/calls.jsonl`. Request headers are never stored; sensitive query params redacted; volatile values (ISO timestamps, epoch ms, uuids, report ids) scrubbed from match keys only.
- `npm run eval:replay -- @handle`: identical full pipeline offline. Matching: exact (method+url+body hash) -> live lane (changed request to an allow-live host) -> url-tier fallback -> loud miss. **Ordering matters and was a real bug** (`fe0cfcc`): serving a recorded verdict for a changed analyst packet fakes INCOMPLETE.
- Record preflights the Anthropic key with a free count_tokens call (`6a9f4cc`).
- Local runs default to 2x the prod ceiling (`59620e8`, `ARGUS_EVAL_BUDGET_SECONDS`): local collection is 1.5-2x slower than Vercel; the prod formula starved the analyst at -750ms.
- [eval/expectations.json](../eval/expectations.json) carries product judgments (verdict band, min facts, expectedRole, mustSurface/mustNotAppear regexes) for uniswap, vitalikbuterin, aave, a16zcrypto, stablekwon (adverse; check handle status before recording). The older `eval/harness.ts` scaffold was consolidated away (`0b7d7dc`).

## 5. Validated results you can re-verify for free

- Baseline: uniswap recorded (203 calls, $3.62, score 75 PASS, 15 verified facts). Replay: 16.6s, $0, score 75->75, facts 15->15.
- Grounded A/B (`--allow-live=*`, `ARGUS_BASIC_FACTS_PRIMARY=grounded`): score 76 PASS, 15/15 facts recalled. This justified the prod flip.
- Full gates on every push: `npm run typecheck` (never bare tsc), full vitest (1934), `npm run build` (regenerates api/_collector.js; API routes import the BUNDLE), `npm run calibrate` 19/19.

## 6. Owner decisions: do not "fix" these

1. No silent provider fallbacks (default). Visible failure beats surprise spend.
2. Provider failures render on-screen (live stream + report alert).
3. Deploy prod ONLY by pushing to main. Never `vercel --prod`.
4. No em/en dashes in authored copy (uiCopyPolicy gate; grep added diff lines before pushing).
5. `resolved_name` is never set from an inferred name.
6. Sanctions/legal are screened live every run, never KB-cached.
7. H2: score floors only from strict verified facts; recall/attestation/press are ceiling-only.
8. Blue-chip 75-84 is the accepted calibrated range for Uniswap-class subjects (relaxing exceptional-tier predicates was considered and deferred).
9. `src/auth.tsx` in Kyle's main checkout is a local stub; never commit it.
10. Live audits cost real money; one validation run per deploy, ask before batteries.

## 7. Attack here first (ranked, honest)

1. **Analyst score variance**: identical evidence scored 74-79 across four runs pre-caching. The replay harness now makes this measurable; nobody has yet root-caused it (tasks #38/#39). The since-last-scan chips make every wobble user-visible, raising the stakes.
2. **Replay's 64 misses**: baseline replay has 64 replay-miss throws absorbed by pipeline resilience without changing the outcome. Nobody has audited WHICH paths those are. If any is evidence-bearing, replay fidelity is overstated.
3. **Single-subject A/B**: grounded discovery was validated on Uniswap only, the best-documented subject in crypto. Vitalik/aave/a16z recordings are seeded but not recorded. The prod flip is live ahead of that battery.
4. **Capture-dedupe shape collapse** ([BasicFactsPanel.tsx](../src/components/BasicFactsPanel.tsx) `dedupeCaptureValues`): fragments identical after stripping digits collapse to the latest. Bounded to 5 predicates, but a legitimate "raised $11M, raised $165M" style pair would wrongly collapse. Look for a real-world counterexample.
5. **generalWebSearch strict mode** (`1be474f`, [x.ts](../server/adapters/x.ts)): the first provisioned provider owns the lane; a legitimately-empty grounded result no longer cascades to Claude. That trades recall for cost by design; quantify the recall cost if you can.
6. **Monid roster trust level** (`d33487e`): management rows enter as artifact_verified deterministic on a name-keyed company match. Consistent with how the same record's funding facts are treated, but a namesake company would inject a fake roster with a verified badge.
7. **url-tier fallback semantics** (evalHarness): serving the next unconsumed same-URL recording for a changed body is what keeps replays alive across prompt tweaks, and also the mechanism that poisoned the first A/B. The live-allow reorder fixed the known case; look for others (e.g. changed KB writes).
8. **Client-side capture healing vs server truth**: polluted frozen reports render clean via client dedupe, but their payloads still contain duplicates. Anything else that consumes payloads raw (exports, ask-report context, v1 API) still sees the pollution.
9. **Eval budget divergence**: recordings run at 2x prod ceiling, so ground truth captures MORE evidence than a prod run would. Drift direction is "recording richer than prod", which flatters replay-based recall checks.
10. **Prompt-caching block decoration**: `CACHEABLE_BLOCK_TYPES` guards against 400s, but confirm no provider path sends assistant blocks whose last element mutates between pause_turn rounds (a stale cache_control on a re-sent block is harmless per docs; verify).

## 8. Report UI changes (verify visually on the saved Uniswap/AAVE reports)

Stat-grid fact cards with latest-capture dedupe, funding rounds list with relative amount bars, capital footprint panel (frozen 180d TVL trend series via `ProtocolTvlSnapshot.trend`, per-chain bar, 30d fees, holder-concentration split), hero since-last-scan delta chips, score sparkline + peer context + copy-tldr minting a 30-day share link (person AND token surfaces), fundamentals band that never renders a lone grey tile, team candidates with human provider labels, provider-failure alert. All in `7fe489c`..`7c68ed8` + `d7c2fef`.
