# ARGUS intelligence and report architecture audit

**Date:** 2026-08-20  
**Scope:** collection, entity resolution, source binding, scoring semantics, report storytelling, report display, provider status, rescans, and regression coverage.  
**Reference cases:** MultiHopper, Clutch Markets, Dynex namesake collision, PONS/DEX-only token identity, explicit tokenless projects, and provider-outage/no-record cases.

## Governing thesis

ARGUS should publish one decision story derived from one frozen evidence graph. Every visible roster, graph edge, score, question count, and narrative sentence must resolve back to the same canonical entity, relationship, claim, artifact, collection outcome, and saved report version.

A provider is retrieval plumbing. A source is a publisher or primary record. A relationship is a directed claim. A missing record is scoped to the provider and query that returned it. None of those concepts may substitute for another.

The report should answer five questions in this order:

1. **What is the current call?**
2. **What is the strongest proof?**
3. **What is the strongest pressure or confirmed adverse finding?**
4. **What decisive fact remains unknown?**
5. **What evidence would change the call?**

Everything else is an audit trail.

## Immediate defects confirmed

### 1. Relationship truth diverged between collection, scoring, graph, and display

The collector replaced the roster with a cloned canonical copy before namesake demotion, identity enrichment, and deduplication completed. Later code continued mutating the old array. Basic Facts and company enrichment then appended additional rows after the supposed freeze. Scoring dropped relationship class and provenance and reclassified from role text.

This made it possible for the report table, graph, dossier, and score to disagree about the same person.

The first correction set now:

- finalizes the roster in place so every consumer retains the same array identity;
- repeats finalization after Basic Facts and at the last pre-graph mutation boundary;
- carries entity kind, relationship class, claim provenance, and handle provenance into the scoring packet;
- derives P1 from core-team relationships while allowing P4 to inspect the full relationship ledger;
- treats claimant-side bios as claimant declarations, not project confirmation;
- prevents a generic personal “VC” bio from proving investment in the audited project;
- prevents an existing name match from swallowing a row with a different stable handle;
- recomputes stale relationship classes after stronger evidence merges.

The next schema revision should replace the current row with a versioned edge:

```ts
interface RelationshipEdge {
  id: string;
  subjectEntityId: string;
  relatedEntityId: string;
  relationshipType:
    | "core_team"
    | "advisor"
    | "backer"
    | "partner"
    | "ecosystem"
    | "team_affiliation"
    | "associate"
    | "candidate";
  direction: "subject_to_related" | "related_to_subject" | "mutual";
  claimState:
    | "project_declared"
    | "claimant_declared"
    | "third_party_reported"
    | "counterparty_confirmed"
    | "independently_confirmed"
    | "historical"
    | "rejected";
  currentness: "current" | "former" | "unknown";
  artifactIds: string[];
  validFrom?: string;
  validTo?: string;
}
```

### 2. Names are discovery keys, not identity keys

A normalized X handle, LinkedIn profile, registry identifier, domain ownership proof, or explicit source-backed alias bridge may merge identities. A similar name may create a review cluster; it must not alone collapse two people.

The MultiHopper regression contract is:

- Kuj Crypto / Alex Kujavesky / Alexander Kujavsky resolve to one person only when a stable handle, LinkedIn profile, or explicit alias bridge connects them;
- @jra_xyz, @enigmafund, @kujcrypto, and a verified BD manager are core team;
- Superteam DE is an ecosystem organization;
- lovable_dev and SSR remain candidate or associate absent a project-bound relationship;
- Strategic Super R is not a project backer merely because a person’s bio contains VC language;
- roster, graph, P1, P4, dossier, and narrative expose the same entity IDs and classes.

### 3. “No record” was displayed at the wrong scope

The X public probe records the probed handle in its cost metadata. A failed probe for lovable_dev could become “1 source has no record of this subject” on the MultiHopper report.

The corrected rule is:

- if the failed probe target is not the audited handle, suppress it from the subject notice;
- if the audited identity is already established by another source, suppress the redundant X probe notice;
- otherwise show a retryable source-availability note, never a subject-risk warning;
- only explicit human-readable X pages stating “account suspended” or “this account does not exist” establish a terminal account state.

Saved reports remain immutable. A new scan creates the corrected notice.

### 4. Completed empty checks were counted as unanswered

A bounded search returning no qualifying record is a completed answer for that exact question. It may be important context, but it is not an open collection gap.

Canonical collection outcomes:

| State | Meaning | Decision treatment |
|---|---|---|
| `matched` / `confirmed` | A qualifying artifact bound the claim | May support or contradict |
| `checked_empty` | The named source/query completed with no qualifying record | Completed coverage; never a global absence |
| `unavailable` | Provider, transport, auth, or timeout prevented completion | Retryable collection health |
| `ambiguous` | Multiple candidates or conflicting hard anchors | Human review; no bind |
| `not_collected` | Work was not attempted | Open scope |
| `not_applicable` | The question does not apply | Neutral; excluded from denominator where methodology allows |

The dossier now excludes `checked-empty` from its open count and derives its open questions from the same saved intelligence question ledger used by the decision view.

### 5. Evidence quality was confused with score performance

A low axis score does not imply weak evidence. Strong evidence can prove poor performance. Many citations do not imply independent origins. A provider count is not a publisher count.

Required source artifact fields:

```ts
interface SourceArtifactIdentity {
  publisherEntityId?: string;
  publisherDomain?: string;
  controlGroupId?: string;
  canonicalDocumentId?: string;
  sourceContentHash?: string;
  claimId: string;
  sourceRole:
    | "subject_first_party"
    | "counterparty_first_party"
    | "regulator"
    | "chain_record"
    | "independent_reporting"
    | "aggregator"
    | "search_lead";
  publishedAt?: string;
  capturedAt: string;
}
```

Independence is computed from publisher control groups and claim binding. The same syndicated story through three providers is one lineage. A counterparty can authoritatively confirm that it entered a relationship; it is not independent proof that the relationship was successful.

The report no longer labels evidence “strong” from score ratio plus citation count. It shows the saved evidence posture and cited artifact count.

### 6. Neutral absence was written as misconduct

Four narrative classes must remain separate:

- `adverse_finding`: verified harm, contradiction, disqualifier, or material pressure;
- `evidence_limit`: proof is incomplete or lacks sufficient independent origin;
- `neutral_not_applicable`: no token, no outside backer, or another non-required absence;
- `collection_failure`: ARGUS could not complete a source operation.

Only adverse findings and resolved contradictions belong under **Main concerns**. Evidence limits belong under **What remains unverified**. Collection failures belong under **Source problems**. Neutral absences belong in operating facts or methodology.

The first report correction set separates weak axes from Main concerns and prevents an assessed-null no-token or no-backer result from being framed as a warning when no contradictory claim exists.

### 7. The report contained several competing reports

Before this audit, the primary decision summary appeared after a full dossier, six dimension chapters, a research plan, basic facts, provider ledgers, and token detail. The page repeated verdict, score, question, source, and relationship stories across multiple components. Dimension chapters could render band endpoints as earned points—for example, 94/94—in conflict with the real 15/16 contribution.

The new information architecture is:

1. Subject and governing result.
2. Sticky report navigation.
3. One decision summary.
4. One weighted scorecard with direct links to exact axis evidence.
5. A concise evidence read: thesis, strongest proof, strongest pressure, decisive unknown, and recheck condition.
6. Operating facts, token/product/usage facts.
7. Exact score basis and three next checks.
8. People and relationships.
9. Confirmed findings and unverified leads.
10. A collapsed **Detailed case file and audit trail** containing the complete dossier, research plan, provider receipts, and technical records.

Dimension chapters are removed from the primary report until they consume actual earned and available points. The complete research record remains accessible under one disclosure instead of competing with the decision brief.

## Source authority and gaps

| Domain | Preferred authority | Secondary corroboration | Never sufficient alone | Current gap |
|---|---|---|---|---|
| Project identity | official account + verified official domain | registry, counterparty, independent reporting | display name, symbol, search slug | typed identity receipt across all collectors |
| Team | project-side team page/post plus stable person ID | claimant bio, LinkedIn, independent reporting | name-only search, generic occupation bio | current/former status; explicit alias bridges |
| Product | live official product, repository/release, direct protocol data | independent technical reporting | social posting alone | releases, repo concentration, user activity |
| Token | first-party contract declaration + exact chain/address; direct chain reads | CoinGecko, DexScreener, Sourcify after binding | symbol/name/slug | typed provider-independent token receipt |
| Funding/backers | filing or project/counterparty confirmation | independent round reporting | aggregator/name match | direct counterparty confirmation |
| Usage | direct protocol/product metrics with dates | independent analytics | token volume or posting cadence | users, transactions, retention, fee quality |
| Governance/control | direct chain reads, Safe owners/threshold, governance system | verified docs | generic audit badge | Snapshot/Tally/Safe control integration |
| Legal/company | official registry/filing bound by domain/entity ID | independent reporting | same-name filing | broader registry coverage and freshness |
| Adverse | regulator, court, chain incident, source-bound primary record | independent investigation | anonymous lead or claimed source count | publisher-control independence and cap safety |

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

## Provider-independent protocol binding

CoinGecko should be one registry, not the canonical join key. DeFiLlama admission still depends on a CoinGecko ID in the current pipeline, which strands DEX-only tokens and tokenless protocols.

The target `ProtocolBindingReceipt` is a tagged union:

```ts
type ProtocolBindingReceipt =
  | {
      method: "matched_chain_contract";
      scope: "project_and_token";
      protocolSlug: string;
      canonicalChain: string;
      canonicalAddress: string;
      providerChain: string;
      providerAddress: string;
    }
  | {
      method: "matched_protocol_gecko_id";
      scope: "project_and_token";
      protocolSlug: string;
      canonicalGeckoId: string;
      providerGeckoId: string;
    }
  | {
      method: "matched_official_x_and_domain";
      scope: "project";
      protocolSlug: string;
      canonicalHandle: string;
      canonicalDomain: string;
      providerHandle: string;
      providerDomain: string;
    };
```

Deterministic precedence:

1. exact normalized chain + contract;
2. exact CoinGecko ID unless the canonical-chain contract explicitly conflicts;
3. exact audited X handle **and** verified official domain for project-only evidence;
4. otherwise unbound or conflict.

Name, symbol, ticker, and slug are discovery keys only. An X+domain project match may admit project TVL/fees/funding, but must not mutate token deployments or imply token-to-protocol identity. Sourcify proves code at an already-bound EVM address; it cannot establish project identity or token semantics by itself.

## Full-rescan contract

The current `fresh=1` path bypasses subject orientation but leaves many 24-hour subject searches, Basic Facts reuse, short-lived X memos, and durable prior facts eligible for reuse. It is not yet a full rescan.

Target run-scoped policy:

```ts
interface AuditCachePolicy {
  mode: "standard" | "full";
  subjectSearch: "reuse" | "refresh";
  priorFacts: "reuse" | "identity_seed_only";
  referenceData: "reuse";
  scanId: string;
}
```

A full rescan must:

- skip subject-cache reads;
- make live provider calls and overwrite caches only on success;
- never substitute stale cached evidence after a failed live request;
- prevent prior facts from closing current questions or entering current scoring;
- allow a historical exact identity only as a routing seed, marked non-current;
- scope in-process memos by `scanId` so concurrent scans cannot share subject results;
- preserve shared reference indexes such as sanctions lists;
- persist the collection policy and requested/completed timestamps;
- state that it may use the full investigation budget and still finish partial at the normal time ceiling.

This work is a release blocker for labeling the UI action “Full rescan.”

## Regression and backtest release gate

### Frozen cases

1. **MultiHopper relationship case** — canonical aliases, core team, ecosystem org, associates, false VC, candidate exclusion, cross-surface roster equality.
2. **Clutch Markets identity case** — company/token/project binding without CoinGecko authority; candidate-source failure suppressed from subject warnings.
3. **Dynex namesake case** — same-name SEC filing never binds without entity/domain/identifier proof.
4. **PONS DEX-only token** — exact chain+contract admits protocol facts without CoinGecko.
5. **Tokenless protocol** — exact X+domain admits project fundamentals; token axis is neutral/not applicable.
6. **X terminal-state case** — only explicit visible terminal copy establishes suspension/nonexistence.
7. **Provider outage case** — timeout/503 is unavailable, not no-record.
8. **Source independence case** — duplicate URLs, providers, syndicated copies, and publisher control groups do not inflate origin count.
9. **Hard-cap case** — caller-supplied source counts and a single arbitrary URL cannot trigger AVOID.
10. **Stale-cache rescan case** — full rescan records zero subject-cache hits and uses current artifacts only.

### Metamorphic tests

For every frozen case, duplicate/reorder inputs, change transport provider, add irrelevant citations, and replay at a frozen clock. Entity IDs, relationships, origin counts, axis applicability, score bands, and governing story must remain unchanged.

### Release thresholds

- zero false hard caps in the frozen corpus;
- zero cross-section roster or question-count contradictions;
- 100% valid visible internal anchors;
- high-precision core-team classification; ambiguous rows default to candidate;
- checked-empty never counted open;
- provider unavailability never counted adverse;
- every score contribution displays identical earned/possible points across all surfaces;
- 320, 375, 768, and desktop layouts pass keyboard, scroll, long-handle, reduced-motion, and print checks.

## Adversarial review

The stricter model will intentionally produce fewer confident relationships and fewer “strong evidence” labels. That is the correct tradeoff. Early projects often have only first-party evidence; ARGUS should display “project-declared” rather than pretend independent confirmation. Provider-independent joins reduce CoinGecko coupling but can introduce new collision paths if chain normalization or domain ownership is sloppy, so hard-anchor conflicts must fail closed.

Collapsing audit material improves decision readability but can hide detail from power users. The remedy is a clear, keyboard-accessible disclosure with preserved exact receipts—not another full report in the primary flow.

A full rescan costs more and can expose provider instability that cached scans masked. It should never promise completeness; it promises current collection attempts and honest partial state.

## Open questions

- Which relationship states may affect P1 and P4, and at what confidence threshold?
- Should tokenless projects reweight P3 out of the denominator or display a fixed N/A contribution while preserving rubric comparability?
- Which claims require regulator/chain authority versus independent publisher control groups?
- What is the safe minimum independent-origin contract for hard caps?
- Which provider reference caches need explicit age limits?
- Should report wording be frozen as a deterministic story object, or may the analyst model phrase a fixed ordered set of claim IDs?
- What manual review workflow should resolve ambiguous alias clusters and protocol-binding conflicts?

## Recommended next implementation order

1. Finish the run-scoped full-rescan policy and stale-cache backtest.
2. Add typed protocol-binding receipts and remove CoinGecko-only DeFiLlama admission.
3. Version the relationship-edge schema and freeze a roster hash consumed by score, graph, dossier, and UI.
4. Replace record/provider counts with publisher-control source independence.
5. Derive hard-cap eligibility entirely from bound saved artifacts.
6. Make tokenless P3 truly not applicable and show the effective score denominator.
7. Expand the frozen end-to-end corpus and enforce the release thresholds above in CI.
