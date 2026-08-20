# ARGUS intelligence reasoning contract

Status: implemented on the relationship-aware rescan branch.

## Product promise

ARGUS does not produce a pile of search results. It produces an auditable argument:

1. What exact subject and claim are being assessed?
2. What was directly observed?
3. Who originated each supporting statement?
4. Which origins are genuinely independent?
5. What evidence pushes against the emerging read?
6. What remains unknown because it was not established?
7. What exact new evidence would change the conclusion?

The score, evidence ledger, relationship graph, and prose must describe the same case.

## Collection logic

### One atomic claim at a time

Every material claim keeps five fields attached throughout collection:

- entity: the exact person, organization, product, token, contract, or wallet;
- predicate: the role, relationship, event, metric, or control fact asserted;
- direction: who is related to whom;
- time: when the claim was true or observed;
- source owner: the subject, a counterparty, a registry, a direct observation, an independent publication, or an aggregator.

A source can establish only the part it actually controls. A project team page establishes the project's published roster. It does not independently establish legal identity, present employment, ownership, wallet control, or an investor relationship.

### Collection contracts

Each research workstream now carries a collection contract:

- source strategy;
- minimum independent origins;
- whether first-party material must remain labeled as a claim;
- whether counter-evidence must be searched;
- an explicit acceptance rule;
- an explicit rejection rule.

A workstream cannot close as decision-grade simply because an adapter executed. It closes when a frozen check records the outcome and its source posture satisfies the contract. A bounded checked-empty result is a completed search outcome, not favorable evidence.

### Relationship discipline

Relationship discovery and relationship adjudication are separate stages.

The system first finds candidates. It then classifies each edge as core team, advisor, backer, partner, ecosystem, team affiliation, associate, or unresolved candidate. Organizations never enter a people roster. A person's personal affiliation never becomes a project relationship without project-side or counterparty evidence. Aliases are reconciled before headcounts or scores are calculated.

## Evidence independence

ARGUS counts origins, not citations.

Three pages on one official domain are one first-party origin. Two provider rows containing identical frozen content are one origin. Syndicated copy does not become corroboration because it appears under several URLs.

The deterministic evidence posture is:

- Directly observed: a bound direct read, such as fixed-block chain data.
- Independently corroborated: at least two qualifying external origins support the same bound claim.
- Externally supported: one qualifying counterparty, registry, direct-read, or independent-publication origin.
- Multi-provider context: several external data providers report context, without claiming editorial independence.
- First-party evidence only: the subject is the sole origin.
- Bounded collection only: the record describes search coverage rather than a subject fact.
- Single-source context: one non-qualifying or source-reported origin.
- No complete source lineage: the claim cannot be promoted.

The posture is visible in the decision story. Citation count remains visible for auditability but no longer masquerades as corroboration.

## Reasoning sequence

For every scored axis and every prominent narrative claim, ARGUS reasons in this order:

1. Observation: the concrete saved fact or measurement.
2. Source qualification: who produced it and whether the origin is independent.
3. Counterpoint: the strongest credible evidence or limitation pushing the other way.
4. Decision implication: why this changes the axis or diligence decision.
5. Reversal condition: the exact evidence that would change the read.

Missing evidence is not negative evidence. A provider failure is not a clean result. An explicit no-token project is not a token-conduct concern. Product existence, live operation, traction, and transparency are separate questions.

## Story structure

The report tells one case in five beats:

1. Governing thesis: the narrow conclusion the evidence earns.
2. Strongest proof: the best-supported fact, with evidence posture.
3. Strongest pressure: the most decision-relevant countervailing fact.
4. Decisive unknown: the open question that prevents a stronger conclusion.
5. What changes the read: a falsifiable recheck condition.

A headline names the governing tension. It does not average every fact into generic language. A concern names the missing disclosure, metric, binding, or receipt instead of saying only that evidence is thin.

## Non-negotiable failure rules

ARGUS must abstain, downgrade the workstream to partial, or preserve a candidate outside scoring when:

- exact identity is unresolved;
- a relationship depends on name similarity, ticker similarity, or nearby biography language;
- several citations resolve to one origin;
- a first-party claim has not received the required external check;
- the source owner cannot establish the asserted relationship;
- support and counter-evidence cannot be reconciled;
- lineage references are missing, ambiguous, or malformed;
- the collection ran but no frozen outcome was recorded.

These rules apply across projects, founders, investors, agencies, tokens, and future subject types.
