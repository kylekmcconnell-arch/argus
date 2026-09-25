# People and team investigation expansion

Related issue: [#537](https://github.com/kylekmcconnell-arch/argus/issues/537). Route: canonical ARGUS product repository. Branch: `feat/people-team-investigation`. Base: main through #548. Implementation follows the user's instruction to build the proposed people/team diligence and access integrations without interrupting for questions.

## Implemented behavior

Relationships now retain distinct relationship kinds, professional functions, employment capacity, internal/external uncertainty, historical/current claims and source provenance. The taxonomy covers founders, employees/executives, board directors/observers, owners/governance, advisors/mentors, contractors/fractional staff/volunteers, equity/token investors and unspecified investors, lenders/grants/sponsors, incubators/accelerators, infrastructure/credits, integration/distribution/referral/co-development partners, customers/pilots/users, community/promoters/agencies, legal/accounting/audit services, traders/holders/market makers/liquidity providers/exchanges/custodians/validators, launchpads, acquirers/sellers and administrators. Unrecognized or uncertain roles remain unresolved. An operating director is not automatically a board director. A customer logo does not establish payment or endorsement.

A company report now includes a team-responsibility and dependency view. Sourced job titles are distinct from demonstrated delivery. Advisors do not count as delivery owners; former roles do not count as current responsibility. Functions are diligence lenses, not a mandatory headcount checklist. No person-score averaging or new scoring floors were introduced.

Investor/backer claims accompanied by credits/programme evidence create a reconciliation question. They do not prove fraud or disprove a separately documented investment. Source passages, contradictions and local identity limits remain visible. A company-fit analytical hypothesis requires relevant relationship/contribution evidence and retains limits and falsification conditions.

People receive a bounded career evidence inventory, source periods separate from capture dates, prioritized contradictions and missing-contribution questions, plus reference-check preparation. Professional lenses now also cover commercial, operations/people, security/research, legal/compliance, token/mechanism design, community/promotion and advisory responsibility. Private work, military affiliation, education or prestige do not imply ability or character.

Background discovery retains the existing four-query/three-page ceiling. A sourced previous venture directs the outcome question; role functions choose work questions; a credits lead can replace the final generic concern search with a financial-backing reconciliation search. It saves the questions/reasons and stop reason. This is bounded adaptive discovery, not exhaustive recursive private investigation.

## Person evidence feeding a company report

An analyst can attach an exact saved person-report link from the same workspace to a saved roster member. Both reports are loaded through the existing exact-version authorization path. The roster must have a first-party-bound X account matching the person report; matching names or guessed accounts are refused. The source must be a person report, and its career evidence is re-derived from account-bound facts rather than accepting a supplied projection. A pseudonym with attributable work does not need a legal name.

Attachment makes no provider call, reserves no paid research allowance and does not rewrite the parent report. It uses the existing immutable-completion `person_research_runs` storage. A subsequent full company audit can read up to eight exact account identities and their explicitly attached person versions within the same organization. It revalidates the source payloads and freezes relevant historical evidence into the new company report; dated person evidence can enter the score-neutral team thesis. Narrow supplements do not trigger this read. Old employment is not treated as present employment, and legal/wallet discovery leads never enter this path. No global name join, control inference or score import occurs.

## New access integrations

### OpenAlex

- Server-only `OPENALEX_API_KEY`.
- One fixed-host author search, maximum five candidate records, for an established public-name context with a relevant technical/research role.
- Authorization header, no credential in URL, no redirects/pagination.
- Source response hash and retrieval date retained; candidate identity is always unresolved.
- $0.001/search list-price estimate before allowances, not a settled invoice.
- References: [authentication](https://help.openalex.org/api/authentication/), [search](https://help.openalex.org/api/searching/), [authors](https://help.openalex.org/data/authors/).

### CourtListener

- Server-only `COURTLISTENER_API_TOKEN`, with appropriate commercial entitlement arranged by the owner.
- One fixed-host v4 existing-RECAP search for the quoted public name plus organization context; maximum five retained results, no pagination.
- Returned case name, court, filing date and snippet are discovery leads. Name matches do not attribute a case; no-result searches are not background clearance.
- Credentials in Authorization header; no redirects. **No PACER purchasing, document-fetch purchase endpoint, payment or reference outreach exists in this change.**
- Contract cost is unknown: receipts retain `estimatedUsd: null`; legacy numeric usage accounting includes an explicit unknown-cost note rather than claiming the request was free.
- References: [access](https://wiki.free.law/c/courtlistener/help/api), [v4 changes](https://wiki.free.law/c/courtlistener/help/api/rest/v4/migration-guide).

Both providers have explicit not-configured, not-applicable, unavailable, empty and candidate-result states. Requests are read-only, at most seven seconds each, concurrent, respect a supplied collection deadline, cap response bodies at 512 KB and do not retry. Full-person audits use only remaining collection time; specialist candidates are excluded from facts, scores and speculative legal conclusions. Background research calls are metered against the exact parent report. Keys appear as optional configuration in the existing health endpoint; a configured key is not a successful access probe.

Companies House, Serper, GitHub, SEC, Wayback and existing on-chain integrations are retained. No new subscriptions, accounts, provider credentials, restricted databases or paid bulk research were created. The owner is obtaining access separately.

## Persistence, exports and rollout

New optional dossier JSON fields: `teamDiligence`, `personInvestigation`, `diligenceProviders`. Optional background fields retain the research plan, provider receipts and linked person evidence. No database migration is required; existing organization scopes and immutable supplemental completion rules remain in force.

Saved report rendering reads frozen evidence without provider calls. Full HTML/document export preserves relationship scope, source contradictions, career gaps, linked-person provenance and specialist identity limits. The brief PDF includes the leading follow-up question and directs readers to the full source record. Presentation revision: `2026-09-25.2`. The research cache version changes so old generic searches do not masquerade as new question coverage.

Acceptance includes exact-account vs namesake joins, no-key/no-call behavior, failures and malformed responses, bounded URLs/results, credit-vs-investment claims, former/advisory delivery scope, separate capture/event dates, role-specific questions, tenant-scoped person-evidence reuse, zero-spend attachment and export preservation. These cases are included in the report acceptance matrix.

This handoff records implementation, not a production deployment or successful live provider integration. Required checks and the existing protected release workflow remain the deployment gates. Rollback removes the new projection/collectors and rebuilds generated bundles; immutable saved evidence remains intact.

## Remaining operational acceptance

Local verification: 536 test files passed, with 5,494 passing tests and one expected failure. The final timestamp/type guard changes also passed 13 targeted attachment/linkage tests. Type checking passed; report acceptance passed 229 tests; offline canaries passed 7/7 with no unexpected requests; calibration passed 21/21 with no drift. Source-truth validation and diff whitespace checks passed. The production build passed with chunk-size and mixed-import warnings. No live-provider or visual acceptance is implied by these checks.

- Owner supplies credentials and confirms CourtListener entitlement; test narrowly bounded access before relying on coverage. PACER stays manual/unintegrated.
- Run fresh authenticated person/company acceptance with real sources and measure actual latency/cost. Offline fixtures cannot establish live provider coverage.
- Review the new layouts in the production/preview interface, including mobile and export pagination. Existing UI primitives and rendering tests do not establish visual acceptance.
- Reference interviews, voluntary founder-document ingestion, full historical research and any scored non-X person-audit expansion are separate work. This change prepares questions and exact saved-evidence attachment; it does not pretend those interviews or documents exist.
