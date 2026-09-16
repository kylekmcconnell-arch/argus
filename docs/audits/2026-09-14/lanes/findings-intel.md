# Lane: evidence projection / coherence / point-in-time intelligence / dossier / provenance / investor-fund adapters

Checkout: /Users/kyle/Documents/ARGUS/.claude/worktrees/review-main (origin/main 042a271). Four throwaway probes (*.probe-intel.test.ts) were run with `npx vitest run` and deleted; two sub-reviews (point-in-time intelligence; trust graph + GitHub forensics) ran and deleted their own probes. Worktree is clean. Nothing below duplicates the KNOWN OPEN list or F01-F17.

## Summary (ranked)

| # | Sev | Title | Repro |
|---|-----|-------|-------|
| 1 | P1 | Namesake/substring entity binding: another fund's AUM or fund close becomes the audited investor's verified fund scale (and portfolio) | confirmed |
| 2 | P1 | OFAC name screen: stale checked-empty for the pre-basic-facts name survives when the refresh for the resolved name is unavailable; new-name artifact dropped by dedup | confirmed |
| 3 | P1 | Monid management merge promotes a Grok-guessed X handle/GitHub into a verified team identity on a display-name match; becomes a TEAM edge in the trust graph | confirmed |
| 4 | P1 | Browser graph cache (argus:graphstore) not org-scoped; backfilled into whichever org signs in | code read |
| 5 | P1 | GitHub 401/403/429/timeout on repos/orgs list renders as "no public repositories" / affiliations checked-empty | confirmed (sub-review) |
| 6 | P1 | api/github-forensics mines forks; upstream maintainers' emails recorded as hard email: ties; fork detection dead | code read |
| 7 | P1 | Display names and tickers are graph bind keys: namesake collision -> medium tie to a FAIL report -> cap 69 | confirmed (sub-review) |
| 8 | P1 | Intelligence Spine integrity gate strips collector `profile:`/`project-token:` answer refs -> spurious high lineage gap, identity never resolved | confirmed (sub-review) |
| 9 | P2 | fundScaleSourceCount counts URL variants of one page as independent sources -> I3 exceptional from one manager page | confirmed |
| 10 | P2 | Zero-count measurements convert unresolved/unavailable questions to partial | confirmed (sub-review) |
| 11 | P2 | Year/month-only round dates parsed as exact days: wrong latest round | confirmed (sub-review) |
| 12 | P2 | Coverage map says "measured" for reported_context-only domains | confirmed (sub-review) |
| 13 | P2 | Entity scorecard axis "established" from an unrelated constituent domain | confirmed (sub-review) |
| 14 | P2 | api/resolve-github binds on one-directional twitter_username or substring name; feeds #6 | code read |
| 15 | P2 | Client reconcile: partial versions labelled server_collected; direct mention -> hard/AVOID | confirmed (sub-review) |
| 16 | P2 | GitHub per_page=30 sample presented as account totals; drives fork-ratio "unsupported" | code read |
| 17 | P3 | Checklist snapshot sums sourceCount across re-runs of one check | confirmed |
| 18 | P3 | Challenge-verdict withheld for any report with >64 source artifacts/findings/catalog rows | code read |
| 19 | P3 | mergeProjectedFact upgrades lead->verified keeping press-only sources; merges across attributionScope | code read |
| 20 | P3 | Augment legacy listing keyed by display label | code read |
| 21 | P3 | Hygiene bundle | code read |

## P1

### 1. Namesake/substring entity binding (fund scale + portfolio)
Files: server/adapters/portfolio.ts:396-401 (`matches`: compact(a).includes(compact(b)) when both >=5 chars), :402-425 (direct_subject entity with name=directName, aliases=directAliases, domain=subject site); server/adapters/fundScale.ts:113-118 (entityNamesMatch substring), :462-470 (entityMentioned = any alias contained in segment), :1000-1001 (fundName/investorEntityName = row.entity.name, i.e. the SUBJECT's name, not the name the page used); strict gate src/lib/fundScaleEvidence.ts:545-548 compares subjectName/fundName/profile names, all now equal; consumer server/agent.ts:2455-2475.
Mechanism: Grok lead fund_name "Sequoia Capital China" (or "Sequoia Heritage", "Paradigm Shift Capital", "Pantera Capital Management"). portfolioEntityForLead decides it IS the subject "Sequoia Capital" by substring and rewrites the entity to the subject; supportsFundScaleClaim accepts every sentence about "Sequoia Capital China" because it contains alias "Sequoia Capital"; the artifact is minted with fundName "Sequoia Capital".
Repro (confirmed): subject @sequoia "Sequoia Capital", lead "Sequoia Capital China" with reuters.com + bloomberg.com pages ("...completed fundraising for its ninth venture fund at $9 billion" / "...announced Venture Fund IX, a new $9.05 billion venture fund") -> `executed · 1 verified`, two fund_scale_confirmed artifacts fundName "Sequoia Capital", direct_subject, press_corroborated, sourceCount 2, isStrictFundScaleArtifact(...,{subjectHandle, profile}) = true -> agent.ts:2467-2470 I3 = exceptional. HongShan's fund scored as Sequoia Capital's.
Portfolio manifestation (code read): same matches(); supportsPortfolioRelationship (portfolio.ts:735-739) accepts "Sequoia Capital China led the round in X" via containsEntity on "Sequoia Capital"; artifact carries the subject's own investorEntityDomain so portfolioRelationshipBinding (src/lib/portfolioRelationshipBinding.ts:60-68) passes -> I2 counts HongShan's portfolio.
Fix: exact normalized equality in portfolioEntityForLead (or the token-boundary rule at portfolio.ts:646-657, additionally rejecting extra qualifying tokens); record attributedEntityName (name the page used) on the artifact and require it to equal fundName in the strict gate; in supportsFundScaleClaim treat an alias that is a strict prefix of a longer capitalised phrase as a different entity. Regression test with a subsidiary/namesake name. Confidence: high.

### 2. OFAC name screen: stale checked-empty survives an unavailable refresh; new-name artifact dropped
Files: server/orchestrate.ts:4421-4426 (refresh when resolved name changed after basic facts); server/adapters/offchain.ts:437-453 (refresh records a second ofac-sanctions-name observation), :230-265 (unavailable when list fails); server/checks.ts:370-379 (STATUS_PRIORITY checked-empty 4 > unavailable 2), :504-516 (strongest wins; sourceCount summed); offchain.ts:47-56 (addArtifact dedup key provider+kind+sourceUrl+subjectName; OFAC person artifact has no subjectName and a constant sourceUrl).
Repro A (confirmed): display name "Alice Smith" Confirmed -> checked-empty. Basic facts resolves "Bob Jones"; OpenSanctions 503 on refresh -> unavailable. snapshot() reports ofac-sanctions-name: checked-empty, "screen completed against 6,002 OFAC SDN names with no match", decisionCritical true — for a name never screened. Same shape for us-legal-history and news-press.
Repro B (confirmed): both succeed and Bob Jones IS listed: checklist = finding, SanctionsNameLead added, but the only sanctions_screen artifact still says "No exact ... match for Alice Smith", match no_match; the Bob Jones exact_name artifact was deduped away; sourceCount 2 for one list.
Fix: supersede earlier observations for the three name screens when the refresh runs for a different name (add supersede(id) to PersonCheckTracker or key observations by screened name); put the screened name in subjectName on sanctions artifacts and hash it. Confidence: high.

### 3. Monid management merge promotes a model-guessed handle into a verified identity
Files: server/orchestrate.ts:3775-3791 (existing found by display name only; sets evidence_origin deterministic, artifact_verified true, provider monid, and identity_link_evidence_origin deterministic when Monid has a LinkedIn — without clearing handle/github from Grok rows at :1291-1305); downstream src/data/dossier.ts:319-343 (identityGrounded), :407-424 (TEAM edge keyed by handle), server/basicFactsProjection.ts:760-820 (founder/executive facts).
Repro (confirmed): Grok row {name "John Smith", handle "@johnsmith_wrongguy", github "github.com/someone-else", model_lead} + Monid "john smith, CFO, linkedin.com/in/john-smith-cfo" -> row becomes deterministic/verified with the guessed handle and GitHub intact; assembleDossier emits {src "@uniswap", dst "@johnsmith_wrongguy", type TEAM, artifact_verified true} into Panoptes. Display name is the bind key; the wrong account bridges into every future report (#7).
Fix: on a name-only merge copy only title/linkedin/priorCompanies; strip handle/github/developerProfiles unless identity link was already deterministic; never let a model-lead handle survive on a verified row. Confidence: high.

### 4. Browser graph cache not org-scoped; backfilled into the current org
Files: src/graph/store.ts:27 (KEY "argus:graphstore"), :174-197 (hydrateCommunityGraph: local entries absent from the org's /api/graph set are "local only" and POSTed via syncContribution), src/auth.tsx:63 (window.fetch wrapped with the current session token), :265-275 (signOut never clears the cache); api/graph.ts:44-47 (POST accepted for any analyst of the current org).
Scenario: org A analyst audits 20 subjects on a shared machine, signs out; org B member signs in; on load A's contributions are POSTed into org B's graph_contributions and RingAlert/subjectConnections/graph pages in B read A's subjects and verdicts.
Fix: key the store by organization, stamp organizationId on contributions and backfill only matching rows, clear on sign-out/org switch. Confidence: high.

### 5. GitHub list failures render as empty
Files: server/adapters/github.ts:48-57 (ghJson returns null for 401/403/429/5xx like 404), :253 (?? []), :255-260, :289-293 (claim "GitHub account has no public repositories"), :398-406 (affiliations-associates checked-empty).
Repro (sub-review): public_repos 40, repos 403 -> originalCount 0, claim grade unsupported "no public repositories"; orgs 403 -> "no public organization memberships" recorded checked-empty. Outage presented as measured empty.
Fix: discriminated result from ghJson; skip repo-derived fields and claim check when unavailable (or public_repos>0 && repos.length===0); record affiliations as unavailable on failed list calls. Confidence: high.

### 6. github-forensics mines forks; upstream emails become hard ties
Files: api/github-forensics.ts:85-100 (fork:true repos not filtered; first 6 by push), :104-124 (org path: no author= filter), :97-101 (parent never in list endpoint, so forks[] always empty); src/components/GithubForensics.tsx:35-38 records email: entities; src/graph/network.ts:397 email: = hard tie.
Scenario: org with five forks of Uniswap/v2-core -> "17 commit authors, 9 leaked a personal email" all upstream engineers; each gmail becomes an email: node; any other project forking the same upstream shares a hard tie -> AVOID banner. "Copied code" section never renders.
Fix: exclude r.fork repos from mining (or fetch /repos/{full} for parent, pass author=, exclude commits older than fork created_at); never record email: ties from forks. Confidence: high.

### 7. Display names and tickers as graph bind keys
Files: src/graph/network.ts:101-103, src/engine/audit.ts:1011-1017 (name fallback key), src/data/dossier.ts:417-419, src/engine/audit.ts:938-940 ($ticker), server/adapters/trustgraph.ts:639-646, src/engine/audit.ts:552-566 (trust_graph_medium_link), src/engine/profiles.ts:22 (cap 69).
Repro (sub-review): A's team page "John Smith" (no handle) -> key johnsmith; failed B's team @johnsmith -> same node -> medium tie -> A capped 69. Two KOLs promoting different $PEPE tokens share $pepe -> adverse -> counter-eligible on all axes (server/agent.ts:3438-3441).
Fix: non-binding name:<slug> keys for name-only people; promotions keyed token:<chain>:<address> with non-binding ticker: fallback. Confidence: high.

### 8. Integrity gate strips deterministic answer refs
Files: src/intelligence/buildPointInTimeIntelligence.ts:2192-2198 (non-fact refs kept), :4296-4315 (sanitize allows only measurement ids / fact ids / fact: prefix; anything else = lost lineage -> resolved -> partial), :4383-4398 (intelligence_integrity_gap high); upstream server/adapters/basicFacts.ts:4379-4386 appends profile:<provider>:<handle> and project-token:<id>; src/data/evidence.ts:858 documents these as legitimate.
Repro (sub-review): project.official_identity answered with ["identity-1","profile:twitterapi:argusfixture"] -> resolved then rewritten partial with "failed the Intelligence Spine integrity gate"; top signal in every lens is a spurious high lineage failure. Every project scan with a resolved profile or verified token hits this.
Fix: whitelist profile:/project-token:/team: prefixes in sanitize or resolve them to snapshot sources in buildQuestions; add a fixture. Confidence: high (both paths re-read).

## P2

### 9. fundScaleSourceCount counts URL variants of one page
Files: server/adapters/fundScale.ts:768-772 (fetchSourceOnce key = new URL(url).toString(); /fund, /fund/, /fund?utm_source=x are three fetches), :914-918 (sourceCount = distinct document.url, no normalization/content-hash dedup; server/publicWeb.ts:597 returns the original url), server/agent.ts:2463-2470 (sourceCount>=2 -> authoritativeOrCorroborated -> exceptional at >=$500M), src/lib/fundScaleEvidence.ts:565-567.
Repro (confirmed): one first-party manager page cited three ways (same contentHash) -> three fund_scale_confirmed artifacts, same claim id, each fundScaleSourceCount 3, all strict. One $850M self-reported page reads as "multi-source scale verification" -> I3 exceptional instead of solid; UI lists three sources.
Fix: count distinct (registrable domain, sourceContentHash) or normalized URL; dedupe artifacts by content hash. Confidence: high.

### 10. Zero-count measurements -> partial
Files: buildPointInTimeIntelligence.ts:1600-1601 (audit_lead_count / corroborated_audit_count emitted at 0/0), :1618, :1642-1646, :2234-2243 and :2278-2282 (relatedMeasurements.length>0 forces partial except project.control).
Repro (sub-review): empty audit scan + ledger completed_empty -> project.audit partial on audit_lead_count=0; ledger failed (outage) + same snapshot -> also partial; licensed funding.rounds [] -> project.funding partial.
Fix: only informative measurements (non-zero or explicit answersQuestion flag) move state; never move out of unavailable on measurements alone. Confidence: high.

### 11. Year/month-only round dates parsed as exact days
Files: buildPointInTimeIntelligence.ts:1647-1666 (Date.parse over YYYY / YYYY-MM / YYYY-MM-DD, sorted as instants; days_since to 0.1 day); producers document mixed precision (server/adapters/monid.ts:554-560).
Repro (sub-review): [{date "2024", Series B $50M},{date "2024-03-01", Seed $2M}] -> latest = Seed $2M; lone "2024" -> 2024-01-01T00:00:00Z, days_since 947.5; "Q1 2024" -> NaN silently dropped.
Fix: precision-aware parsing, interval ordering, native-precision output, gap signal for unparseable dates. Confidence: high.

### 12. Coverage "measured" from reported_context only
buildPointInTimeIntelligence.ts:2318-2328 — coverageState = measured whenever measurementCount>0 and no open question, ignoring evidenceState (identity/market/liquidity/chronology exposed; one analyst contradiction row -> identity: measured). Fix: derive from strongest measurement state. Confidence: high.

### 13. Entity scorecard axis established from an unrelated domain
src/intelligence/entityScorecards.ts:145-153 (any verified measurement in the axis's domain set), :69-81 (axes bundle governance/control/legal etc.). Repro (sub-review): one verified legal_entity fact -> "Governance and adverse record" established with no sanctions/legal screens. Fix: require per-constituent-domain coverage; partial when a critical constituent question is open. Confidence: high.

### 14. resolve-github one-directional binding
api/resolve-github.ts:91-101 (twitter_username === handle alone scores 2 = medium; name match is includes either way, "Li" matches "Alice Li"); contradicts server/adapters/github.ts:6-14,160-172; src/components/PersonGithub.tsx:47 records into forensics. Scenario: github.com/vitalikbuterin2 with twitter_username VitalikButerin -> resolved -> emails recorded as hard ties. Fix: require subject-side back-link or bidirectional pair; full-token equality; no record below high confidence. Confidence: high.

### 15. Client reconcile authority
src/graph/store.ts:217-229 (server_collected whenever a reportVersionId exists, including partial versions the server refuses to publish, api/audit.ts:203-215); src/graph/network.ts:454-455 (direct -> hard) vs server trustgraph.ts:466-484 (medium); RingAlert.tsx:18-23,41. Repro (sub-review): A lists @mallory ASSOCIATES_WITH; Mallory FAIL partial -> client severity avoid. Fix: server_collected only when completeness complete; tieStrength(other key) for direct; client reconcile as research context. Confidence: high.

### 16. Truncated repo sample as totals
server/adapters/github.ts:250-283,289-293 — per_page=30 by push; originalCount/forkRatio/stars/notableRepos/lastActivity rendered as account facts; forkRatio>=0.8 -> unsupported while public_repos may be 200. Fix: paginate or label as sample and skip the grade when repos.length < public_repos. Confidence: high.

## P3

### 17. Checklist sourceCount summed across observations
server/checks.ts:511 — after a name refresh OFAC shows sourceCount 2 for one list (confirmed); notes concatenated. Fix via #2 supersede.

### 18. Challenge-verdict withheld for rich reports
api/challenge-verdict.ts:134-139 (MAX_FROZEN_ARRAY_ITEMS 64), :279 (sourceArtifacts/axisEvidenceCatalog/checkRuns -> decision+provenance; findings/report -> decision), :379-386 (decision always requested), :441-451, :648-657. axisEvidenceCatalog may hold 400 rows (api/_provenance.ts:199); >64 catalog rows, artifacts or findings -> second opinion never runs. Fail-closed by design but thresholds disable it where it matters (mechanism certain; frequency medium; challenge-verdict.test.ts:284-300 shows the 65-item case).

### 19. mergeProjectedFact status/scope merge
server/basicFactsProjection.ts:433-460 — key is (predicate, normalizedValue); same.status becomes verified from lead (single press retrieval, basicFacts.ts:3413) with press sources retained as supports; attributionScope/attributedEntity/questionId of `same` kept, so a direct-subject projection absorbed into a related_entity fact is skipped by reconcileQuestionLedger (:485,496) and agent.ts:3157. Fix: include attributionScope in the key; mark merged press sources as corroboration.

### 20. Augment legacy listing keyed by display label
api/augment.ts:246-249 — legacy query uses normalizeSubjectRef(subjectLabel) from caller-supplied display text; namesakes in one org see each other's legacy augmentations. Org-scoped; violates "display name is not a bind key". Fix: drop the fallback or require owner reconciliation.

### 21. Hygiene bundle
- buildEntityPointInTimeIntelligence.ts:1142 — case-sensitive includes("legal"|"sanction"); LegalCaseNameLead/SanctionsNameLead routed to reputation.
- buildEntityPointInTimeIntelligence.ts:651 — window.asOf set to departure END date, not capture time.
- buildPointInTimeIntelligence.ts:2043-2053 / entity :747-752 — failed+completed_empty -> unresolved; entity maps partial->unresolved, project maps partial->partial; outage + empty repair reads as completed.
- buildPointInTimeIntelligence.ts:1700 — days_since_last_post republishes a Date.now()-based collector field (x.ts:2987) with asOf = profile_captured_at.
- trustgraph.ts:685-694,709 — screen severity/risk from adverse connections regardless of tie strength -> agent.ts:3438-3441 counter-eligible from a weak tie.
- Scale cliffs: trustgraph.ts:30-31,168-169,590 (>1,000 authoritative rows -> trust-graph-connections permanently unavailable); api/graph.ts:9 READ_LIMIT 500 + store.ts:28 CAP 150 -> silent sample, false "no connections".
- securityAudits.ts:301-308 (isSubjectPage accepts any parent domain: foo.github.io -> every github.io page official_subject); :286 (auditor regexes over raw HTML; agent.ts:1949-1952 arms exceptional ceiling on two incidental hits); :228 (subdomains kept: app.uniswap.org never anchor-matches uniswap.org).
- api/_sanctions-core.ts:88,110 and api/sanctions.ts:13 — .slice(0,40) silently truncates while available:true (callers send <40 today).

## Looked suspicious but correct (do not re-check)
- _sanctions-core: partial family load -> empty set -> available:false; v3 cache only complete loads; Solana case-preserved; signal-scoped loads bypass cache.
- offchain.ts single-run freeze: failed/partial -> unavailable; provisional single-name news -> unavailable; person screens gated by resolvedRealName; org subjects get only the exact legal-entity screen. Only the refresh interplay (#2) is broken.
- projectFactCoherence: only research facts on collision-prone predicates; retained facts keep bound supports only; corroborated collapses when <2 independent hosts; ledger refs pruned; runs before and after projections.
- _provenance strict lineage: artifact identity, absence evidence never sole support/counter, PROJECT bands range-checked, INCOMPLETE requires governing_score null (engine always sets it, audit.ts:855), roles reconciled, bundle RPC checks child counts. Non-atomic persistProvenance is #362-adjacent (skipped).
- case-brief.ts: human CRUD, no LLM; org-filtered; anchors validated; revision conflicts surfaced; archived read-only.
- challenge-verdict.ts: packet from exact stored version only; refs validated against complete artifacts; nothing persisted but panel cost; question is data-only. Only #18.
- _funding-core.ts: backward-only; truncated pages flagged; unreadable earliest tx fails closed; null balance != zero.
- basicFactsProjection founder funding: minted only from venture-domain-bound record, value-prefixed with venture name, "venture financing" qualifier (:1004-1040); DeFiLlama/holder/unlock facts bind by canonical gecko id or contract+chain; backers capped with explicit floor caveat; audits verified only from auditor-domain corroboration anchored to subject contract/domain.
- projectIdentity.ts: suspended accounts inherit PROJECT identity only from a verified official_identity fact on an official-domain source; social hosts rejected.
- dossier.ts: model-lead rows excluded from graph audit; portfolio edges require portfolioRelationshipBinding; affiliated-fund nodes keyed by handle/domain.
- Point-in-time: one governing open-question set across coverage/lenses/gap rules; no Date.now(); ath sign handled; model-lead findings never verified sources; namesake protocol/funding/holder/unlock/RDAP/company rows withheld with gap signals; circulating>total and >72h skew withheld.
- Trust graph server path: set-intersection ties (no traversal/cycles); FAIL subject listing @alice does not bind Alice; qualification requires active version + server_collected on version and every check + complete coverage honouring stale_at; PROVISIONAL dropped; seenVersions + unique (org, canonical_key) prevent double counting; api/graph POST forces client_submitted and strips verdict nodes.
- augment.ts: org-scoped reads/writes; SSRF guard with manual redirect re-validation; GitHub corroboration needs the profile's own back-link; relationship claims never auto-publish.
- GitHub 404 -> checked-empty and 409 empty repo -> empty commits: correct; squatter suppression and gold/claimed/weak resolution sound.
