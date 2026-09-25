# Identity, person reports and company edge

Related issue: #537. Canonical route: kylekmcconnell-arch/argus. The three changes form one evidence pipeline: establish the subject, investigate the right questions, then distinguish observations from analysis.

## Research that informed the design

- The [Hades LinkedIn company page](https://www.linkedin.com/company/hades/) lists hades.com and a mining business. Its [official site](https://www.hades.com/) describes mineral extraction and laser drilling. That supports excluding those employer records from a differently anchored privacy company. Several unrelated Hades privacy results exist; the exact Hades report/account was not supplied, so no result was assumed to be the user's target.
- [Zama's protocol documentation](https://docs.zama.org/protocol/protocol) describes FHE computation alongside threshold MPC key management. Its [litepaper](https://docs.zama.org/protocol/zama-protocol-litepaper) also describes a ZK input-validation role. The design therefore supports hybrids instead of forcing one exclusive privacy label. Performance and competitive tables published by a vendor remain that vendor's claims.
- [RAILGUN's documentation](https://docs.railgun.org/wiki/learn/privacy-system/zero-knowledge-cryptography) describes a ZK-based privacy system. A pool/mixer design and a cryptographic primitive are different dimensions, so each report must explain what is hidden, from whom, and under what assumptions rather than merely label it “ZK”.
- [GitHub's contributions reference](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference) documents how activity is attributed and displayed. Profile counts, forks, stars and unavailable private work cannot substitute for inspecting the person's actual contribution.
- The [PACER Case Locator](https://pacer.uscourts.gov/help/faqs/what-pacer-case-locator) is a federal case index, not an exhaustive worldwide background check. Reports require jurisdiction, exact attribution and procedural status; no-result searches never become clean-record certifications.
- [National Archives guidance](https://www.archives.gov/veterans/military-service-records) distinguishes public archival records from restricted recent service files. The research contract uses relevant public service information and attributable biographies, with missing information explicit. It does not imply access to restricted records or infer character from affiliation.

Sources were read on 2026-09-24/25. These are methodology references, not a completed Hades investigation.

## Company identity implementation

The X-profile website is the preferred anchor. Model-discovered employer URLs are inputs to a separate public-page verification stage, not proof. The stage fetches LinkedIn employer pages, extracts only the explicit Website field, compares it to the anchor, checks directly recognizable business conflicts and requests a person-specific role passage. First-party site or exact company-post evidence can support a candidate independently, without validating a separately guessed LinkedIn account.

Every candidate receives a dated `matched_company`, `rejected` or `unresolved` receipt with source URLs, excerpts and content hashes. A model's assertion of the correct website cannot pass a fetched conflicting Website field. Unavailable pages and budget exhaustion remain unresolved. Company matches remain sourced employment claims and do not automatically gain verified person or scoring status. Rebrands and alternate domains need additional evidence; different domains are not silently equated. The business classifier detects only explicit supported category conflicts; unknown descriptions remain unknown.

The merge path no longer upgrades a person across sources solely through a matching display name. Provider management rows require matching LinkedIn identity before enriching an existing row. Contradictory or name-only candidates remain separate.

Limits are 48 candidates and eight unique public-page retrievals per cold intake, with a shared cache. No paid LinkedIn account, scraping subscription or credentialed background database was added. Existing safe public transport supplies timeouts, response limits and network protections.

## Person report blueprint

The shared application frame remains, while the report's body and research questions change for individuals.

1. **Public identity:** established account-to-public-name links versus unresolved/pseudonymous identity, with proof and conflicting claims. Public aliases are retained. No leaked data or speculative private identity exposure.
2. **Role-specific assessment:** founder, engineer, investor, executive and professional lenses can coexist. An engineer-founder gets both technical contribution and venture execution assessment. An investor is assessed on personal responsibility and attributable outcomes rather than inheriting the firm's portfolio.
3. **Career and venture history:** sourced roles, periods, contribution, outcomes, collaborators and recurring relationships. The local relationship evidence graph retains names that lack unique identifiers as unresolved nodes; they do not join the shared graph.
4. **Engineering:** bound GitHub account, inspected repository scope, original work and maintenance. Private/unavailable work and sampled repositories are explicit limitations.
5. **Credentials and public service:** education, awards and relevant public military history, with dates, attribution and distinction between claimed and institutionally confirmed information.
6. **Public records and control:** exact attribution, procedural status, disclosed wallets and conflicts. Transfers or shared infrastructure do not prove ownership, guilt or common control.
7. **Role-fit thesis:** a bounded analytical hypothesis with exact source references, limitations, counter-evidence and what would change the assessment. Analysis never changes identity, legal attribution, wallet ownership or scores.

The bounded supplemental person search retains four queries and three page reads, but its work query now follows the person's recorded role. Broader full-scan questions live in the existing authenticated and metered research ledger. Missing sources are evidence gaps, not automatic penalties.

## Company report blueprint

“What's their edge?” appears immediately after the report header/scores and before the longer diligence brief. It separates six source-backed questions:

- How the product works.
- Privacy guarantees or operating assumptions and limitations.
- What is implemented versus planned, and what version/audit is relevant.
- The company's claimed technical or business advantage.
- Dated evidence supporting the advantage.
- Alternatives, tradeoffs and replication difficulty.

Possible additional advantages and defensibility are separate analytical hypotheses. They require source IDs, an explicit limitation and a falsification condition. A new model call is bounded to 36 frozen source excerpts, 2,400 output tokens and a 25-second shared provider deadline; it runs only for full audits with eligible evidence. No independent semantic verification is claimed merely because citations validate. Personal legal and wallet facts are excluded from speculative thesis generation.

Each focused question has its own stable ID. A generic product fact cannot close the mechanism or moat questions. The report preserves unknowns for old saved versions instead of inventing new research. Saved JSON, shared views and the short PDF carry the new frozen analysis without rescoring history; the full source details stay in the saved report.

## Acceptance cases

- Three same-name employees at a mining employer are excluded from a privacy company's candidate roster even if the model claims their employer website matches.
- A blocked LinkedIn company page is unresolved, not a match or an adverse finding.
- A matching website with a clearly incompatible business description is rejected.
- An official-site pseudonymous builder survives without an invented legal identity or guessed LinkedIn account.
- Namesakes with conflicting profiles do not merge or gain verified provenance.
- A coding founder and an investor receive different assessment lenses.
- Unbound collaborator names remain local unresolved graph nodes.
- A generic product answer leaves specific mechanism and edge questions open.
- Mixed cryptographic architectures are supported; missing evidence does not manufacture a mechanism or moat.
- Analysis with invented source IDs or missing limitations is rejected; retained source contradictions travel with the hypothesis.
- New analysis does not enter scoring or graph-control evidence and does not trigger on a narrowly scoped supplement.

## Release and remaining live acceptance

Final local validation: 519 test files passed, with 5,404 passing tests and one expected failure. Type checks and the production build passed. The source-of-truth check, all seven offline canaries and all 21 calibration cases passed with no calibration drift. The generated collector adds five modules and removes none; much of its large text diff is module reordering. The build retains chunk-size and mixed static/dynamic import warnings.

Implementation and offline acceptance were completed locally. A real Hades report correction still requires the report URL or exact X handle and a fresh version, not edits to historical evidence. Live collection, restricted databases and production deployment were not performed. Release uses protected repository checks and the existing deployment workflow. Rollback removes the new collectors/projection and rebuilds the server bundle while leaving frozen evidence intact.

## Hades public-source diagnostic

Further discovery surfaced `@hades_privacy`, `@shlok_dm` and `hades.exchange` together in third-party search results. These are discovery leads, not a replacement for the exact saved report. Direct public reads of both X profiles returned 403, so their current bios and website bindings were not verified.

The public `hades.exchange` homepage and its directly linked client asset were read without executing code or submitting a transaction. The homepage presents private cross-chain/address asset movement. The client uses a backend service for quotes and transfer orders, but this does not establish the underlying privacy protocol, custody model, cryptographic guarantees or ownership of that service. No accessible technical documentation was established in this bounded read. A JavaScript dependency contains the word “mixer”; it is an animation interpolation option, not evidence that the financial product uses a mixer. No architecture was inferred from keyword hits or from the absence of FHE/ZK terms in a client bundle.

The correct early report result for this evidence is therefore: advertised private asset movement; mechanism and guarantees unresolved; advantage and moat unestablished pending protocol documentation, implementation linkage, operator/custody details and comparable evidence. This diagnostic does not identify shlok beyond the public alias or assign any LinkedIn profile to them.

The browser URL security policy blocked the synthetic local-file preview. Component rendering and interaction regressions were tested, but no visual browser QA is claimed.
