# ARGUS entity point-in-time intelligence

Status: implementation contract and staged product blueprint

Scope: people, individual investors, investment firms, operating companies, and agencies

Primary objective: turn one frozen scan into decision-grade diligence for investment, alpha research, counterparty selection, partnership, hiring, or broad entity review.

Target economics: no more than $3 for a completed standard scan. The ideal evidence contract comes first. New paid collection enters the standard route only after measured decision lift, truth behavior, latency, and incremental cost justify it.

## 1. Research thesis

ARGUS is not primarily missing another search result. It is missing an entity evidence contract that preserves the difference between:

- an account and the exact person or organization behind it;
- a person and the firm where that person works;
- a fund brand, its adviser or manager, its legal vehicles, and its individual partners;
- a claimed portfolio logo and a canonically bound investment event;
- portfolio membership and portfolio quality;
- a fund close, regulatory assets under management, current net asset value, deployable capital, and a person's wealth;
- a provider-reported field and an ARGUS-verified conclusion;
- an unanswered search and evidence that the favorable answer is true.

The product should answer:

> What is established about this exact subject at the captured point in time, what could change a real decision, what is only reported, what remains unknown, and which next artifact would reverse the current thesis?

The highest-value product is a typed decision system over frozen evidence, not a longer narrative summary.

Research basis: repository execution and code review. Confidence: high. The copied-display-name, licensed-person collision, partial-fund-scale inversion, name-only portfolio relationship, organization question mismatch, and unconstrained investor-scoring defects were reproduced with deterministic local fixtures. No paid or live scan was used.

## 2. Archetypes must stay separate

### 2.1 Person or operator

Core decision: can this exact person be relied on, and what have they actually done?

Required domains:

- exact account-to-person identity binding;
- current role and authority;
- dated career chronology and departures;
- founder, operator, employee, adviser, board, and investment roles kept distinct;
- outcomes attributable to the person's actual contribution;
- credentials and registrations;
- counterparty-confirmed relationships;
- direct-subject legal, regulatory, sanctions, and conduct records;
- conflicts, contradictions, related parties, and promotional incentives.

### 2.2 Individual investor

Core decision: is this person an effective and trustworthy capital allocator, and which actions belong to the person rather than an affiliated fund?

Required domains:

- every person-domain requirement;
- current firm, title, tenure, and decision authority;
- personal investment versus affiliated-fund attribution;
- exact-bound investment events;
- founder or portfolio-company acknowledgements;
- lead, follow, board, operating, recruiting, or advisory contribution;
- outcome cohort with explicit denominators;
- conflicts between personal promotion, board roles, ownership, and fund activity;
- fund-scale context labeled as firm context, never personal wealth.

### 2.3 Investment firm

Core decision: is this exact manager and vehicle structure legitimate, capable, aligned, and useful to founders or limited partners?

Required domains:

- brand, adviser, manager, general partner, fund, special-purpose vehicle, and co-investment entity topology;
- jurisdiction, registration, exemption, and current legal status;
- owners, partners, investment committee, key-person terms, departures, and succession;
- vehicle vintage, target, first close, final close, commitments, regulatory AUM, NAV, and claim as-of date kept distinct;
- mandate by stage, sector, geography, check size, ownership, reserve policy, and instrument;
- exact-bound investment events and attribution to a named vehicle when available;
- portfolio outcomes, follow-ons, shutdowns, write-offs, exits, down rounds, and repeat backing;
- founder, portfolio-company, co-investor, and limited-partner references;
- custody, conflicts, related parties, token allocations, market-maker relationships, governance roles, and on-chain exposure;
- complete coverage receipt for the bounded portfolio read.

### 2.4 Operating company

Core decision: is this exact legal and operating business real, durable, compliant, and capable of delivering what it claims?

Required domains:

- brand-to-legal-entity and domain-to-registry binding;
- incorporation, jurisdiction, registration number, status, directors, and beneficial control;
- current leadership, authority, and role currency;
- live product and delivery reality;
- customers, contracts, suppliers, partners, and dependencies;
- revenue, usage, headcount, retention, backlog, or other dated operating evidence;
- equity, debt, grants, cap-table context, and financing chronology;
- governance, related parties, security posture, insolvency, litigation, sanctions, and enforcement;
- contradiction ledger for marketing claims versus direct records.

### 2.5 Agency or service provider

Core decision: can this provider deliver legitimate work without creating legal, reputational, or market-manipulation risk?

It shares the company contract, with added emphasis on client confirmation, measurable outcomes, service integrity, subcontractors, conflicts, custody or access, and prohibited growth tactics.

## 3. Typed evidence ledgers

Every report should be assembled from these ledgers. A source receipt may support more than one ledger row, but one source must never inflate the count of entities, investments, outcomes, or vehicles.

### 3.1 Subject binding ledger

Fields:

- audited handle or input;
- frozen entity kind;
- canonical person, organization, or legal-entity identifier;
- binding method;
- exact supporting artifact;
- aliases and former names;
- conflicts and unresolved namesakes;
- capture time and source time.

Accepted binding examples include an exact social URL returned by a licensed identity provider, a reciprocal first-party link, a regulatory identifier joined to the official domain, or an equivalent provider-authenticated relationship. Display name, biography, follower count, profile image, user-supplied website, and model-discovered company remain hypotheses.

### 3.2 Career and authority ledger

Fields:

- person;
- organization;
- title;
- relationship type;
- start and end dates;
- current, departed, or unknown state;
- authority or decision rights;
- person-controlled, company-controlled, licensed, regulatory, or independent source class;
- exact source receipt.

The ledger must not infer why a person left from an end date.

### 3.3 Contribution ledger

Founder, operator, employee, adviser, director, investor, vendor, and promoter are different relationships. Each row records:

- claimed contribution;
- observable contribution;
- attributed outcome;
- confirming counterparty;
- evidence tier;
- unresolved attribution.

### 3.4 Investment event ledger

Fields:

- investor person;
- firm and vehicle;
- company legal identity and canonical domain;
- date, stage, round, and instrument;
- amount or check-size qualifier;
- lead or follow role;
- board or operating role;
- source tiers;
- exact-binding state;
- conflict or namesake state.

Relationship states are separate:

- discovered candidate;
- fund-claimed;
- counterparty-confirmed;
- independently reported;
- canonically bound;
- unresolved namesake;
- contradicted.

Only a canonically bound row may become a graph edge. Membership is not evidence of quality.

### 3.5 Outcome ledger

Fields:

- linked investment or venture;
- observable outcome type;
- event date;
- exit, acquisition, shutdown, write-off, down round, follow-on, or active status;
- returned capital only when explicitly reported;
- source and attribution quality;
- denominator membership.

The report should calculate cohorts only when the denominator is visible. For example, 4 confirmed follow-ons out of 11 exact-bound investments is meaningful; 4 follow-ons without the inspected universe is not.

### 3.6 Fund and vehicle ledger

Fields:

- adviser, manager, general partner, fund, and vehicle identity;
- jurisdiction and registration or exemption;
- vintage;
- target, hard cap, first close, final close, commitments, regulatory AUM, NAV, and currency as separate metrics;
- exact claim date or as-of date;
- source basis: regulatory, manager-reported, independent, or licensed;
- qualifier: exact, approximate, target, minimum, maximum, or undisclosed.

Capture time must never impersonate a claim's as-of date. No amount found in a bounded search remains an unresolved scale question, not a verified small fund.

### 3.7 Company operating ledger

Fields:

- product and live-state evidence;
- customer, supplier, and partner confirmations;
- revenue, usage, retention, headcount, delivery, and backlog metrics;
- metric period, currency, unit, denominator, and source class;
- funding and debt chronology;
- operational dependencies;
- security incidents and recoveries;
- management changes and insolvency indicators.

Licensed company data stays attributed context until corroborated by a registry, filing, counterparty, or direct operating record.

### 3.8 Control, conflict, and conduct ledger

Fields:

- ownership and beneficial control;
- board, investment committee, voting, signing, custody, treasury, and administrative rights;
- related parties and overlapping roles;
- personal versus fund holdings;
- token allocations, vesting, unlocks, market makers, and governance participation where applicable;
- promotional, advisory, investment, and compensation conflicts;
- exact legal, sanctions, regulatory, disciplinary, litigation, and insolvency screen coverage;
- direct-subject adverse records and dispositions.

A no-match is limited to the named dataset, aliases, and capture. It is not a universal legal clearance.

### 3.9 Reference graph

Edges require an explicit statement or stable identifier from the other side. Follows, shared events, logo walls, and provider similarity scores are not endorsements.

Useful edge types include:

- founder confirms investor and contribution;
- company confirms customer or supplier;
- co-investor confirms round role;
- registry confirms director, manager, adviser, or entity relation;
- person confirms current firm;
- firm confirms current person;
- vehicle confirms investment event;
- on-chain ownership confirms exact address relation.

### 3.10 Coverage receipt

Every domain publishes:

- surfaces discovered;
- surfaces inspected;
- exact-bound records;
- reported-only records;
- unresolved namesakes;
- source and record caps;
- failed and unavailable reads;
- first-party concentration;
- unasked questions;
- marginal cost and model-call count.

This receipt prevents a bounded set from looking complete and makes empty output diagnosable.

## 4. The report experience

The wow factor should come from decision compression, proof, and contrast.

### 4.1 Decision thesis

The opening deep-dive surface should show:

- strongest support;
- strongest pressure;
- decision-critical unknown;
- current thesis by selected lens;
- exact condition that would strengthen, weaken, or reverse it;
- score readiness separated from evidence usefulness.

An incomplete score must not make the whole report feel empty. The report can withhold a score while still presenting source-backed identity, career, firm, vehicle, portfolio, operating, conflict, and coverage intelligence.

### 4.2 Entity and vehicle map

A compact graph should connect:

```text
person -> current firm -> adviser or manager -> fund or vehicle -> investment event -> company
  |            |                  |                  |                  |
 roles      registration       close or AUM       attribution       outcome
```

Every edge opens its exact receipt and state. Unverified candidates are visually separate and never enter the trust graph.

### 4.3 Track-record cohort

Show exact-bound investments or ventures by vintage and status, with visible denominator and separate columns for membership, role, contribution, and outcome. The report should highlight where public portfolio breadth is much larger than the set that can be exactly bound.

### 4.4 Claim versus reality

Pair subject-controlled claims with the strongest direct record, counterparty confirmation, contradiction, or unresolved state. The system does not decide that a first-party claim is false merely because independent proof is absent.

### 4.5 Dated alpha surface

Alpha should be a dated change in the frozen evidence, not a model prediction. Useful point-in-time signals include:

- recent deployment or investment acceleration;
- sector or stage concentration;
- repeat founders and repeat co-investors;
- new vehicle formation;
- partner arrivals and departures;
- thesis drift between stated mandate and observed activity;
- funding, product, customer, or hiring acceleration;
- follow-on, exit, shutdown, and write-off clusters;
- token unlock, governance, and related-party exposure where applicable.

Each signal states the inspected universe and exact event dates. Ongoing monitoring can later compare frozen snapshots, but is outside this phase.

### 4.6 Evidence atlas

Every displayed conclusion links to:

- exact source URL;
- source owner and source class;
- excerpt or structured receipt;
- content hash;
- capture time;
- event or claim time when known;
- subject-binding method;
- evidence state;
- applicable limit or caveat.

## 5. Scoring contract

Four concepts remain separate:

1. Coverage: what ARGUS attempted and what answered.
2. Evidence strength: how strongly a row is bound to the exact subject and claim.
3. Decision score: the result of an archetype-specific methodology.
4. Risk cap: a verified adverse condition that limits the result regardless of positive evidence.

Scoring requirements:

- people, individual investors, investment firms, companies, and agencies receive different axis contracts;
- each axis has deterministic evidence bands and score ceilings;
- missing evidence causes abstention or explicit not-applicable handling, never model freedom to choose any score;
- portfolio inclusion cannot score portfolio quality;
- one relationship cannot establish a cohort;
- notable followers and recent posts cannot score testimonials or reputation;
- ordinary employment cannot score a founder or limited-partner reference;
- bounded absence cannot score fund scale, legal quality, reputation, or portfolio quality;
- provider fields retain provider attribution and their original ceiling;
- exact identity binding is a prerequisite for person-dependent career, portfolio, legal, and scoring evidence.

## 6. Source strategy

### 6.1 Official and public structured sources

The standard route should prefer free or low-cost structured sources where jurisdiction and subject type make them applicable.

- SEC EDGAR APIs provide filing history and company submissions without API keys. Source class: official regulator. Confidence in availability: high. [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- Form ADV and IAPD provide adviser identity, registrations, business, ownership, private-fund, and disciplinary disclosure context. Source class: official regulator. Confidence in relevance to US investment advisers: high. [Form ADV](https://www.investor.gov/introduction-investing/investing-basics/glossary/form-adv) and [IAPD](https://www.investor.gov/introduction-investing/investing-basics/glossary/investment-adviser-public-disclosure-iapd)
- SEC private-fund adviser materials explain the registered and exempt-reporting-adviser boundary. Source class: official regulator. Confidence: high. [Private fund adviser overview](https://www.sec.gov/about/divisions-offices/division-investment-management/private-fund-adviser-overview) and [exemptions guide](https://www.sec.gov/about/divisions-offices/division-investment-management/topical-reference-guide/secg-rules-203-l-1-203-m-1-ia40)
- Companies House exposes UK company and officer records through an official API. Source class: official registry. Confidence: high. [Companies House API](https://developer.company-information.service.gov.uk/)
- BRIS provides an EU business-register search surface across participating countries. Source class: official government service. Confidence: high. [EU business registers](https://e-justice.europa.eu/topics/registers-business-insolvency-land/business-registers-search-company-eu/general-information-find-company_en)
- OFAC's Sanctions List Service provides current sanctions datasets and search resources. Source class: official regulator. Confidence: high. [OFAC Sanctions List Service](https://ofac.treasury.gov/other-ofac-sanctions-lists)
- FINRA BrokerCheck provides registration and disclosure information for US brokers and associated people. Source class: official self-regulatory organization. Confidence: high. [FINRA BrokerCheck](https://www.finra.org/investors/investing/working-with-investment-professional/about-brokercheck)

These sources are jurisdiction-bounded. Not finding a subject in one registry is not evidence that the entity, fund, person, or adverse event does not exist.

### 6.2 Licensed enrichment

Licensed person and company enrichment can accelerate exact identity, employment, and firmographic context. It remains provider-reported unless an exact provider-authenticated social or domain binding succeeds. A provider's name, title, company, industry, size, or funding field does not become ARGUS verification merely because the API returned it.

People Data Labs documents person and company field shapes, including social and employment fields. Source class: provider documentation. Confidence in field availability: high; confidence in any individual returned value remains provider-attributed. [People Data Labs fields](https://docs.peopledatalabs.com/docs/fields)

### 6.3 Direct and counterparty sources

Preferred evidence includes:

- the exact person's current official profile;
- the firm's current team or partner page;
- portfolio-company financing or board announcements;
- regulator filings and registries;
- company investor-relations pages;
- official fund close announcements;
- exact legal documents, court records, and enforcement releases;
- canonical on-chain records where the claimed relationship is address-bound.

First-party sources can establish what the subject says and can bind its own public identity. They do not independently prove outcomes, customer relationships, endorsements, or complete legal standing.

## 7. Cost architecture

The standard route should be a staged acquisition plan, not a fixed fan-out across every provider.

### Stage 0: frozen derivation

- classify entity archetype from strict structural evidence;
- build question packs, ledgers, signals, lenses, chronology, and coverage receipt;
- reuse already-frozen facts and artifacts at their original evidence ceiling.

Marginal provider cost: $0.

### Stage 1: identity and official surface

- resolve the exact account, domain, person, organization, and legal-entity candidates;
- crawl the official site once and reuse that bounded body for team, product, portfolio, legal, and fund-vehicle discovery;
- query applicable free registries and sanctions datasets.

### Stage 2: role-aware discovery

- ask one bounded discovery plan based on the frozen archetype;
- fetch sources deterministically;
- extract multiple typed rows from each fetched artifact;
- do not buy separate searches for questions one official filing or site already answers.

### Stage 3: targeted verification

- verify only the top decision-critical candidates;
- prioritize exact identity, legal entity, current role, decision makers, top portfolio claims, current vehicle scale, and material adverse leads;
- stop when the remaining work cannot change the standard report's decision state within budget.

### Stage 4: analyst synthesis

- synthesize only from validated frozen ledgers;
- keep the analyst inexpensive and prevent it from inventing evidence states or score ranges.

### Standard budget envelope

The following is a product allocation, not a measured provider-price forecast:

- derived intelligence and rendering: $0.00;
- public structured reads and official-site fetches: target $0.20 or less;
- role-aware discovery: target $0.90 or less;
- extraction and exact binding: target $0.45 or less;
- licensed person or company enrichment when needed: target $0.40 or less;
- targeted counterparty verification: target $0.35 or less;
- analyst synthesis: target $0.25 or less;
- retry and difficult-identity reserve: $0.35;
- total standard envelope: $2.90.

Every stage needs an enforced dollar cap and a stop reason in the coverage receipt. Current recordings show discovery volume dominates cost, while the final analyst is comparatively inexpensive. Optimization should therefore collapse discovery and reuse fetched artifacts before reducing the quality of final synthesis.

Premium expansion remains opt-in. It may include exhaustive portfolio reconstruction, founder or limited-partner reference research, deep wallet attribution, paid corporate registries, and large-cohort outcome enrichment. Supplemental spend must be separate from the frozen standard-scan cost.

## 8. Adversarial analysis

### Attack: copied display name or biography

Risk: a fake handle copies a real person's name, company, and profile text. Search returns genuine pages for the real person and attaches them to the fake account.

Defense: quarantine all person-dependent evidence until an exact account-to-person bridge succeeds. Name similarity and a profile-supplied website do not qualify.

### Attack: organization becomes an employee

Risk: a licensed provider finds an employee when the audited subject is a fund brand, then replaces the organization identity with that person's name.

Defense: freeze entity kind before enrichment. People associated with an organization become operator candidates; they never replace the audited organization.

### Attack: portfolio logo or namesake company

Risk: a fund page lists a common company name and ARGUS creates an investment edge to the wrong company.

Defense: require canonical project domain, handle, registry identifier, or equivalent stable binding. Keep name-only rows as candidates.

### Attack: first-party repetition inflates evidence

Risk: multiple pages on one site repeat the same claim and appear to be multiple investments, fund closes, testimonials, or sources.

Defense: group by canonical claim identity and source owner. Multiple receipts support one row; they do not multiply it.

### Attack: provider enum becomes truth

Risk: an API field such as current, verified, employee count, industry, funding, or status is restated as an ARGUS finding.

Defense: preserve provider provenance and evidence ceiling end to end. Provider context can trigger targeted verification but cannot silently become direct verification.

### Attack: failed or bounded search becomes favorable evidence

Risk: no returned AUM, legal result, portfolio company, or adverse event becomes a small-fund, clean, empty-portfolio, or positive-reputation conclusion.

Defense: state is monotonic. Failed, unavailable, partial, bounded, and completed-empty are different. Absence can describe coverage only unless the exact source contract makes the negative complete and bounded.

### Attack: one impressive deal creates a top-tier track record

Risk: a single membership or outcome permits a maximum portfolio-quality score.

Defense: separate authenticity from quality and require a visible cohort, outcome diversity, dates, and denominators for higher evidence bands.

### Attack: organization reaches full clearance through person checks

Risk: person OFAC and legal checks become not applicable for a fund or company, yet completeness removes them and publishes a fully cleared report.

Defense: replace them with exact-entity registration, sanctions, enforcement, insolvency, and litigation coverage. Principals are screened separately when their identities are in scope.

## 9. Implementation state

Implemented in the current revision:

- entity-specific Intelligence Spine for people, individual investors, investment firms, and operating companies;
- separate role-aware question packs and decision lenses;
- strict account-to-person binding for licensed person enrichment and independent Basic Facts identity;
- quarantine of identity-dependent person facts before exact binding;
- organization accounts no longer enriched as people;
- current investment-role routing for titles such as investment director, venture lead, portfolio manager, and fund manager;
- shared strict portfolio relationship binding across collection, scoring, dossier graph, and intelligence;
- exact project-domain binding before a portfolio relationship can be confirmed;
- first-party portfolio claims kept as candidates unless the project identity is bound;
- duplicate investment and fund-scale receipts grouped into one canonical measurement;
- licensed employment and company data preserved as reported context;
- bounded fund-scale absence no longer converted into verified low scale;
- capture time no longer substituted for an unknown fund claim date;
- deterministic I1 through I5 investor evidence bands, with validator-enforced score ranges that keep identity, portfolio inclusion, fund scale, testimonials, and reputation at their proven ceiling;
- exact-entity legal binding and a separate organization sanctions screen for institutional investor and agency reports, while generic project and company follow-ups remain non-gating until their applicable registry route exists;
- persisted Basic Facts question-ledger wording drives matching report surfaces, so answered questions do not reappear and organization reports do not reconstruct person-only gaps;
- audited-project portfolio binding requires the report to carry the PROJECT role, so an investor artifact cannot manufacture its own role from its project handle;
- score-neutral measurements, questions, signals, coverage, chronology, source lineage, and four decision lenses rendered from the saved report;
- focused adversarial fixtures for copied names, wrong social handles, organization accounts, malformed portfolio rows, duplicate receipts, and fund-scale state.

Still required for the ideal product:

- distinct individual-investor, investment-firm, and operating-company scorecards beyond the current calibrated investor profile;
- typed vehicle, investment-event, contribution, outcome, control, conflict, reference, and operating ledgers end to end;
- official registry adapters with jurisdiction routing;
- full operating-company registry, enforcement, insolvency, and litigation coverage beyond the current institutional exact-entity legal and sanctions gates;
- institutional, individual-investor, operating-company, and deliberate-namesake full-pipeline recordings;
- measured standard-route cost telemetry by archetype;
- bounded cohort analytics and dated alpha signals;
- entity and vehicle graph visualization over exact-bound edges only.

## 10. Open questions

1. Which jurisdictions should ship in the first standard registry pack after the US, UK, and EU business-register surface?
2. Which individual-investor axes should be not applicable versus reweighted when the person does not manage a fund?
3. What minimum exact-bound cohort permits a low, medium, high, or exceptional portfolio-quality band?
4. Which outcomes can be derived safely from public records without conflating company success with investor contribution?
5. Which founder-reference questions create enough decision lift to justify their collection cost?
6. Should standard scans enrich the top 5, top 10, or a risk-selected set of portfolio companies?
7. Which legal-entity aliases and principal identities form the minimum complete organization sanctions screen?
8. What spend cap should stop discovery when identity remains unresolved?
9. Which alpha signals are useful in one frozen snapshot without implying a future prediction?
10. What benchmark set best detects false confidence, namesake joins, source repetition, and score inflation across all archetypes?

## 11. Acceptance contract

The entity revision is ready for standard use only when:

- a copied name cannot attach the real person's facts to a different handle;
- a fund brand cannot become one of its employees;
- a name-only portfolio row cannot become a graph edge or score input;
- a partial fund-scale read cannot become a small-fund finding;
- one relationship cannot produce a top portfolio-quality score;
- a person, individual investor, investment firm, and company render different questions;
- the UI renders the exact frozen question ledger rather than reconstructing another one;
- an organization cannot reach legal clearance solely because person checks are not applicable;
- every score has deterministic evidence bounds;
- every lens sees the same full signal set;
- every material sentence opens exact source lineage;
- every bounded read publishes its denominator or floor;
- every provider assertion retains attribution;
- every offline recording and release gate passes;
- the generated collector bundle is rebuilt after server changes;
- measured standard-route scans demonstrate the target economics before a sub-$3 claim is marketed.
