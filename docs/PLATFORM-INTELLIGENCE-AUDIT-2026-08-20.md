# ARGUS intelligence and report architecture audit

**Date:** 2026-08-20  
**Scope:** collection, entity resolution, source binding, scoring semantics, report storytelling, report display, provider status, rescans, and regression coverage.  
**Reference cases:** MultiHopper, Clutch Markets, Dynex namesake collision, PONS/DEX-only token identity, explicit tokenless projects, and provider-outage/no-record cases.  
**Delivery status:** the corrections described as implemented below are in the final PR #83 batch. They are not merged and remain subject to final cloud CI and hosted-preview verification.

## Governing thesis

ARGUS should publish one decision story derived from one frozen evidence graph. Every visible roster, graph edge, score, question count, concern, evidence limit, and narrative sentence must resolve back to the same canonical entity, relationship, claim, artifact, collection outcome, and saved report version.

A provider is retrieval plumbing. A source is a publisher or primary record. A relationship is a directed claim. A missing record is scoped to the provider, candidate, and query that returned it. A score measures the project against the rubric; evidence strength measures how well the score is supported. None of these concepts may substitute for another.

The report should answer five questions in this order:

1. **What is the current call?**
2. **What is the strongest proof?**
3. **What is the strongest pressure or confirmed adverse finding?**
4. **What decisive fact remains unknown?**
5. **What evidence would change the call?**

Everything else is an audit trail.

## Final PR #83 correction set

### 1. Canonical team and relationship truth

The earlier pipeline could classify the same entity differently in collection, scoring, the dossier, the graph, and the rendered roster. Name similarity and nearby role language could also turn a discovery lead into a team member or project backer.

The final correction set establishes one canonical relationship interpretation for every downstream consumer:

- exact normalized handles and exact LinkedIn identities are merge anchors;
- a similar name is a discovery candidate, not an identity key;
- a transitive alias bridge is accepted only when the stable identifiers do not conflict;
- model metadata cannot donate project-side authority to a claim;
- an explicitly confirmed non-core class remains non-core even when its role text contains founder, team, VC, or fund language;
- claimant-side biographies remain claimant declarations rather than project confirmation;
- core-team scoring consumes only verified operating people;
- relationship scoring consumes only artifact-verified backer or partner edges with project, counterparty, or independent provenance;
- candidate and associate rows remain visible for investigation but cannot inflate the confirmed roster, graph, P1, P4, or named-team counts;
- roster, graph, dossier, scoring, and report presentation consume the same classified entities.

The MultiHopper contract now treats the three Alex/Kuj identity variants as one person only through stable identity evidence; retains the verified core operators; keeps ecosystem groups and unrelated accounts outside the team; and exposes Strategic Super R as an unconfirmed relationship lead rather than a VC assertion.

This is the current canonical row model. A durable, versioned relationship-edge schema and a frozen roster hash are still deferred; see Deferred work.

### 2. True full-rescan execution

The old fresh path bypassed only part of the orientation cache. Subject searches, Basic Facts reuse, prior facts, and in-process provider memos could still leak stale material into a requested rescan.

The final correction set makes full rescan a run-scoped collection policy:

- subject-cache reads are disabled for the run;
- successful live results write through to refresh the cache;
- a failed live request does not fall back to stale subject evidence;
- durable prior facts are excluded from current evidence and scoring;
- X and DeFiLlama in-process memos are scoped to the audit run;
- Basic Facts and grounded search receive the same run policy;
- explicit cache bypass remains available for operations that must neither read nor write;
- concurrent standard and full scans do not share a subject result;
- a refresh collision returns an explicit non-persisted conflict instead of spending twice or silently reusing the other run;
- shared reference data, such as sanctions indexes, remains reusable because it is not subject evidence.

A full rescan still does not promise that every provider will answer. It promises current collection attempts, isolated subject state, refreshed successful results, and an honest partial outcome when providers fail or the audit reaches its normal ceiling.

### 3. Evidence strength is independent of score

A low score is not proof that evidence is weak. Strong evidence can establish poor performance. A high score supported only by a project’s own claims can be weakly evidenced. Citation quantity is also not source independence.

The final correction set separates these dimensions in both reasoning and display:

- score language describes rubric performance;
- evidence-posture language describes source authority, independence, coverage, and unresolved proof;
- evidence limits are derived from saved gaps, unavailable operations, and source posture rather than from a low axis score;
- a strongly evidenced low score does not generate a generic evidence-is-thin warning;
- a favorable or neutral result with weak proof discloses its uncertainty;
- product, usage, transparency, legal-operator, governance, audit, code, and identity gaps name the missing proof when it is known;
- assessed-null no-token and no-backer facts remain neutral unless they contradict an official claim or methodology requirement.

Origin counting is now best-effort rather than URL counting:

- repeated URLs and records from the same publisher/control domain collapse to one origin;
- identical frozen content collapses even when delivered through different providers;
- multi-tenant domains receive safeguards so unrelated publishers are not automatically collapsed;
- direct observations, counterparties, regulators, chain records, independent reporting, aggregators, and search leads retain distinct source roles.

Durable publisher-control identifiers beyond this domain/content grouping remain deferred.

### 4. Scoped provider outcomes

The sentence “a source has no record of this subject” was too broad when the failed operation targeted a related account or a discovery candidate. It also collapsed provider failure and verified nonexistence into the same user-facing state.

The final correction set applies these rules:

- checked-empty means the named source and exact query completed without a qualifying record;
- checked-empty closes that bounded collection question but never proves global absence;
- unavailable means transport, authentication, throttling, timeout, or provider failure prevented completion;
- candidate-level no-record is scoped to that candidate and cannot become a subject warning;
- a redundant related-account probe is suppressed when the audited identity was already established elsewhere;
- X establishes a terminal state only when the returned visible page explicitly says “Account suspended” or “This account doesn’t exist”;
- script, style, template, and other non-visible page text cannot create a terminal X result;
- every other X probe failure remains retryable and temporarily unavailable;
- previously saved reports retain their frozen provider notice; a new scan produces the corrected interpretation.

These semantics also apply to protocol discovery. A CoinGecko 404 for a candidate ID is a completed candidate-not-found result, not “the project does not exist.” A 429, 5xx, or transport failure is unavailable.

### 5. CoinGecko-independent protocol binding

CoinGecko is now one registry and corroborating source rather than the canonical join key for a project, token, or protocol.

The final correction set introduces typed protocol-binding receipts with deterministic precedence:

1. exact normalized chain and contract;
2. exact, non-conflicting CoinGecko ID;
3. exact audited X handle plus verified official domain for project-only binding;
4. otherwise unbound or conflict.

Names, symbols, tickers, and slugs remain discovery keys only.

The migration spans collection, intelligence construction, diligence evidence binding, incident handling, and report UI:

- protocol identity is resolved before TVL, funding, fee, or other metric collection;
- unbound projects do not trigger metric collection that cannot be safely attributed;
- exact chain-and-contract receipts admit token and protocol evidence without CoinGecko;
- exact X-and-domain receipts admit only project-scoped fundamentals and cannot manufacture a token, deployment, or token-to-protocol identity;
- downstream intelligence accepts validated non-CoinGecko receipts instead of emitting a false high-severity identity-mismatch signal;
- incident evidence preserves the receipt’s project-only or project-and-token scope;
- a valid project-only receipt never mutates token identity or deployed chains;
- the report labels the actual binding method instead of saying every deployment was “Matched through CoinGecko”;
- redundant CoinGecko candidate failures remain in the raw provider ledger but are suppressed from the user-facing subject warning when another validated receipt established the relevant identity.

Sourcify and similar sources can prove code at an already-bound address; they cannot establish project identity or token semantics by themselves.

### 6. One decision story, then the audit trail

The previous report placed several competing summaries, repeated scores, repeated relationship interpretations, and provider diagnostics in the primary reading path.

The corrected information architecture is:

1. subject and governing result;
2. sticky report navigation;
3. one decision summary;
4. one weighted scorecard linked to exact axis evidence;
5. governing thesis, strongest proof, strongest pressure, decisive unknown, and recheck condition;
6. operating, token, product, and usage facts;
7. exact score basis and the next three checks;
8. canonical people and relationships;
9. confirmed findings, evidence limits, and investigative leads;
10. one collapsed detailed case file containing the complete dossier, research plan, provider receipts, and technical records.

Narrative classes remain distinct:

- **Main concerns:** verified adverse findings and resolved contradictions;
- **What remains unverified:** evidence limits and decisive missing proof;
- **Source problems:** unavailable or failed collection operations;
- **Operating facts:** neutral absence, assessed-null facts, and not-applicable context;
- **Investigative relationship candidates:** claimant declarations and unconfirmed associations.

This structure preserves the full research record without making transport diagnostics or discovery leads compete with the decision brief.

## Canonical collection outcomes

| State | Meaning | Decision treatment |
|---|---|---|
| matched / confirmed | A qualifying artifact bound the claim | May support or contradict |
| checked_empty | The named source and exact query completed with no qualifying record | Completed bounded coverage; never global absence |
| unavailable | Provider, transport, auth, throttle, or timeout prevented completion | Retryable collection health |
| ambiguous | Multiple candidates or conflicting hard anchors remain | Human review; no bind |
| not_collected | Work was not attempted | Open scope |
| not_applicable | The question does not apply | Neutral; denominator handling remains methodology-dependent |

The dossier excludes checked-empty from its open count and derives open questions from the saved intelligence question ledger used by the decision view.

## Source authority and remaining data gaps

| Domain | Preferred authority | Secondary corroboration | Never sufficient alone | Remaining gap |
|---|---|---|---|---|
| Project identity | official account plus verified official domain | registry, counterparty, independent reporting | display name, symbol, search slug | broader verified-domain and registry coverage |
| Team | project-side team page/post plus stable person ID | claimant bio, LinkedIn, independent reporting | name-only search, generic occupation bio | current/former state and explicit historical validity |
| Product | live official product, repository/release, direct protocol data | independent technical reporting | social posting alone | release, repository concentration, and real-user activity coverage |
| Token | first-party contract declaration plus exact chain/address and direct chain reads | CoinGecko, DexScreener, Sourcify after binding | symbol, name, slug | true token-axis not-applicable scoring |
| Funding/backers | filing or project/counterparty confirmation | independent round reporting | aggregator or name match | wider direct counterparty confirmation |
| Usage | direct protocol/product metrics with dates | independent analytics | token volume or posting cadence | users, transactions, retention, and fee quality |
| Governance/control | direct chain reads, Safe owners/threshold, governance system | verified documentation | generic audit badge | Snapshot, Tally, and Safe control integration |
| Legal/company | official registry/filing bound by domain/entity ID | independent reporting | same-name filing | broader jurisdiction coverage and freshness |
| Adverse | regulator, court, chain incident, source-bound primary record | independent investigation | anonymous lead or claimed source count | hard-cap eligibility audit and durable publisher-control IDs |

Relevant primary references:

- [ODNI ICD 203 analytic standards](https://www.dni.gov/files/documents/ICD/ICD-203.pdf)
- [NIST AI Risk Management Framework](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
- [W3C PROV-O provenance model](https://www.w3.org/TR/prov-o/)
- [W3C heading structure guidance](https://www.w3.org/WAI/tutorials/page-structure/headings/)
- [WAI-ARIA accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)
- [Entity-resolution review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11636688/)
- [CoinGecko contract lookup](https://docs.coingecko.com/reference/coins-contract-address)
- [Sourcify v2 API](https://docs.sourcify.dev/docs/api/index.html)
- [Safe transaction service](https://docs.safe.global/core-api/transaction-service-overview)
- [Tally governance](https://docs.tally.xyz/tally-features/welcome)
- [Companies House API](https://developer.company-information.service.gov.uk/)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [GitHub releases API](https://docs.github.com/en/rest/releases/releases)

## Backtest contract

The final PR #83 batch adds targeted regression coverage for the corrected semantics:

1. **MultiHopper relationships** — stable alias merge, core-team boundaries, ecosystem and associate separation, false-VC exclusion, candidate visibility, and consistent score/dossier/report classification.
2. **Full-rescan isolation** — no subject-cache reads, live write-through refresh, prior-fact exclusion, run-scoped memos, and deterministic concurrent-scan conflict behavior.
3. **X terminal state** — only explicit visible terminal copy establishes suspension or nonexistence; hidden page text and ordinary failures remain unavailable.
4. **Provider outcome scope** — related-account and candidate misses cannot become audited-subject warnings; 404 differs from provider unavailability.
5. **Evidence reasoning** — low score does not imply weak proof; favorable weakly supported claims expose uncertainty; neutral assessed-null facts do not become concerns.
6. **Source independence** — repeated publisher domains and identical content cannot inflate corroboration; multi-tenant domains retain separation safeguards.
7. **Protocol identity** — exact chain/contract works without CoinGecko; exact non-conflicting CoinGecko remains valid; exact X/domain is project-only; ambiguous or conflicting bindings fail closed.
8. **Downstream protocol scope** — project-only receipts cannot create token identity, deployed chains, or token incidents; valid non-CoinGecko receipts do not create false identity-mismatch warnings.

Final cloud CI, production build verification, and hosted-preview validation are required before this batch is considered release-ready.

## Adversarial review

The stricter relationship model will intentionally produce fewer confident team, backer, and partner assertions. That is the correct tradeoff: a visible candidate is more useful than a false confirmed relationship.

Best-effort origin grouping can still under- or over-collapse publishers when domain control is not explicit. That is why durable publisher-control IDs remain a separate data-model task.

Provider-independent protocol joins reduce CoinGecko coupling but add new collision paths. Chain normalization, address normalization, official-domain proof, and hard-anchor conflicts must continue to fail closed. Project-only bindings must never leak into token claims.

A full rescan costs more and can expose provider instability that cached scans masked. It should never promise completeness; it promises current attempts, isolated subject state, and honest partial results.

Collapsing audit material improves decision readability but can hide detail from power users. The remedy is a clear, keyboard-accessible disclosure with preserved exact receipts, not another full report in the primary flow.

## Deferred work

These items are intentionally not claimed as complete by the final PR #83 batch:

1. **Versioned relationship-edge schema and roster hash.** Persist immutable relationship edges with validity windows and freeze one roster hash consumed by score, graph, dossier, and UI.
2. **Durable publisher-control identifiers.** Replace best-effort publisher-domain and frozen-content grouping with explicit publisher/control-group IDs and lineage records.
3. **Hard-cap eligibility audit.** Derive every disqualifying cap solely from bound saved artifacts and prove that caller-supplied counts or arbitrary URLs cannot trigger AVOID.
4. **True tokenless P3 not-applicable treatment.** Decide and implement either denominator reweighting or an explicit N/A contribution while preserving rubric comparability.
5. **Full golden corpus and authenticated visual validation.** Expand end-to-end frozen cases and complete authenticated desktop/mobile checks, including 320, 375, 768, and desktop layouts, keyboard navigation, scrolling, long handles, reduced motion, and print behavior.

## Release gate

Before merge:

- final GitHub Actions verification and production build must pass on the assembled batch;
- the Vercel preview must be ready;
- no target-scoped no-record may appear as a subject warning;
- no claimant-only relationship may enter P1 or P4;
- no project-only protocol receipt may create token evidence;
- checked-empty must never count as open;
- provider unavailability must never count as adverse;
- score performance and evidence strength must remain separate in the governing story;
- all visible internal report anchors must resolve.

PR #83 remains a draft until these gates are reviewed.