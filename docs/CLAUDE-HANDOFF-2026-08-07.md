# ARGUS handoff to Claude

> **Historical document, superseded.** Kept for the product thesis and failure
> history, which still hold. Do not use it to judge what is built: several items
> it lists as open or unfinished have since shipped. For current state read
> `ARGUS-SOURCE-OF-TRUTH.md`, `DESIGN.md`, the tests, and GitHub history.

Date: 2026-08-07

Purpose: continue the current master revision without losing the product thesis, epistemic rules, confirmed implementation, failure history, or open work.

## 1. Read this first

ARGUS is a point-in-time due-diligence product for tokens, projects, people, investors, venture firms, operating companies, and related entities.

The intended experience is not a static scorecard. It should feel like a private investigator, research director, graph analyst, and senior investment analyst working over one coherent evidence base. A user should be able to inspect the report, explore the connection web, ask questions, challenge findings, submit rebuttals, and understand exactly what would change the conclusion.

The highest-severity defect in ARGUS is a sentence that a reader believes but that the evidence does not establish. A crash is usually less damaging than a polished false claim.

Before changing anything, read:

- `docs/CODEX-REVIEW-BRIEF.md`
- `docs/architecture.json`
- `docs/POINT-IN-TIME-INTELLIGENCE.md`
- `docs/ENTITY-POINT-IN-TIME-INTELLIGENCE.md`
- this file

Do not reset or clean the worktree. It contains a large, intentional, uncommitted body of work from this revision cycle.

## 2. Current repository state

Current committed base on `main` includes `7cf218e`, the review brief.

The working tree is very large and dirty:

- roughly 189 tracked files modified;
- more than 22,000 inserted lines and 3,800 deleted lines in the tracked diff;
- many new untracked implementation and test files;
- generated collector bundles were rebuilt;
- nothing from the latest intelligence work was committed, pushed, or deployed in this session.

Treat every unrelated-looking modification as user work unless proven otherwise. Do not use destructive Git commands. Do not assume the whole diff belongs to one atomic feature.

Latest verified gates:

- `npm run truth:check`: passed;
- `npm run canary:offline`: 7 of 7 fixtures matched, zero unexpected URLs;
- `npm run calibrate`: 20 of 20, zero false passes, false avoids, unsafe conclusions, or identity misses;
- `npm test`: 280 files and 3,190 tests passed;
- `npm run typecheck`: passed;
- `npm run build`: passed;
- `git diff --check`: passed.

The build still reports existing chunk-size and ineffective-dynamic-import warnings. They are warnings, not failures introduced by the intelligence work.

## 3. Product direction established with the user

The user wants:

- point-in-time diligence first, not primarily ongoing monitoring;
- useful output for investment decisions, alpha discovery, counterparty review, and broad diligence;
- an all-encompassing, surprising, high-value research product;
- a target standard-scan cost around $3, while accepting that the ideal evidence contract may need to be built before cost is fully optimized;
- a graph or web of people, entities, wallets, products, funding, control, and historical events;
- a floating Argus Eye assistant on the report, not a separate support section;
- conversation with the Eye to feel like talking to the report-wide reasoning brain;
- follow-up questions, challenges, rebuttals, connection tracing, and explanation of what would change the conclusion;
- significantly stronger people, VC, investor, fund, and company research, not only improved token scans;
- a brain that understands the research objective and delegates to the right specialist lane;
- truthful incompleteness instead of a confident but weak result.

The user repeatedly described the target as having a genius investigator sitting beside them who can connect everything, explain what matters, and identify valuable non-obvious details.

## 4. Failures that motivated this revision

These are product signals, not isolated screenshots.

### 4.1 People and entity reports were mechanically incomplete

Examples included Scott Rupp and TheForms VC reports that resolved a profile but produced an `INCOMPLETE` result with almost no usable facts. The report emphasized unavailable checks and scoring machinery instead of giving the reader a coherent answer.

Observed source failures included:

- Serper HTTP 400 rejections;
- Wayback transport failures;
- a provider failure being displayed more prominently than the usable evidence;
- too many static unanswered template questions;
- a report knowing the subject category but failing to construct the actual entity case.

### 4.2 Clutch Markets and STONKBROKER lacked entity coherence

The project account visibly identified a founder, but the report remained unsure or treated the attribution as speculative. A same-named unrelated company article was shown as a rejected conflict without explaining why it mattered. The report showed the STONKBROKER site while omitting the Clutch Markets site. Funding associated with another Clutch Markets entity could enter the research space.

The required boundary is:

- a project can establish its own published role attribution;
- that attribution does not independently establish civil identity, legal ownership, wallet control, or operational authority;
- a namesake in another industry must not bind to the audited subject;
- the UI should state the accepted bounded fact directly instead of sounding generically uncertain.

### 4.3 Bundle and launch-forensics evidence was missing or buried

The user expected a prominent bundle-detection surface similar to the reference screenshot. Token scans such as MUMU and ANSEM did not consistently surface launch clusters, linked early buyers, shared funding, same-block bursts, current holdings, sold share, or a clear statement of the evidence source and limitations.

The distinction matters:

- concentrated holders are not automatically a bundle;
- a provider's `bundler` field remains that provider's classification;
- an ARGUS-owned early-buyer trace can describe shared funders and transaction shape;
- neither should claim common control, coordination, or sniping without evidence;
- pools, exchanges, bridges, and relayers must be excluded or labeled correctly.

### 4.4 Argus Eye initially behaved like support chat

Failures included:

- an opaque `Conflict rejected` card;
- no useful answer to an investment-thesis question;
- `The model response could not be verified` without an actionable explanation;
- confusing language about a frozen report;
- the Eye looking like a separate destination rather than an assistant attached to the report;
- inability to explain which research lane should answer the question.

### 4.5 Static facts did not become a cohesive decision

The report often had facts, panels, or leads but did not tie them into:

- strongest support;
- sharpest concern;
- counter-thesis;
- decision-critical unknowns;
- exact next evidence;
- why a fact matters;
- what cannot be inferred from it.

### 4.6 Arkham became unavailable

The Arkham API trial expired. The user asked to turn off reliance on it for now.

Current direction:

- no required scan or conclusion should depend on Arkham;
- Arkham-backed panels should be capability-gated;
- missing Arkham access should not look like a degraded core report;
- graph and wallet work should use ARGUS-owned, keyless, or already configured sources where possible.

## 5. Epistemic rules that must not regress

These rules outrank UI polish and recall.

1. A failed search is not a negative finding.
2. A checked-empty bounded search is not proof that a fact does not exist.
3. A bounded count is not a universal total.
4. A provider's label or opinion remains attributed provider context.
5. A name, ticker, bio, display name, caller value, or profile image does not establish identity.
6. A project-published founder attribution is a real bounded fact, but not independent proof of the person behind the handle or of legal and wallet control.
7. Portfolio membership is not portfolio quality.
8. A fund investment is not automatically a personal investment by an employee or partner.
9. AUM, fund close, vehicle size, NAV, deployable capital, and personal wealth are different claims.
10. A holder concentration reading does not prove common ownership, bundling, or coordination.
11. A pool is the market, not a holder that can dump like an ordinary wallet.
12. A zero standard EVM proxy slot does not prove immutability.
13. A Safe-compatible method response does not prove the official controller or full execution policy.
14. A voting-power reading is not a token-holding reading.
15. A direct adverse finding cannot disappear because the user changes a decision lens.
16. A previous model answer is conversational context, never evidence.
17. Derived intelligence is score-neutral in schema version 1.

## 6. Major implementation now present in the worktree

This section describes the combined current worktree. Some of it predates the latest Codex session, and none of the uncommitted work should be attributed to a single author without checking Git history.

### 6.1 Point-in-time Intelligence Spine

Core files:

- `src/intelligence/types.ts`
- `src/intelligence/buildPointInTimeIntelligence.ts`
- `src/intelligence/buildEntityPointInTimeIntelligence.ts`
- `src/intelligence/archetypes.ts`
- `src/components/PointInTimeIntelligencePanel.tsx`

The saved snapshot separates:

- sources;
- measurements;
- questions;
- coverage;
- deterministic signals;
- arithmetic receipts;
- subject forms and archetypes;
- decision lenses;
- change conditions.

It has four lenses:

- investment;
- alpha research;
- counterparty;
- general diligence.

The lenses reorder and emphasize one invariant saved evidence set. They do not change the score or remove direct risks.

### 6.2 Entity intelligence contracts

People, individual investors, investment firms, operating companies, and agencies now have distinct evidence contracts and question packs.

Important files include:

- `docs/ENTITY-POINT-IN-TIME-INTELLIGENCE.md`
- `src/intelligence/buildEntityPointInTimeIntelligence.ts`
- `src/lib/investorSubject.ts`
- `src/lib/portfolioRelationshipBinding.ts`
- `src/lib/diligenceEvidenceBinding.ts`

The intended typed ledgers include subject binding, career and authority, contribution, investment events, outcomes, funds and vehicles, operating evidence, legal and adverse evidence, and conflicts.

### 6.3 Concise intelligence brief and coherent case synthesis

Core files:

- `src/lib/intelligenceBrief.ts`
- `src/components/Report.tsx`
- `src/components/InvestigationReport.tsx`
- `src/components/InvestigationDecisionCanvas.tsx`
- `src/components/InvestigatorBrief.tsx`

The short answer now promotes:

- strongest confirmed support;
- sharpest concern;
- what would change the conclusion;
- important neutral context;
- attempted and meaningful open questions.

Hard caps and direct contradictions outrank derived intelligence. If there is no confirmed support, the `Strongest evidence` line is omitted rather than invented. `not_collected` template questions stay in the deep map instead of flooding the concise report.

The short answer and deep intelligence atlas share a synchronized decision-lens selector. Changing the lens changes relevance and order, not the score or evidence.

### 6.4 Research director

Core files:

- `src/lib/researchDirector.ts`
- `src/components/ResearchPlanPanel.tsx`
- `server/orchestrate.ts`

The scan-time director maps resolved roles and decision intent into explicit workstreams such as:

- role and identity resolution;
- official facts;
- people and control;
- token and market;
- project fundamentals;
- portfolio and outcomes;
- fund scale;
- legal and adverse;
- network connections;
- counter-evidence;
- analyst synthesis.

Tasks have priority, cost class, decision impact, delegates, stop conditions, blockers, check IDs, and final outcome states. Identity-sensitive relationship searches can be blocked until the exact subject is resolved.

A provider call does not mark a task complete. Only the frozen check ledger can do that.

### 6.5 Question director and upgraded Argus Eye brain

Core files:

- `src/lib/questionDirector.ts`
- `api/ask.ts`
- `src/components/ArgusEyeAssistant.tsx`
- `api/ask.test.ts`
- `src/lib/questionDirector.test.ts`

For every Eye question, the deterministic director now identifies:

- primary intent: investment, alpha, counterparty, or identity and control;
- reasoning mode: answer, challenge thesis, trace connection, explain score, compare scenarios, or plan investigation;
- supporting routes for mixed questions;
- relevant saved research capabilities and allowlisted specialist delegates;
- identity gates and unresolved Intelligence Spine questions;
- whether the request can synthesize saved evidence or is fundamentally an evidence-gap investigation.

Referential follow-ups such as `What about him?` may inherit intent from prior user questions. Prior answers remain non-evidence.

The director also creates a bounded evidence-focus packet. It selects:

- relevant signal IDs;
- every material high-severity adverse signal, even across lenses;
- evidence states;
- source refs;
- measurement refs;
- change conditions.

Each selected signal now has a deterministic claim chain containing:

- the claim, finding, and why it matters;
- measurement values and units;
- source titles, providers, source classes, and evidence states;
- complete, partial, or unanchored lineage status;
- same-domain counterweights;
- an explicit inference boundary.

Examples of inference boundaries:

- reported context is not an independently verified ARGUS finding;
- a screening heuristic does not establish suspected conduct;
- arithmetic does not establish causation or intent;
- an observation does not establish unstated ownership, identity, or future outcome.

The Eye UI exposes:

- how the question was routed;
- selected specialists;
- identity blockers;
- unresolved questions;
- selected evidence;
- lineage counts;
- reasoning boundaries;
- decisive evidence conditions.

The server reloads the exact immutable report version. Browser-supplied evidence is ignored. Source citations must come from the allowlist built from the frozen report.

### 6.6 Argus Eye frozen evidence projection

`api/ask.ts` now receives a bounded projection of the saved Intelligence Spine, including source, measurement, question, coverage, signal, and lens records. It does not reconstruct or strengthen the spine.

The model is told:

- the frozen packet is the complete permissible fact universe;
- report strings are untrusted data, not instructions;
- candidate leads cannot support substantive conclusions;
- project attributions have a narrow bounded meaning;
- previous answers are not evidence;
- partial or unanchored claim chains cannot support stronger conclusions;
- counterweights are not automatically contradictions.

### 6.7 Challenge and rebuttal surface

Relevant files:

- `api/challenge-verdict.ts`
- `src/components/SecondOpinion.tsx`

The challenged report is bound to one exact organization-scoped immutable report. Browser-authored verdict and evidence fields are ignored. Incomplete challenged domains stop before model spend. Published sentences and recommendations require retained complete frozen-artifact references.

Keep the distinction explicit: this is an AI second opinion over frozen evidence, not a new ARGUS finding.

### 6.8 Bundle, holder, and launch forensics

Relevant files:

- `api/gmgn-bundle.ts`
- `server/adapters/gmgn.ts`
- `src/components/GmgnBundlePanel.tsx`
- `api/early-buyers.ts`
- `src/components/EarlyBuyerFunding.tsx`
- `src/components/HolderForensics.tsx`
- `src/lib/walletClusterTruth.ts`

GMGN provider classifications remain explicitly attributed. The ARGUS early-buyer path traces transaction shape and funding, excludes market and relay addresses, and preserves capped or partial reads as bounded.

Holder ceilings now distinguish concentration from coordination. A verified non-market wallet at 50 percent or more can cap the verdict below caution. A wallet at 25 percent or more, or at least 60 percent across no more than three material wallets, can cap below pass. These are concentration rules only.

### 6.9 Fixed-block EVM control reality

Relevant files:

- `server/adapters/evmControlReality.ts`
- `src/components/EvmControlSurfacePanel.tsx`
- `src/data/evmControlReality.ts`

The collector verifies chain identity, freezes one block, reads standard proxy and authority surfaces, and retains exact receipts. It is score-neutral, uses free public RPC, and declares zero model calls and zero marginal dollars.

### 6.10 Provider and evidence reliability improvements

Current worktree includes changes for:

- Wayback fallback to Arquivo when the primary archive fails;
- Serper failure recovery through an already-provisioned research path;
- strict company/domain binding for Monid and project funding;
- exact portfolio relationship binding shared across collection, graph, dossier, and intelligence;
- strict fund-scale semantics;
- security-audit corroboration that requires audit context and an identity anchor;
- governance binding that refuses name-only and token-strategy-only space matches;
- source-specific project-token lineage;
- provider failure states that remain unavailable or partial rather than negative;
- organization registration and sanctions never-waive checks;
- Arkham capability gating;
- direct-subject project-fact coherence checks;
- strict treatment of profile, licensed enrichment, and provider projections.

### 6.11 Report and connection-web improvements

Current worktree includes:

- graph bridges and network panels;
- source-bound team and leadership surfaces;
- financing and incident ledgers;
- project docs and web-surface checks;
- funder and wallet-cluster truth controls;
- source and methodology panels;
- decision-readiness and provisional-result copy;
- clear separation between saved report evidence and live supplemental checks.

## 7. What is not finished

This is the most important section for the next agent.

### 7.1 The Eye does not yet execute new research

The question director selects the right specialist lanes and explains the next investigation, but `/api/ask` remains intentionally frozen-report Q&A. It does not dispatch a new live search, mutate the saved report, or append evidence.

The next product-level step is a separately authorized `investigate this gap` flow that:

- lets the user approve a bounded follow-up;
- dispatches only allowlisted specialists selected by the director;
- applies a visible cost and time budget;
- stores candidate evidence separately from the immutable report;
- re-runs identity and lineage gates;
- requires explicit promotion into a new report version;
- never silently edits a frozen case.

Do not turn `/api/ask` into unrestricted web search. That would destroy the frozen-evidence contract and create prompt-injection, cost, and provenance problems.

### 7.2 The enhanced floating Eye is not uniform across all report types

The most complete floating Eye experience currently lives on the token or investigation report path. Standalone person, investor, VC, fund, and company reports still need the same report-wide assistant mounted against their exact immutable report version.

There is also an older `AskReport` surface. Avoid maintaining two divergent brains. Consolidate shared conversation state, response rendering, routing display, and report-version binding.

### 7.3 Conversation references need deterministic entity binding

Intent inheritance exists, but references such as `him`, `that fund`, `the second wallet`, or `their company` are still resolved by the language model using untrusted dialogue context.

A stronger next layer should create a bounded conversation referent register from saved graph node IDs and previously displayed report entities. It should:

- resolve a referent only to an entity already present in the frozen report;
- ask for clarification when multiple entities fit;
- never bind a pronoun to a new real-world identity;
- pass stable entity keys, not only names, into the reasoning layer.

### 7.4 Claim chains need graph paths

The current claim-chain layer resolves signals to measurements and sources. It does not yet compute the shortest verified entity and wallet path relevant to the question.

For trace mode, add a deterministic graph-path packet with:

- stable node keys;
- edge type and evidence state;
- source receipt for each edge;
- path length;
- rejected or unresolved alternative paths;
- a rule that namesake, candidate, and reported-only edges cannot silently become verified connections.

### 7.5 Counterweights are not full contradictions

The current director identifies same-domain opposite-polarity signals as counterweights. That is useful for thesis construction but does not prove those signals directly contradict each other.

A real contradiction object should identify:

- the exact propositions that cannot both be true;
- time and scope alignment;
- source independence;
- whether the conflict is unresolved, superseded, or merely different context;
- the artifact that would resolve it.

### 7.6 New scans need live evaluation on the reported failures

No paid scan was run during the latest intelligence-layer work. Deterministic tests and offline replay are green, but the user-facing failures should be re-run when explicitly authorized and budgeted:

- Clutch Markets or STONKBROKER;
- TheForms VC;
- Scott Rupp;
- MUMU;
- ANSEM;
- one known-good person;
- one known-good investment firm;
- one operating company;
- one token with verified launch bundling or shared early funding;
- one token with concentration but no verified bundle.

For every live check, compare the emitted evidence and report, not only source code.

### 7.7 Cost routing still needs measured optimization

Current target is about $3 per standard scan. Discovery historically dominates cost; the analyst is relatively inexpensive under the current route.

Do not swap the core analyst model solely on sticker price. Measure:

- decision lift;
- citation validity;
- abstention behavior;
- identity error rate;
- contradiction handling;
- latency;
- cost per completed decision-grade report.

Birdeye may add useful Solana market, holder, or trading data, but it does not replace exact launch-buyer funding traces, identity binding, or ARGUS-owned bundle reasoning. Add it only after mapping unique decision value against existing CoinGecko, DexScreener, GeckoTerminal, GoPlus, RugCheck, GMGN, Helius, and direct-chain lanes.

### 7.8 Old reports remain old

Older immutable reports without an Intelligence Spine or research plan are not reconstructed under the new ruleset. The Eye should explicitly route them as evidence-gap investigations when the saved planning context is absent.

## 8. Recommended next implementation order

1. Mount one shared Argus Eye brain on standalone entity reports.
2. Build the frozen conversation referent register.
3. Add deterministic graph-path packets for trace-connection mode.
4. Add proposition-level contradiction objects.
5. Design the explicitly authorized follow-up investigation workflow without mutating frozen reports.
6. Re-run the named failure cases under a controlled budget and inspect recordings.
7. Measure cost and decision lift before adding or replacing paid providers or models.

## 9. Verification expectations

Every meaningful change should pass:

```bash
npm run typecheck
npm run truth:check
npm run canary:offline
npm run calibrate
npm test
npm run build
git diff --check
```

The repository has an authored-copy rule against em dashes. Keep runtime and documentation copy compliant.

When a full test run times out under heavy parallel load, rerun the affected test in isolation and report both results. Do not hide the timeout.

## 10. Operating constraints

- Do not deploy through `vercel --prod`.
- Do not deploy or push without explicit user instruction.
- Do not run paid live scans without explicit cost authorization.
- Do not restore Arkham as a required dependency while access is inactive.
- Do not delete or reset the dirty worktree.
- Do not convert provider failures into clear results.
- Do not let a model-generated relationship route identity or scoring.
- Do not let the chat layer alter the immutable report.
- Do not trade truth boundaries for a more confident-looking answer.

## 11. The concise mental model

ARGUS should operate as:

```text
exact subject binding
  -> role-specific research director
  -> specialist evidence collection
  -> frozen sources and typed measurements
  -> question and coverage ledger
  -> direct findings plus score-neutral intelligence
  -> one immutable report and connection graph
  -> decision-lens synthesis
  -> conversational question director
  -> auditable claim chains and explicit inference boundaries
  -> optional, separately authorized follow-up investigation
  -> new immutable report version only after evidence gates pass
```

The experience should feel brilliant because it finds and connects relevant evidence, not because it speaks with unjustified certainty.
