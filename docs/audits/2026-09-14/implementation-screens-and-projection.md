# Implementation note: screens, entity binding and projection (group C)

Branch `fix/screens-and-projection-2026-09-14`, based on `origin/main` 042a271.
Findings from `docs/audits/2026-09-14/deep-dive-review.md`, lane `findings-intel`.
INT-4 (browser graph cache org scoping) belongs to the client group and is not touched here.

## Fixed

| Ref | Change | Files | Regression test |
| --- | --- | --- | --- |
| INT-1 (P1) | Investor entity binding is exact identity (only trailing legal-form suffixes and a leading "the" are ignored). A page mention that is the prefix of a longer capitalised phrase ("Sequoia Capital China") is a different entity; vehicle continuations ("Paradigm Fund III") and headline verbs are allowed. The page's own spelling is frozen as `attributedEntityName`; the strict gate requires it to equal `fundName` (or the exact handle). First-person copy on a verified manager domain may omit it. `attributedEntityName` is added to the analyst packet field allowlist. | `server/adapters/portfolio.ts`, `server/adapters/fundScale.ts`, `src/lib/fundScaleEvidence.ts`, `src/data/evidence.ts`, `server/agent.ts` (one allowlist entry) | `fundScale.test.ts` "never binds a namesake or regional affiliate's fund to the subject", "freezes the page's own spelling"; `portfolio.test.ts` "does not read a regional affiliate or namesake as the subject"; `fundScaleEvidence.test.ts` "requires the page to name the bound fund itself" |
| INT-2 / INT-17 | Check observations carry `screenedName`; a later screened name supersedes earlier observations for that check, so a checked-empty for the display name cannot outrank an unavailable refresh for the resolved name and source counts do not sum across names. OFAC, EU/UN/UK, CourtListener and name-matched press artifacts carry `subjectName`; the refresh drops evidence and name leads frozen for the superseded name. | `server/checks.ts`, `server/adapters/types.ts`, `server/adapters/offchain.ts` | `offchain.test.ts` "supersedes the earlier name's screens..." (both repro A and B); `checks.test.ts` "supersedes a name screen recorded for a different screened name" |
| INT-3 | Monid name-only merge copies title, LinkedIn and prior companies; handle, GitHub, developer profiles, avatar and a model LinkedIn are stripped unless the row's identity link was already deterministic or first-party bound. | `server/orchestrate.ts` (Monid merge block only) | `managementRoster.test.ts` "never promotes a model-guessed handle or GitHub..." and "keeps a first-party-bound handle..." |
| INT-5 / INT-16 | `ghFetch` returns ok / not_found / unavailable. Unavailable repo list: assessment `repoSampleState: "unavailable"`, no emptiness or ratio grade. Affiliations record unavailable on failed list calls. Outage during resolution records `code-footprint-github` unavailable. A per_page window shorter than `public_repos` is labelled a sample and fork-ratio / all-forks grades are withheld. | `server/adapters/github.ts`, `src/data/evidence.ts` | `github.test.ts` three new cases; `provider-keyed-outcomes.test.ts` updated (see below) |
| INT-6 | Forks are never mined for commit authors; fork parents are resolved from the repository record (bounded to 4 lookups). | `api/github-forensics.ts` | `github-forensics.test.ts` "never mines upstream commit authors from forks" |
| INT-14 | Resolution requires the subject's own bio back-link; name match is full-name equality; GitHub-side-only claims are returned as a `lead` with `available: false`, so the panel never records them. Cache key bumped to v3. | `api/resolve-github.ts` | new `api/resolve-github.test.ts` |
| INT-7 | `canonicalEntityKey` name fallback is `name:<slug>`; promotions key `token:<chain>:<address>` with a `ticker:<symbol>` fallback. `name:`, `ticker:` and `$` keys are weak in `tieStrength`, excluded from cabal named-vias, and rejected by the medium-link cap gate. | `src/engine/audit.ts` (key helper, promotions key, `weakKey` regex only), `src/graph/network.ts` | `engine.test.ts` "never caps on a non-binding name or ticker tie..."; `reconcile.test.ts` "never binds on a display-name slug or a ticker" |
| INT-8 | The integrity gate resolves `profile:`, `project-token:`, `team:` and `venture:` answer refs against the frozen evidence (exact handle/provider, verified token id, verified roster/venture rows). | `src/intelligence/buildPointInTimeIntelligence.ts` | "keeps deterministic collector answer references through the integrity gate" |
| INT-10 | Only informative (non-zero, non-blank) measurements move a question; an unavailable question moves only on a deterministic (non reported-context) measurement. | same | "does not let a zero-count measurement move an unavailable or unresolved question to partial" |
| INT-11 | Precision-aware round date intervals (year, month, quarter, day), ordering by interval end, native-precision output with a precision measurement, days-since only for day precision, `funding_round_unparseable_date_count`. | same | "orders indexed rounds by precision-aware intervals..." |
| INT-12 | Coverage is `measured` only with a non reported-context measurement; otherwise `reported`. | same | "reports, rather than measures, a domain whose only measurements are reported context" |
| INT-13 | Scorecard axis `established` requires a verified measurement, every constituent domain with a tracked question closed or deterministically measured, and no open critical constituent question. | `src/intelligence/entityScorecards.ts` | `entityScorecards.test.ts` "does not establish a bundled axis from one constituent domain..." |
| INT-9 | Source fetches dedupe on a canonical URL (no fragment, tracking params, trailing slash, www); `fundScaleSourceCount` counts distinct (registrable domain, content hash); artifacts dedupe by content hash on the same registrable domain. | `server/adapters/fundScale.ts` | "counts one page cited under several URL spellings as one source", "does not let two URL spellings of one press page corroborate each other" |
| INT-15 | `personContribution` is `server_collected` only when `completeness_state === "complete"`; a direct mention is rated by the key's tie strength. | `src/graph/network.ts`, `src/graph/store.ts` (one condition in `personContribution`) | `reconcile.test.ts` "rates a direct mention by its key strength and only trusts complete versions" |
| INT-19 (partial) | Attribution scope is part of the projected-fact merge key. | `server/basicFactsProjection.ts` | "never merges a direct-subject projection into a same-value related-entity fact" |
| INT-20 | Legacy augmentation rows are read only when the label normalizes to the exact canonical ref. | `api/augment.ts` | `augment.test.ts` "reads legacy display-keyed rows only when the label is the subject's own canonical key" |

## Tests changed because they encoded the old behaviour

- Fund-scale fixtures in `fundScaleEvidence.test.ts`, `agent.test.ts`, `agent.investor-calibration.test.ts`, `buildPointInTimeIntelligence.test.ts`, `buildEntityPointInTimeIntelligence.test.ts`, `Report.private.test.tsx` now carry `attributedEntityName` (the strict gate requires it).
- `engine.test.ts`: four expectations of bare name keys (`paradigm`, `receipt labs`, `solana-labs`, `company-x`) now expect `name:` keys.
- `provider-keyed-outcomes.test.ts`: `githubAffiliations` returns `{ rows, unavailable, detail }`; a malformed orgs body is now unavailable rather than `[]`.

## Skipped

- INT-18 (challenge-verdict 64-item cap): raising the array cap moves the withholding to the evidence character budget (`enforceEvidenceBudget` nulls whole artifacts), and deterministic sampling still leaves the domain `bounded`, which the fail-closed contract withholds. Which rows a sample may drop for which challenge domain is a product decision.
- INT-19 second half (mark merged press sources as corroboration rather than support): changes source relation semantics consumed by several gates; left for a focused change.
- INT-21 hygiene bundle: not attempted in this pass.
- INT-4: owned by the client group.

## Shared-file edits other groups should know about

- `server/agent.ts`: one entry (`attributedEntityName`) appended to `SOURCE_ARTIFACT_FIELDS`.
- `src/graph/store.ts`: one condition in `personContribution` (INT-4 owner edits this file).
- `src/engine/audit.ts`: `canonicalEntityKey`, the promotions key, and the `weakKey` regex inside `sharedCapsTriggered`; finalize untouched.
- `server/adapters/types.ts`: optional `screenedName` on `CheckObservation`.
- `src/data/evidence.ts`: optional `attributedEntityName` on source artifacts; optional `sampledRepos` / `repoSampleState` on `GithubAssessment`.
