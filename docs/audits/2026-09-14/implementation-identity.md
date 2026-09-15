# Implementation note: identity and entity binding (Group A)

Branch `fix/identity-binding-2026-09-14`, based on `origin/main` 042a271.
Findings are from `deep-dive-review.md` and `lanes/findings-identity.md`, plus
`lanes/findings-orchestrate.md` items 1, 5 and 10.

## Fixed

### ID-1 (P1): official-site token tier bound any lone tradeable address
- `server/adapters/projectToken.ts`
  - `siteDeclaredContractCandidates`: an address counts only when a
    contract / CA / token address / mint label sits next to it. Presentation
    attributes are stripped first, so a copy button's `title` still counts. The
    nearest label must not belong to a different address.
  - `INFRA_CONTRACTS` / `isInfrastructureContract`: a deny-list of canonical
    stablecoins, wrapped natives, routers and program ids per chain
    (Ethereum, OP stack/Base, Arbitrum, Polygon, BNB, Avalanche, Solana).
  - `siteTokenRelatesToSubject`: the DEX row's name or symbol must pass the
    same relevance rule `dexProjectCandidates` uses (`tokenNameRelevance`,
    now shared). The anchors are the display name, handle, declaring domain
    label, or a bio cashtag. An unrelated token counts as an assessed empty,
    not a provider gap.
  - `officialWebsiteScopes` no longer adds verified fact source URLs (blog
    posts, docs). Only profile-record sites and handle-bound registry
    homepages remain.
- Tests: `projectToken.test.ts` suite "official-site declarations bind only the
  subject's own labeled token (ID-1)". It covers USDC as an accepted currency,
  a labeled partner CA, a bare config address, a blog post scope, and a
  positive control.
- Changed existing fixtures: pages that printed a bare address now carry the
  label that the live stonkbrokers page has (`$STONKBROKER CA` beside the copy
  button). The two-token ambiguity fixture names both tokens for the subject.
  The batched-followup fixture labels its second mint. These fixtures encoded
  the permissive behaviour.

### ID-2 (P1): bio description URLs became official scopes
- `server/adapters/x.ts` `twitterapiOfficialUrls` reads only the website-field
  entities. `twitterapiBioUrls` gives `XProfile.bioWebsites`, which becomes
  `profile.bio_websites` (leads) in both `x.ts` and `orchestrate.ts`
  `resolveProfile`. `src/data/evidence.ts` documents the field.
- `projectToken.ts` `verifyIdentity` refuses `official_domain` when the
  CoinGecko record's own X accounts (screen name plus curated X links) do not
  include the audited handle. The record is kept as a `RegistryNamesake`
  lead: a warn step, plus a sentence in the assessed-null check note.
- `profileDisclaimsAffiliation` (unofficial, not affiliated, fan page, parody,
  community-run, and similar): such a profile declares no official scope for
  either the domain gate or the site tier.
- Tests: `projectToken.test.ts` suite "(ID-2)".
  `orchestrate.identity-binding.test.ts` checks that a bio link stays out of
  `officialWebsites`. `x.usage.test.ts` now expects the bio URL in
  `bioWebsites`, not `officialWebsites`; it previously encoded the bug.

### ID-3 (P1): operator and role grammar
- `x.ts`: `roleClaimNegated` rejects a role directly preceded by ex, former,
  previously, past, no longer, not, never, until, retired, and similar.
  `verbBelongsToNextHandle` rejects an after-subject match that crosses a
  comma into the next @handle's verb. Both apply in `operatorClaimInBio` and
  `projectRoleClaimInBio`, so the followings, amplified and reverse-bio lanes
  are all covered.
- A tweet-only reverse-bio row carries `claimSurface: "tweet"`.
  `reverseBioTeamAsWebMembers` and the orchestrate roster map it to
  `model_lead` / `artifact_verified: false` with no first-party handle marker.
  It no longer counts toward `accountVouchesTeam` or identity backing.
- Tests: `operatorAttribution.test.ts` covers "former, negated and
  neighbouring-handle roles never bind (ID-3)" plus positive controls.
  `reverseBioFinder.test.ts` covers "reverse-bio tweet text never yields a
  verified role".

### ID-4 (P1): PDL upgrade laundered a model domain into official_counterparty
- `src/engine/audit.ts` adds `Venture.domain_evidence_origin`.
  `orchestrate.ts` marks Grok affiliation domains `model_lead`, and marks them
  `deterministic` only after a handle-bound archive corroboration.
- `peopledatalabs.ts`: on a name-match upgrade the domain becomes the licensed
  record's `company.website`, or is dropped if the record has none.
- `basicFacts.ts` `verifiedVentureOfficialScopes`: a model-lead domain never
  becomes a scope. A domain that does qualify must pass
  `evidenceUrlMatchesVentureIdentity`, the same check `evidence_url` gets.
- Tests: `peopledatalabs.usage.test.ts` "(ID-4)" and `basicFacts.test.ts`
  "(ID-4)".

### ID-5 / OR-1 (P2): reverseBioMemo never reset
- `orchestrate.ts` calls `resetReverseBioMemo()` at scan start, beside the
  DeFiLlama and follow resets.
- `x.ts`: the memo now has a TTL (10 min) and a cap (64), like
  `lastTweetsMemo`. A discovery with any refused provider read is marked
  `unavailable: true` and is never kept.
- Tests: `reverseBioFinder.test.ts` "reverse-bio memo is scan-bounded and
  never stores an outage".

### ID-6 (P2, flag-gated): entity-fact reuse keyed by handle only
- `x.ts` and `orchestrate.ts` freeze `profile.x_user_id`. The entity
  write-back stores `facts.identity` (user id, created_at, display name,
  website domain). No schema change: the data lives in the existing JSON
  `facts` column.
- `basicFacts.ts` `storedEntityIdentityMatchesProfile`: `loadReusableBasicFacts`
  refuses a row whose stored identity contradicts the live account and emits
  a warn step. Rows written before this change reuse as before.
- Tests: `basicFacts.test.ts` "(ID-6)".

### ID-7 (P2): wayback promotion on display-name match
- `wayback.ts` `archivedAffiliation(..., subjectHandle)` returns
  `handleBound`. That requires the exact `@handle` in the text, or a bare
  x.com/twitter.com profile link read from the markup; a tweet link does not
  count.
- `orchestrate.ts` promotes to deterministic only when `handleBound` is true.
  Otherwise the tie stays a corroborated lead with an explicit namesake note.
- Tests: `wayback.test.ts` "(ID-7)".

### ID-8 (P2): recoverOfficialSiteBindings
- `basicFacts.ts`: recovery skips a resolved, active profile, since the live
  link-hub path already ran `resolveLinkHubWebsite` at intake.
  `documentLinksExactHandle` now requires a bare profile URL as a link target
  (attribute, JSON string or markdown link) and rejects `/status/` links and
  prose mentions.
- `linkHub.ts` `handleBacklinkPattern` rejects `/status/` links.
- Tests: `basicFacts.test.ts` "(ID-8)" and `linkHub.test.ts` "(ID-8)".

### ID-9 (P3): unbounded reads and global fetch
- `publicWeb.ts` exports `readBoundedResponseText` (the same streaming cap as
  `fetchPublicText`).
- `projectToken.ts`: the site tier uses `deadlineFetch` plus a 400 KB bounded
  read. `teampage.ts` index and page reads are capped at 1.5 MB.
  `sitecheck.ts` `readBody` now defaults to a 1.5 MB cap.
- Not changed: these paths keep their own transports (retry, redirect-offsite
  and content-type logic) instead of moving to `fetchPublicText`. Moving them
  would change SSRF and redirect behaviour across many tests, and #364 tracks
  that separately.
- Tests: `publicWeb.test.ts` "bounded response reads (ID-9)" and
  `projectToken.test.ts` "the official-site declaration read is bounded
  (ID-9)".

### ID-10 (P3): String(error) in emitted steps
- `teamEnrichment.ts` `enrichmentErrorCode` emits timeout, aborted,
  transport_error or provider_error.
- Tests: `teamEnrichment.test.ts` "(ID-10)".

### OR-10 (P3): intake cache keys fall back to display name
- `x.ts`: `findTeamOnSite` and `enrichTeamIdentities` take the audited handle,
  and their cache keys are now `team-site-v3:<handle>:...` and
  `enrich-v2:<handle>:...`. The orchestrate call sites pass `ctx.handle`.
- Tests: `orchestrate.identity-binding.test.ts`.

### OR-5 (P3): handle casing
- `orchestrate.ts` `normalizeAuditHandle` lowercases a bare handle once at
  `runAuditWithLedger` entry.
- Tests: `orchestrate.identity-binding.test.ts`.

## Skipped or partial
- ID-3(d), dating a current role with `period`/`asOf`: needs a schema and UX
  decision and was not in the brief's fix list.
- ID-9: the paths were bounded but not rerouted through `fetchPublicText`
  (reason above).

## Shared-file edits other groups should know about
- `server/orchestrate.ts`: scan-start resets, `normalizeAuditHandle` at
  `runAuditWithLedger` entry, `resolveProfile` (`bio_websites`,
  `x_user_id`), affiliation corroboration, reverse-bio roster mapping, and the
  entity write-back `identity`.
- `src/data/evidence.ts` (`bio_websites`, `x_user_id`),
  `src/engine/audit.ts` (`Venture.domain_evidence_origin`), and
  `server/publicWeb.ts` (new `readBoundedResponseText` export).
