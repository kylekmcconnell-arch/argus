# ARGUS point-in-time intelligence blueprint

Status: implemented intelligence foundation and expansion blueprint

Companion contract: `docs/ENTITY-POINT-IN-TIME-INTELLIGENCE.md` defines the implemented people, individual-investor, investment-firm, operating-company, and agency architecture. Both paths use the same score-neutral saved-snapshot contract and report panel.

Primary objective: turn one frozen ARGUS scan into a decision-grade diligence report for investment, alpha research, counterparty review, or broad project diligence.

Target economics: aim for no more than $3 per completed standard scan. Build the ideal evidence contract first, then admit each new collection lane to the standard scan only after its truth behavior, incremental cost, latency, and decision lift are measured.

## 1. Product promise

ARGUS should answer a harder question than "is this account credible?"

It should answer:

> What is true about this subject at the captured point in time, what materially changes the decision, what remains unknown, and what evidence would reverse the conclusion?

The product is one scan with one frozen body of evidence and four decision lenses. A lens changes emphasis, ordering, and decision language. It never changes the evidence, hides an inconvenient risk, or generates a second version of truth.

The report should create five immediate moments of clarity:

1. A point-in-time thesis with the strongest support, strongest pressure, and most material open question.
2. A capital and liquidity surface that connects valuation, float, unlocks, concentration, and executable exit capacity.
3. A control reality surface that identifies who can upgrade, pause, mint, move treasury assets, or change critical dependencies.
4. A business and usage surface that separates activity, fees, revenue, token value capture, and paid incentives.
5. A decision map that states the priority recheck trigger, the current frozen case, and the evidence still needed, without predicting which direction a future update will move.

This is not a larger pile of facts. It is a typed decision system built over cited facts, measured values, explicit arithmetic, and visible unknowns.

## 2. Product boundary

### In scope

- Point-in-time diligence on a project, protocol, company, token, or hybrid subject.
- One reusable frozen evidence snapshot per scan.
- Multiple decision lenses over the same snapshot.
- Deterministic deductions whose inputs and arithmetic are visible.
- Archetype-aware questions for products such as DEXs, lending protocols, stablecoins, and bridges.
- Explicit capture windows, provider attribution, bounds, and unanswered questions.
- A standard scan designed toward a $3 maximum completed-scan cost.

### Explicit non-goals

- No ongoing monitoring, alerting, or automatic change detection in this product phase.
- No price targets, return forecasts, event probabilities, or claims that a condition will occur.
- No trading instruction or personalized financial advice.
- No absence-as-exoneration. A failed, unavailable, disabled, uncollected, or bounded check never becomes a clean finding.
- No reconstruction of historical intelligence from evidence that was not stored in the original report.
- No decision lens that changes the score, removes risk signals, or creates contradictory facts.
- No provider opinion restated as an ARGUS finding.
- No subject identity established by names, tickers, biographies, or attacker-controlled labels alone.

## 3. One scan, one truth object, four views

The report architecture is:

```text
frozen collected evidence + governing parent findings and verdict
        |
        +--> direct findings remain in the governing report
        |
        v
artifact-bound sources and typed measurements
        |
        v
question and coverage ledger
        |
        v
deterministic observations, arithmetic, screens, and gaps
        |
        v
one complete shared intelligence signal set
        |
        +--> investment lens
        +--> alpha research lens
        +--> counterparty lens
        +--> general diligence lens
```

Every lens receives the complete signal set. Lens logic may rank or explain signals differently, but it may not suppress them. Direct findings stay separate in the governing report. Verified direct-subject adverse findings are also carried into every lens as attributed pressure observations so lens ordering cannot make them disappear. That carry-through does not reinterpret the finding or change the score.

This gives the user four useful products without paying for four scans or creating four incompatible narratives. The derived layer is subordinate by construction: it cannot replace the parent verdict, and it withholds a competing thesis when the parent is not decision-ready or governs with `AVOID` or `FAIL`.

## 4. What is implemented now

The point-in-time implementation adds a score-neutral intelligence layer over frozen PROJECT evidence and a separate entity ruleset over frozen people, individual-investor, investment-firm, and operating-company evidence. Building and rendering either intelligence snapshot adds no provider or model call. The scan also includes a separate fixed-block EVM Control Reality collector for supported canonical EVM tokens. That collector uses free public RPC endpoints, declares zero marginal dollars and zero model calls, and remains excluded from scoring.

### 4.1 Typed intelligence snapshot

`IntelligenceSpineSnapshot` records:

- schema and deterministic ruleset versions;
- point-in-time mode and an explicit `scoringImpact: "none"` declaration;
- subject forms and source-backed product archetypes;
- earliest and latest capture timestamps;
- typed source references;
- frozen legal, sanctions, press, profile-image, trust-graph, portfolio, fund-scale, contradiction-lead, scorer-packet, and evidence-band lineage that was already present in the immutable report;
- one lineage reference per supporting or contradicting fact artifact, including exact frozen input path and relation;
- typed measurements with units, windows, denominators, and evidence states;
- explicit research questions and their answer states;
- domain-level coverage;
- deterministic signals with source references, measurement references, arithmetic receipts, and change conditions;
- four decision lenses.

### 4.2 Safe subject classification

The implementation recognizes broad structural forms only from frozen structural evidence:

- token, when an identity-bound canonical token snapshot exists;
- protocol, when an identity-bound protocol TVL snapshot exists;
- company, when an official-domain company match or strict legal-entity fact exists.

Specific product archetypes are routed only from strict, deterministic, artifact-verified product facts. Names, handles, tickers, biographies, caller text, and provider projections cannot establish an archetype. Multiple strict matches produce a hybrid state. A protocol without a strict product match remains a generic protocol. Everything else remains insufficient.

### 4.3 Normalized measurements already derived

The current layer can normalize available frozen evidence into measurements including:

- market capitalization and fully diluted valuation;
- reported 24 hour volume and observed pool liquidity;
- circulating, total, and maximum supply;
- circulating share of total supply;
- TVL, 30 day TVL change, and chain concentration;
- 24 hour and 30 day protocol fees and fee trend;
- bounded holder count and assessed wallet concentration;
- scheduled unlock date, value, supply share, and 90 day supply share;
- self-attested and auditor-domain-corroborated audit counts;
- publicly reported or licensed-provider-reported funding;
- latest dated funding round, disclosed amount coverage, lead-investor count, and company firmographic context when identity-bound;
- fixed-block EVM target, standard proxy, implementation-candidate, authority-address, no-code address, and Safe-compatible interface observations;
- official domain age;
- launch-window boundaries and their observed gap;
- days since the latest observed post;
- current and departed named-leader counts;
- the largest provider-recorded security incident amount.
- unresolved legal and sanctions name-match lead counts, qualified adverse relationship counts, exact-handle portfolio relationships, strict identity-bound fund-scale claims, verified direct scorer counter-evidence, and analyst-recorded material gap counts.

Each value retains its evidence state. A reported value is not promoted to measured, a bounded register is not presented as a total, and missing values are omitted rather than converted to zero.

### 4.4 Deterministic deductions already implemented

The initial ruleset can surface:

- scheduled unlock value relative to reported 24 hour volume and observed liquidity;
- assessed holder concentration relative to observed liquidity and market capitalization;
- opposite-direction TVL and fee movement;
- trailing 30 day fee intensity relative to TVL;
- chain concentration in positive reported TVL;
- an audit provenance gap when subject-named audits lack auditor-domain corroboration;
- support when multiple audit engagements are corroborated on auditor-owned domains, with a scope caveat;
- standard proxy observations, conflicting implementation candidates, and incomplete proxy reads;
- standard authority addresses with no runtime bytecode, without calling them EOAs or inferring one key;
- Safe-compatible interfaces reporting threshold one, without authenticating an official Safe or asserting that those methods govern execution;
- the scale of a provider-recorded security incident, including its relation to current TVL when available;
- governance evidence that coexists with unresolved execution control;
- unresolved treasury evidence at material project scale;
- named leadership departures in frozen employment checks;
- reported low float and diluted-value overhang.
- legal and sanctions name-match leads as identity-resolution gaps rather than allegations;
- provider-attributed profile-image review leads without treating visual classification as identity proof;
- exact qualified relationships to complete server-collected `FAIL` or `AVOID` reports, while explicitly refusing to infer participation, responsibility, or common control;
- exact-handle confirmed portfolio relationships and strict fund-scale context without treating either as endorsement, present ownership, personal wealth, or project quality;
- verified direct-subject scorer counter-evidence, plus explicit integrity gaps when a counter-evidence reference fails its content, scope, verification, or axis-eligibility gate;
- analyst-reported contradictions as review leads until both sides carry artifact-level lineage.

These are observations, arithmetic, screening heuristics, or coverage gaps. They are not predictions and do not change the ARGUS score in schema version 1.

### 4.5 Question and coverage ledger

The current layer preserves whether a question is:

- resolved by strict source-backed evidence;
- answered only as reported context;
- partially answered;
- unresolved after a completed search;
- unavailable because collection failed;
- not collected;
- not applicable.

This distinction is essential. "Unresolved" means the scan did not establish the answer. It never means the favorable answer is true.

For PROJECT question-ledger entries, resolution is deliberately narrow. A strict bound fact can fully resolve only an atomic predicate currently represented by `official_identity`, `founded`, `launched`, or `official_token`. Founder, operator, product, control, treasury, funding, audit, governance, legal, and other multi-facet questions remain partial even when one strict fact answers one part. A related measurement may also make a question partial, but it cannot silently complete a broader question. Contradictory sources keep the question partial, and a failed direct control read becomes unavailable rather than a negative answer.

### 4.6 Decision interface

The current report panel provides:

- four accessible decision-lens tabs;
- the same complete risk and support set under every lens;
- strongest support, strongest pressure, and material open questions;
- visible arithmetic receipts;
- a lens-prioritized evidence atlas with the frozen value, evidence state, capture basis, and source for every displayed measurement;
- a dated event chronology built only from stored date measurements;
- complete expandable measurement and exact-source lineage registers, including frozen input paths, capture times, excerpts, and content hashes when available;
- a priority recheck trigger, the current frozen case, and evidence still needed;
- change conditions for each conclusion;
- a domain coverage map;
- the evidence capture window;
- an explicit statement that the layer is score-neutral and makes no provider call when rendered;
- governing-verdict handling that withholds a competing thesis for an incomplete parent report and for `AVOID` or `FAIL`.

The report also renders the saved fixed-block EVM Control Reality snapshot as its own proof surface. It exposes chain identity, block identity, bytecode fingerprints, standard proxy and authority paths, Safe-compatible responses, per-read receipts, and collector limitations. It does not infer EOA status, controller count, an official Safe deployment, a complete permission map, exploitability, or immutability.

Provider evidence that was previously compressed or dropped now has exact ledgers in both report surfaces. Strict official-domain company records expose firmographics, every financing round, lead and other investors, management rows, and the identity receipt. Exact CoinGecko-bound public protocol records expose every financing row, investor class, provider valuation, incident row, gross recorded amount, explicit returned amount, and return-state coverage. Team rows expose their role-proof page and developer-profile source chain. Leadership currency publishes current, departed, and unanswered provider states separately and anchors any age language to frozen scan time.

Before a snapshot can be published, a final integrity gate validates unique IDs and every source, measurement, denominator, answer, signal, arithmetic, temporal, and classification reference. A malformed or colliding record is withheld. An affected question is reopened, and the report receives a high-severity integrity gap instead of a plausible conclusion with broken lineage.

The snapshot is assembled from the final frozen evidence, persisted inside the exact immutable report version, and rendered from that saved snapshot. Older reports without the field stay unchanged; they are not reconstructed under a newer ruleset.

The on-demand AI second opinion follows the same frozen-version contract. The browser submits only the analyst's question. The server reloads the exact immutable report, selects the applicable investigation and project-account domains, records every cap or omission, and stops before provider spend when the challenged domain is incomplete. A published model sentence must reference a retained complete frozen artifact, and the UI labels the result as an AI opinion rather than an ARGUS finding. Missing, bounded, forged, or credential-bearing evidence cannot produce a recommendation.

## 5. Four decision lenses

### 5.1 Investment decision

Primary question: what could change underwriting, sizing, entry, or the decision to pass?

Priority surfaces:

- valuation versus observable activity and capital committed;
- liquid float, holder concentration, unlock pressure, and executable depth;
- protocol fees versus revenue and tokenholder value capture;
- treasury runway, liabilities, and spending controls;
- control rights, upgrade authority, emergency powers, and custody;
- incident history, current deployed-code scope, and unresolved remediation;
- team continuity, legal accountability, and funding obligations.

The lens should conclude with explicit investment blockers, evidence-backed supports, unresolved diligence conditions, and what would change the current thesis. It must not produce a price target or expected return.

### 5.2 Alpha research

Primary question: which measurable dislocations, scheduled events, and divergent trends deserve deeper timing work?

Priority surfaces:

- fee, usage, TVL, liquidity, and market trend divergence;
- unlock timing relative to volume, liquidity, and free float;
- capital rotation between chains or products;
- holder and treasury flow concentration;
- product launches, migrations, incentive changes, and governance decisions already evidenced at capture;
- differences between public narrative and measured operating evidence.

The lens identifies research setups and falsification conditions. It does not say an asset will rise or fall, assign a probability, or turn a scheduled event into a forecast.

### 5.3 Counterparty diligence

Primary question: can this entity be identified, controlled, secured, and held accountable for an exposure?

Priority surfaces:

- exact legal and operating entity;
- named accountable leaders and current roles;
- contract ownership, upgrade, pause, mint, and custody rights;
- multisig owners, threshold, modules, timelocks, and key-person concentration;
- treasury and customer-asset segregation;
- sanctions, regulatory, litigation, insolvency, and jurisdictional evidence;
- security history, audit scope, insurance claims, and remediation status;
- operational continuity and critical third-party dependencies.

This lens should end with conditions precedent, required representations, evidence that needs direct verification, and explicit exposure limits only when supplied by the user. It must not imply legal clearance.

### 5.4 General diligence

Primary question: what is established, what is only reported, and what remains unresolved?

Priority surfaces:

- identity, product, team, market, liquidity, supply, economics, funding, treasury, governance, control, security, legal, and chronology;
- source conflicts and capture-window differences;
- material questions not answered by the scan;
- a complete evidence map that another analyst can audit.

This is the broadest lens and the default record of the investigation. It should be suitable for an investment committee appendix, a vendor review file, or a research handoff without rewriting the evidence.

## 6. Highest-value diligence domains

The table below separates evidence already persisted by the current scan from the highest-value remaining gap. A remaining gap is still represented as an open question when applicable; it is never converted into a favorable answer.

| Domain | Decision questions | Implemented evidence | Highest-value remaining gap |
|---|---|---|---|
| Subject identity | What exact project, token, protocol, company, contracts, domains, and accounts are in scope? Are any namesakes or collisions present? | Official profile context, identity-bound canonical token and protocol snapshots, strict sourced facts, official-domain company matching | A signed subject manifest that binds every contract, deployment, legal entity, product, domain, and official account to a source the subject does not solely control |
| Product reality | What works today? What is live, test-only, deprecated, or only promised? Who uses it? | Strict product facts, repositories, profile activity, TVL and fee context when applicable | Direct product transaction and user-activity measurements, deployment inventory, release history, and product-specific operational checks |
| Team and accountability | Who founded, operates, and controls the project now? Which named leaders have departed? | Strict team facts and frozen employment-provider states for named leaders | Cross-source current-role corroboration, key-person dependency, contributor concentration, prior venture outcomes, and role-to-control reconciliation |
| Legal and regulatory | Which entity is responsible? In what jurisdiction? What licenses, litigation, sanctions, or insolvency facts matter? | Strict legal-entity and public security or legal-event facts when collected | Public-registry entity resolution, beneficial ownership where lawful, licenses, enforcement, court records, insolvency, sanctions, and terms-of-service entity reconciliation |
| Market structure | What is the identity-bound asset, valuation, volume, venue mix, price history, and listing quality? | Canonical token identity, market, liquidity, and OHLCV values with separate per-artifact producer, URL, and capture time; market capitalization, diluted value, volume, supply, and bounded history | Venue-quality decomposition, reliable spot versus derivative volume, spread and depth curves, market-maker concentration, and cross-venue dislocation |
| Executable liquidity | How much can actually be entered or exited at decision-sized amounts? Which pools and bridges constrain execution? | Observed pool liquidity and reported volume, plus concentration comparisons | Direct quote simulation or order-book depth at defined notionals, slippage, route fragmentation, bridge depth, withdrawal constraints, and stablecoin dependency |
| Supply and unlocks | What is liquid float? Who owns locked and unlocked supply? What becomes sellable, when, and to whom? | Circulating, total, and maximum supply, scheduled unlocks, GoPlus holder and flag context, and a separately cited ordered Blockscout holder register when that register produced concentration | Allocation-class reconciliation, beneficiary identities, vesting contract verification, insider and treasury wallets, emissions, burns, staking lockups, and free-float calculation |
| Economics and value capture | What creates usage? Who pays? Who receives fees or revenue? Does the token capture any of it? | TVL, fee windows, fee trend, fee intensity, and strict traction facts | Product revenue, protocol revenue, incentives, net earnings, take rate, unit economics, retention, subsidy-adjusted usage, and tokenholder cash-flow or utility rights |
| Treasury and runway | What assets, liabilities, burn, obligations, and spending controls exist? How long can operations continue? | Strict treasury facts and an explicit unresolved state | Identity-bound treasury wallets, asset quality, stablecoin and token concentration, liabilities, grants, payroll or burn disclosures, runway, signers, policies, and historical outflows |
| Funding and obligations | Who funded the project, on what terms, and what future rights or supply claims remain? | Public protocol funding, keyed company enrichment, and strict funding facts | Round-by-round terms, investor corroboration, warrants or token rights, valuation, lockups, strategic obligations, related parties, and funding-to-treasury reconciliation |
| Governance | Who proposes, votes, delegates, executes, and can bypass governance? | Strict governance facts and existing supplemental Snapshot evidence where safely bound | Proposal and voter concentration, delegate identity, quorum history, execution path, timelock, emergency council, offchain-to-onchain reconciliation, and governance participation quality |
| Contract control | Who can upgrade, pause, mint, seize, blacklist, change fees, replace oracles, or move assets? | Strict control facts plus fixed-block direct EVM reads for a verified canonical address: exact `eth_chainId` binding, block hash, standard EIP-1167 and ERC-1967 indicators, implementation candidates, admin and owner probes, address bytecode state, and Safe-compatible owner and threshold responses | Verified ABI and role enumeration, timelocks, modules, guards, fallback handlers, nonstandard proxies, project-wide authority graphs, privilege changeability, and supported non-EVM chains |
| Security posture | What was audited, which code and deployment were in scope, what incidents occurred, and what remains unremediated? | Audit leads retain subject-page versus curated-link origin. Corroboration requires an auditor-owned page with explicit audit context plus an official-domain or canonical-contract identity anchor in the same saved proof window. Provider-recorded incidents and strict security facts remain attributable. | Audit report parsing, commit and bytecode scope matching, deployed-code drift, findings and remediation, bug bounty quality, dependency risk, and post-incident restitution |
| Operational dependencies | Which chains, bridges, oracles, sequencers, custodians, cloud services, and front ends can halt or corrupt the product? | Chain TVL concentration and strict partnership or network facts | A dependency graph with control owner, failure mode, fallback, concentration, service status at capture, and user-fund impact |
| Chronology and catalysts | Which evidenced events explain the present state? What scheduled obligations or decisions are already known? | Launch and founding facts, domain age, activity recency, unlock dates, leader departures, incidents, and funding chronology | A source-cited event ledger connecting launches, migrations, audits, exploits, unlocks, governance execution, team changes, and capital events |
| Narrative versus reality | Where do official claims, provider records, direct measurements, and counterparties disagree? | Every saved BasicFact support and contradiction artifact keeps its own lineage reference, relationship, proof excerpt, and content hash; conflicts remain open and produce a cross-lens conflict signal | Claim extraction linked to direct falsification tests, counterparty corroboration, dated contradiction resolution, and a materiality-ranked discrepancy ledger |

## 7. Archetype-specific depth

Generic diligence is necessary but not sufficient. All archetypes currently recognized by `ProductArchetype` have implemented question packs. The pack adds applicable questions to the same frozen ledger; it never claims that collection answered them.

| Implemented pack | Additional frozen questions |
|---|---|
| DEX | Executable depth at decision-sized amounts; fee capture; contracts that can be upgraded, paused, or redirected |
| Lending | Utilization and bad debt; collateral and oracle dependency concentration |
| Stablecoin | Reserves and liabilities; redemption constraints; trading around the target value |
| Bridge | Validator, upgrade, and emergency control; locked-asset and minted-representation reconciliation |
| Layer 1 | Validator and block-production concentration; client and consensus failure evidence; issuance and security budget |
| Layer 2 | Sequencer, proving, upgrade, and emergency control; finality dependencies; user escape or force-inclusion path |
| Staking | Withdrawal and secondary-liquidity constraints; operator and key concentration; source of rewards |
| Derivatives | Collateral, oracle, and keeper dependencies; liquidation, bad debt, and open-interest concentration; insurance or loss-allocation backstop |
| Exchange or custody | Legal operator; customer-asset segregation; reserves versus liabilities; withdrawal constraints and suspension powers |
| Oracle or data | Source, node, signer, and update-authority concentration; stale-data and outage controls; live consumers and value at risk |
| Payments | Settlement, custody, reversal, and screening control; licensing; customer-fund and loss reconciliation |
| Launchpad | Allocation, vesting, and refund structure; launch selection and conflicts; custody of subscription proceeds |
| Gaming or NFT | Active-user, payer, retention, and economy evidence; user-asset control; dependence on centrally operated content or servers |
| Generic protocol fallback | Critical dependency map; connection between measured users, fees, and sustainable protocol or token value |

Routing remains conservative. A pack is selected only from a strict, direct-subject, artifact-verified product fact. Relational wording such as a DEX for stablecoin trading does not make the subject a stablecoin. Multiple independently supported product identities produce a hybrid assessment and add every applicable pack.

## 8. Truth and provenance contract

The intelligence product inherits ARGUS's highest-order rule: a plausible false sentence is worse than a missing sentence.

### 8.1 Source identity

Every source reference must carry:

- stable source ID within the report version;
- exact input path or fact ID;
- provider and title;
- source class;
- source URL when available;
- capture time when available;
- evidence state;
- content hash when the source artifact is stored or hashed.

Source classes must distinguish official subject, official counterparty, public registry, canonical market registry, protocol index, direct or provider-mediated onchain data, vesting provider, independent publication, licensed enrichment, and first-party profile context.

The implementation applies that contract at artifact granularity:

- Each BasicFact support source and contradiction source becomes its own stable reference with the exact `basicFacts.<index>.sources.<index>` input path, relation, provider, URL, capture time, excerpt, and content hash.
- Canonical token identity, market values, pool liquidity, and OHLCV history use separate `producerSources` records. A CoinGecko identity record cannot silently cite a DexScreener liquidity value or a GeckoTerminal candle window.
- Holder count, LP context, and fired GoPlus flags retain the GoPlus citation. When Blockscout supplied the ordered holder register, concentration gets a separate Blockscout source and capture time.
- Supporting and contradicting artifacts are both retained. A conflict remains partial and receives a cross-lens conflict observation rather than being collapsed into whichever source was read first.
- DeFiLlama incident recovery is three-state. Explicit yes, explicit no, and provider omission remain different values; an omitted `returnedFunds` field cannot render as "No" or become an unrecovered-loss claim.

### 8.2 Direct findings versus derived signals

The governing report owns direct findings, score, completeness, and verdict. The Intelligence Spine does not replace that record. It produces a separate typed register whose entries declare whether they are observations, arithmetic, screening heuristics, or coverage gaps.

A verified direct-subject adverse finding is mirrored into all four lenses as an attributed pressure observation so no lens can hide it. The original wording and source lineage remain authoritative. Provider opinions remain reported context, and deterministic screens remain labeled screens. No derived support can override an adverse parent verdict or create a final thesis when the parent assessment is not decision-ready.

### 8.3 Evidence states

- `verified`: strict source-backed evidence with the supporting artifact preserved or verifiable.
- `measured`: a direct or provider-produced numeric observation with its unit, entity, and capture basis.
- `bounded`: a valid observation over an explicitly limited register, window, provider result, or method.
- `reported_context`: a statement or value carried with attribution, not adopted as independently established by ARGUS.

Evidence state is attached to each source, measurement, question answer, and deduction. A downstream component cannot strengthen it.

### 8.4 Question states

The report must distinguish:

- resolved;
- reported;
- partial;
- unresolved;
- unavailable;
- not collected;
- not applicable.

Zero is a value only when the source explicitly measured zero. Missing, failed, suppressed, capped, unordered, unrecognized, unavailable, and not collected are states, not numbers.

For PROJECT research questions, an answered ledger entry is not enough by itself. Only an atomic strict fact can resolve an atomic question. A strict fact addressing one facet of a founder, product, funding, control, treasury, legal, audit, or governance question keeps that broader question partial.

### 8.5 Identity binding

- Names, tickers, handles, biographies, search ranking, and contract display names are discovery leads only.
- Attacker-controlled or subject-controlled values cannot independently bind a source.
- A material namesake claim requires an identity key or independent counterparty corroboration.
- A token or protocol record must remain bound to the canonical subject identity used in routing.
- TVL and funding require an exact normalized canonical CoinGecko-id join. Fees additionally require a frozen same-slug protocol binding receipt. Holder, unlock, and direct-control snapshots require exact normalized canonical address and chain receipts.
- Licensed company enrichment must recompute the relationship among the canonical official host, requested host, matched host, match method, company website, and capture time. A saved `official_domain` enum is never sufficient by itself.
- A shared publishing host such as `github.io`, `notion.site`, or `vercel.app` cannot bind company identity. Licensed enrichment also cannot authenticate itself by falling back to its own requested domain when the independently resolved official site is missing.
- RDAP chronology must rebind the exact queried hostname and registrable domain to the canonical official host and endpoint. Domain age and the account-to-domain launch window are recomputed from the two bound frozen inputs instead of trusting saved summary fields.
- Every contract-level finding states chain, address, block or capture time, and implementation address when relevant.
- The direct EVM lane calls `eth_chainId` before any block or contract read. A mismatch, malformed result, or RPC failure returns unavailable and performs no contract read on that endpoint.
- A no-code result means only that `eth_getCode` returned no runtime bytecode at the verified block. It does not establish an EOA, one key, one signer, or one human.
- A Safe-compatible response is interface evidence only. It does not authenticate an official Safe deployment or prove that those methods govern execution.
- An audit lead retains whether it came from a subject page or a curated audit link. Corroboration requires an auditor-owned page whose same bounded proof window contains explicit audit context, the subject name, and an official-domain or canonical-contract anchor. Client lists, bounties, competitions, incidents, and name-only matches do not qualify.

### 8.6 Arithmetic and deductions

Every deterministic deduction must carry:

- stable rule ID and rule version;
- kind: observation, arithmetic, screening heuristic, or coverage gap;
- source and measurement references;
- explicit arithmetic expression and inputs when calculation is involved;
- evidence state no stronger than its weakest material input;
- what the finding establishes;
- why it matters;
- what it does not establish when confusion is likely;
- the condition that would cause recomputation or reversal.

A heuristic must be labeled as a screen. It cannot identify intent, predict behavior, or attribute wallet ownership without evidence.

### 8.7 Time and reproducibility

- The intelligence snapshot is derived only from the evidence frozen into that report version.
- No render-time fetch may silently change a saved report.
- No use of the viewer's current clock may alter a persisted conclusion.
- Supply percentages outside 0% to 100%, a 90-day unlock aggregate above 100%, or circulating supply above reported total supply are withheld and converted into reconciliation gaps while their source receipts remain visible.
- A cross-source ratio or comparison is admitted only when every material input has a valid frozen as-of time and the newest and oldest inputs are no more than 72 hours apart. Missing, invalid, or stale temporal alignment withholds the comparison and emits an exact alignment gap.
- Arithmetic receipts preserve the as-of time for each input, the observed skew, and the 72-hour policy. Historical incident amount divided by current TVL is labeled historical-to-current scale, not a contemporaneous loss ratio.
- The capture window exposes the earliest and latest source timestamps.
- Each successful EVM snapshot fixes a block number, block hash, block timestamp, and provider host, then verifies that the block hash did not change before returning the snapshot.
- Re-running the same ruleset over the same frozen input must produce byte-equivalent semantic output, excluding serialization order that is explicitly normalized.
- Old reports without the intelligence snapshot remain old reports. They require an explicit rescan, not reconstruction from today's data.

### 8.8 Licensed and restricted data

Licensed enrichment may inform a derived, attributable conclusion only when provider terms permit that use. The report must not persist or expose raw licensed payloads merely because they are present during collection. Retention and redistribution rights are part of the lane acceptance gate.

### 8.9 Final lineage integrity

- Source, measurement, question, and signal IDs must each be unique inside the saved snapshot.
- Every measurement must resolve at least one source, and every denominator must resolve to a different retained measurement.
- Every question answer must resolve to one uniquely identified strict fact or retained measurement. Every question source must resolve to a retained source.
- Raw fact IDs and canonical `fact:<id>` aliases resolve to the same unique fact. A removed reference can preserve or weaken an open question, but can never upgrade unavailable, unresolved, or not-collected work to partial.
- Every signal reference and arithmetic input must resolve after all invalid records are removed.
- A non-gap signal must retain source lineage. Every referenced measurement's sources and every arithmetic or temporal input must be included in the signal's own lineage.
- Subject forms and archetype matches must retain at least one valid source.
- A failed invariant cannot be hidden by sorting or last-write-wins deduplication. The affected record is withheld, affected questions are downgraded, and an `intelligence_integrity_gap` is visible under every lens.

## 9. Cost architecture for a standard scan

The economic design is "collect once, reason many times."

### 9.1 Measured facts from this repository

Recorded run ledgers provide the only current dollar evidence:

| Recording | Measured cost | Configuration note |
|---|---:|---|
| `uniswap` | $3.44 | 27 calls, all Sonnet 4-6, not the current production model route |
| `linkrbot` | $2.18 | 19 calls, all Sonnet 4-6, not the current production model route |
| `orbitgroup_ai` | $1.08 | 18 Haiku discovery calls and 3 Sonnet 5 calls under the current route |

In `orbitgroup_ai`, the analyst used 14,833 input tokens across 3 calls and Haiku discovery used 331,263 input tokens. The measured cost evidence therefore points to discovery volume as the first optimization target. It does not establish a fleet-wide average or percentile because only one recording represents the current route.

A separate one-run notable-follower experiment measured $4.45 and returned fewer verified facts than the $3.44 comparison run. That result is insufficient to estimate a stable effect, but it is enough to keep the expanded lane out of the default scan pending a proper benchmark.

### 9.2 Standard-scan execution order

1. Reuse exact, fresh-enough frozen or knowledge-base evidence when its identity, capture basis, and terms permit reuse.
2. Run deterministic direct and free-data collectors with strict time and result bounds.
3. Normalize and deduplicate before any model sees the evidence.
4. Run targeted discovery only for material questions still unanswered.
5. Extract once into typed facts and question states.
6. Run one final analyst pass over the compact evidence package when required by the scored report.
7. Build all four decision lenses deterministically from the same persisted intelligence snapshot.

The report-time Intelligence Spine derivation, deductions, arithmetic receipts, coverage map, and lens projections add no provider or model calls. Their total marginal cost is $0. The scan-time EVM Control Reality lane is separate: it makes bounded calls to free public RPC endpoints, makes no model call, records each call in the ledger at $0, and declares `marginalUsd: 0` in its frozen snapshot.

### 9.3 Budget behavior

- `$3` is the target hard ceiling for a completed standard scan, not an invented vendor quote.
- The existing live ledger remains the authority for actual spend.
- A lane with unknown unit cost is a benchmark candidate, not a default dependency.
- Optional collection stops launching before it can consume the budget reserved for required scoring and persistence.
- Critical direct checks may replace lower-value broad discovery, but they do not turn a clipped scan into a complete one.
- If a required truth-critical lane cannot run inside the budget, the report becomes partial or incomplete. It does not publish a favorable substitute.
- A premium research mode may be evaluated later, but it must be explicitly selected and separately priced. It cannot silently expand the standard scan.

### 9.4 Benchmarks that must be measured

Do not assign dollar estimates to these remaining expansions before measurement:

- control analysis beyond the implemented standard EVM baseline, including verified ABIs, role enumeration, timelocks, modules, nonstandard proxies, project-wide authority graphs, and additional chains;
- executable liquidity and slippage at defined notionals;
- treasury discovery and asset reconciliation;
- audit-document extraction and deployment-scope matching;
- legal and public-registry entity resolution by jurisdiction;
- product-level usage and unit-economics extraction;
- round terms and investor counterparty corroboration;
- repository and deployed-code drift analysis;
- archetype-specific direct collection lanes beyond the implemented question packs;
- any expanded social-graph or notable-follower pass.

For each candidate lane, record:

- incremental `costUsd` from the run ledger;
- request and model-call count;
- input and output tokens by model;
- wall-clock latency and timeout rate;
- subjects for which the lane is applicable;
- resolved critical questions per applicable scan;
- verified facts added and false-positive review rate;
- effect on complete, partial, and incomplete report rates;
- duplicate evidence avoided through cache or reuse.

Promote a lane only when its decision lift and truth behavior justify its measured marginal cost.

## 10. Collection priority

The ideal contract is broad, but expansion order should follow decision value and cost leverage. The first two foundations below are implemented.

### Implemented foundation: zero-cost intelligence derivation

- The schema-versioned snapshot is persisted with the exact immutable PROJECT report version.
- Reports render only the persisted snapshot and make no render-time provider call.
- Every lens is score-neutral and receives the same complete saved signal set.
- Missing, conflicting, unavailable, related-entity, and bounded inputs retain their states.
- Capture windows, per-artifact source lineage, arithmetic receipts, open questions, and change conditions remain inspectable.
- Cross-source arithmetic is time-gated to valid frozen inputs within 72 hours, with exact temporal receipts and alignment gaps.
- A final graph-integrity pass withholds duplicate IDs and dangling references before any derived record reaches the report.
- Complete bound company, public-protocol funding, incident, team-proof, and leadership-continuity ledgers expose the saved rows that formerly disappeared behind counts or summaries.
- Optional provider sections preserve collection state. An unrequested funding or management section says not collected, never zero rounds or no managers.

### Implemented foundation: direct EVM Control Reality baseline

For a supported canonical EVM token, the collector:

- binds the RPC endpoint to the expected network with `eth_chainId` before any block or contract read;
- freezes one block number, block hash, block timestamp, and provider host, then verifies block consistency before returning;
- reads target bytecode, EIP-1167 runtime, ERC-1967 implementation, beacon, and admin slots;
- probes standard `owner()` relationships for the target, proxy admin, and beacon where applicable;
- records implementation candidates, authority-address bytecode state, and Safe-compatible `getOwners()` and `getThreshold()` responses;
- stores bounded raw values or hashes in per-read receipts;
- uses free public RPC endpoints, zero model calls, and zero marginal dollars;
- is structurally removed from the analyst scoring and contradiction packets and declares `scoringImpact: "none"`.

The baseline does not claim a complete permission map. No-code addresses are not labeled EOAs, Safe-compatible interfaces are not authenticated as official Safe deployments, and a zero standard slot does not prove immutability. Role-based permissions, timelocks, modules, guards, fallback handlers, custom proxies, diamond patterns, and project-wide controls remain open work.

Every unsupported chain, network mismatch, unrecognized proxy, failed read, or opaque authority remains explicit unknown coverage.

### Priority 2: capital, supply, and exit reality

- Free float and allocation-class reconciliation;
- beneficiary-bound unlock schedules;
- treasury and insider wallet attribution at a strict evidence bar;
- direct liquidity and slippage at decision-sized amounts;
- bridge and stablecoin dependencies;
- venue and market-maker concentration.

This turns isolated market numbers into a practical answer to "can I enter, hold, and exit this exposure?"

### Priority 3: economics and treasury

- Separate fees, revenue, incentives, earnings, and token value capture;
- measure subsidy-adjusted usage where direct inputs exist;
- reconcile treasury assets, liabilities, burn, and spending authority;
- expose the formulas and keep accounting claims attributable.

### Priority 4: audit and incident reality

- Parse audit scope, commit, contract addresses, severity, and remediation;
- match the audited artifact to current deployed implementations;
- build incident chronology, restitution, remediation, and recurrence controls;
- never equate an engagement page with current-code safety.

### Priority 5: legal, team, and accountability

- Resolve exact legal entity and jurisdiction from public or licensed keyed records;
- reconcile terms, official site, registry, and named operators;
- corroborate current roles and material departures;
- surface sanctions, enforcement, litigation, and insolvency only from properly bound records.

### Priority 6: archetype depth and narrative gaps

- Add direct collection that answers the implemented critical-question packs in section 7;
- collect only the lanes relevant to the strict archetype;
- compare official claims with direct operating measurements;
- rank discrepancies by decision materiality, not rhetorical surprise.

## 11. Acceptance criteria

### Stage A: intelligence contract, implemented baseline

- The same frozen evidence and ruleset produce the same semantic snapshot.
- No intelligence code calls a provider, model, or current-clock function.
- Every measurement has an entity key, unit, evidence state, and at least one source reference.
- Every arithmetic signal includes its expression and input measurement IDs.
- Every cross-source arithmetic signal includes valid frozen input times within the 72-hour comparison policy.
- Duplicate IDs and dangling source, answer, denominator, signal, arithmetic, temporal, and classification references fail closed before rendering.
- No missing, unavailable, bounded, or suppressed field is converted to zero.
- Specific archetypes require strict source-backed product evidence.
- The intelligence snapshot declares `scoringImpact: "none"`.
- Focused unit tests cover positive, missing, bounded, conflicting, and malformed inputs.

### Stage B: persistence and report integration, implemented baseline

- The snapshot is assembled after evidence collection is frozen.
- It is persisted inside the exact immutable report version.
- Saved reports render the persisted snapshot without live reconstruction.
- Old reports without the field remain unchanged and do not reconstruct intelligence under a newer ruleset.
- All four lenses expose the complete shared signal set.
- Lens selection changes ordering and framing only.
- The report visibly distinguishes measured, verified, bounded, reported, unresolved, unavailable, and not collected.
- Capture window, source links, question ledger, receipts, and change conditions are inspectable.
- Fixed-block control, company, public-protocol funding, incident, team-proof, and leadership-continuity ledgers render from the saved report without a live fetch.
- Omitted provider recovery data renders as not recorded, and leadership chronology never reads the viewer clock.

### Stage C: direct EVM control lane, implemented baseline

- Each attempted endpoint is bound to the expected chain by exact normalized `eth_chainId` before any block or contract read.
- Each successful contract result is bound to chain, canonical address, block number, block hash, block timestamp, provider host, and exact read receipts.
- Standard EIP-1167 and ERC-1967 implementation, beacon, and admin evidence is recorded without claiming coverage of custom proxy paths.
- `owner()` and Safe-compatible probes state their interface limitations and do not infer intent, EOA status, one-key custody, or complete authorization semantics.
- Unrecognized, mismatched, malformed, and failed reads publish unknown or unavailable coverage, never "no admin control."
- The snapshot declares zero model calls, zero marginal dollars, and no scoring impact. The orchestration boundary removes it from model and scorer packets.

The next direct-control acceptance step is verified role enumeration, timelocks, modules, guards, nonstandard proxies, audit-to-deployment comparison, and a multi-subject latency and question-resolution benchmark.

### Stage D: capital and economics lanes

- Executable-depth results state venue, route, notional, timestamp, slippage, and limitations.
- Unlock conclusions identify the schedule source, beneficiary status, denominator, and liquidity comparison.
- Treasury assets and liabilities retain address and source provenance.
- Fees, revenue, incentives, and token value capture are separate typed measures.
- Derived ratios have visible receipts and no denominator ambiguity.
- Each lane passes identity-binding and bounded-read fixtures.

### Stage E: ideal point-in-time report

- A reviewer can answer the selected lens's primary question from the first screen without losing access to the full evidence.
- Every material conclusion links to evidence and a reversal condition.
- Every critical unanswered question is visible before the reader reaches favorable support.
- The report includes subject scope, point-in-time thesis, control reality, capital and exit reality, economics, security scope, team and legal accountability, event chronology, recheck triggers, and evidence conditions when applicable.
- Human red-team review finds no false clean claim from collection failure, route mismatch, namesake collision, bounded data, or provider opinion.
- Offline replay intercepts global fetch plus native public-page HTTP/HTTPS, reproduces only frozen traffic, and opens no DNS lookup or socket for an uncovered request.
- Full repository truth, calibration, canary, test, typecheck, and build gates pass.

### Stage F: cost qualification

- Every run records total cost and cost by model or provider lane where the system can observe it.
- The benchmark set contains multiple applicable subjects across token, protocol, and company forms. One run is never treated as a fleet estimate.
- The standard configuration demonstrates the $3 completed-scan target on the agreed benchmark before it is called cost-qualified.
- Quality is compared beside cost: critical questions resolved, verified facts, false-positive review rate, incomplete rate, and latency.
- If a lane breaches the target without commensurate decision lift, optimize its discovery scope, reuse, batching, or direct-data substitute before weakening analyst quality.

## 12. Product success measures

Cost alone cannot define the product. Track:

- percentage of applicable critical questions resolved, reported, partial, unresolved, unavailable, and not collected;
- percentage of material conclusions with direct source links and valid capture times;
- percentage of arithmetic deductions with complete receipts;
- identity-collision and cross-subject contamination rate in reviewed fixtures;
- false-clean rate from provider failure or missing data, with a target of zero;
- lens consistency rate, with a target of one shared complete signal set in every lens;
- report reproduction rate from frozen evidence and ruleset;
- incremental cost per resolved critical question for each new lane;
- completed, partial, and incomplete scan rates;
- analyst review outcome: decision-changing, useful context, redundant, or misleading.

The strongest product metric is not the number of providers or the length of the report. It is the number of material decision questions resolved honestly per dollar, while making every unresolved question impossible to mistake for safety.

## 13. Recommended product decision

Build the ideal point-in-time data contract now. Do not defer the truth model, question ledger, source graph, arithmetic receipts, archetype packs, or report structure in the name of cost.

Control rollout cost at the collection-lane boundary:

- ship reusable deterministic intelligence over evidence already paid for;
- add direct and free-data lanes before broad model or web discovery;
- benchmark every unknown-cost lane in isolation;
- promote only lanes with measured decision lift;
- preserve partial and incomplete states when the budget clips collection;
- keep all four lenses as deterministic views of one snapshot.

This approach delivers the "different level" report without multiplying scans or spending on repeated interpretation. The wow factor comes from connecting identity, control, capital, liquidity, economics, security, accountability, and chronology into one auditable decision surface, while being unusually honest about everything the scan still does not know.
