# Lane: subject identity, orientation, entity binding — findings

Checkout: `/Users/kyle/Documents/ARGUS/.claude/worktrees/review-main` (origin/main 042a271). All line refs are on this checkout. Probe test `server/adapters/identity.probe-identity.test.ts` was written, run (7/7 confirmed the behaviours below), and deleted.

## Summary (ranked)

| # | Sev | Title | Confirmed by |
|---|-----|-------|--------------|
| 1 | P1 | Any single tradeable contract printed on an official page binds as *the project's* token (USDC/WETH/partner CA) | repro test |
| 2 | P1 | Bio-entity URLs become "official domain" scopes; a fan/impersonator account binds the real project's CoinGecko token via `official_domain`, and the registry's contradicting official X is never checked | repro test |
| 3 | P1 | Reverse-bio / followings / amplified operator binding: "ex", "former", "not", and verbs belonging to the *next* handle all bind; a tweet question binds a stranger as founder, artifact_verified + subject_first_party | repro test |
| 4 | P1 | PDL name-match upgrade turns a Grok-supplied `domain` into an `official_counterparty` host for basic-fact verification | code trace |
| 5 | P2 | Reverse-bio memo is process-lifetime with no reset: outage-empty or stale results replay for every later scan of that handle | code trace |
| 6 | P2 | Knowledge-base fact reuse is keyed by @handle only — handle reuse/rename replays the previous holder's verified facts (flag-gated) | code trace |
| 7 | P2 | Wayback affiliation corroboration promotes to artifact_verified on a *display-name* match (display name is not a bind key) | code trace |
| 8 | P2 | Official-site recovery (`recoverOfficialSiteBindings`) sets identity_confidence=Confirmed from a model-cited brand-stem domain; backlink regex accepts tweet links | code trace |
| 9 | P3 | Unbounded `response.text()` reads on attacker-controlled HTML in projectToken/teampage/sitecheck; site-declared token fetch uses global `fetch` (no deadline) | code trace |
| 10 | P3 | `String(error)` from twitterapi enrichment emitted into scan steps | code trace |

Things checked that turned out correct are listed at the end.

---

## 1. P1 — Site-declared token tier binds any lone tradeable address on the official page

**Files:** `server/adapters/projectToken.ts:667-697` (`siteContractCandidates`), `:954-1128` (`resolveSiteDeclaredOnPage`), `:1131-1160` (`collectSiteDeclaredToken`), `:1801-1836` (call site in `collectProjectTokenIdentity`).

**Mechanism.** After CoinGecko and DexScreener searches fail the identity gate, the last tier fetches every official scope (profile website, every `official_websites` entry, every `official_subject` verified basic-fact source URL, plus registry homepages) and regex-extracts *every* `0x…`/base58 string in the raw HTML. It then asks DexScreener which ones have pairs; if **exactly one** address has a market it is bound as `ProjectTokenSnapshot{verified: true, verification: "official_domain"}` with `name`/`symbol` taken from the DEX row. There is no check that the token's name/symbol relates to the subject, no check that the page *calls it* the project's contract (no "CA:"/"contract" label requirement, unlike `declaredTokenFromBio`), and no exclusion of well-known stablecoin/wrapped/router addresses.

**Failure scenario (repro'd).** `@acmepay` (a payments app with no token) has `https://acmepay.example/` whose page says "We accept USDC. Contract: 0xA0b8…eB48". CoinGecko/DexScreener searches return nothing. Result: `ctx.evidence.projectToken = { symbol: "USDC", verified: true, verification: "official_domain" }`, `project-token-identity` check `confirmed` with note "$USDC is published as this project's contract on its own verified site", `state: "executed"`. Any of the following pages do the same: a docs page listing a partner's token, a dapp frontend whose inline `__NEXT_DATA__`/config embeds WETH or USDC (both have pairs where they are `baseToken`), a "buy $PARTNER here" announcement on an `official_subject` verified blog post URL. The wrong token then flows into token conduct, market/liquidity credit and `tokenFromVerifiedProjectToken` (src/lib/projectTokenLeg.ts:40) for the safety leg.

Note also that a project that *does* have its own token but also mentions USDC on the same page is refused as "ambiguous_multiple_tokens" (`:1044-1047`), so the tier is simultaneously over-permissive and under-recalling.

**Fix.** (a) Require the address to be labeled on the page the way `DECLARED_CA` requires it in the bio (`contract|CA|token address` within N chars) rather than any address anywhere; (b) maintain a deny-list of canonical infra addresses (USDC/USDT/WETH/WBTC per chain, Permit2, Multicall, routers, zero/dead); (c) require the DEX row's `baseToken.name`/`symbol` to pass the same name-relevance filter as `dexProjectCandidates` (`relevance >= 500` vs display name/handle/cashtags) or to match a bio cashtag; (d) do not include `official_subject` fact source URLs (blog posts, docs) as declaration scopes — only the profile website root.

**Confidence:** high. **Repro:** confirmed.

## 2. P1 — Bio description URLs are "official domain" scopes; fan/impersonator accounts bind the real token by `official_domain`

**Files:** `server/adapters/x.ts:397-426` (`twitterapiOfficialUrls` includes `entities.description.urls`), `:2921-2925` (written to `profile.official_websites`); `server/adapters/projectToken.ts:515-532` (`profileOfficialScopes` reads `website` + `official_websites`), `:544-569` (`verifyIdentity` — `official_domain` requires only a homepage on one of those domains), `:591-606` (`firstMatchingOfficialX`); consumers of `officialX`: `server/orchestrate.ts:2030` only (positive rule), `src/intelligence/buildPointInTimeIntelligence.ts:1711` (measurement).

**Mechanism.** Every http(s) URL in the bio text becomes an "official website declared on the provider-frozen record". `verifyIdentity` binds a CoinGecko record as `official_domain` when *any* of its homepages is on any of those domains (`domainsMatch` is bidirectional subdomain matching). When the CoinGecko record's `twitter_screen_name` is a *different* account than the audited handle, that contradiction is recorded as `officialX` but nothing anywhere compares it to `ctx.handle` negatively — the only consumer is a positive `handlesMatch` bonus.

**Failure scenario (repro'd).** `@uniswapfans`, display name "Uniswap Fans", bio "Unofficial fan page. Not affiliated. $UNI", bio link `uniswap.org`. `bioTickerQueries` adds `UNI`; CoinGecko returns Uniswap whose homepage is `uniswap.org` and whose `twitter_screen_name` is `Uniswap`. Result: `projectToken = { symbol: "UNI", verified: true, verification: "official_domain", officialX: "@Uniswap" }`, check `confirmed` "matched this project through its official website domain". The fan/impersonator account now carries the real project's token, market cap, liquidity and rank; "not affiliated" in the bio is never consulted. The DexScreener gate (`dexIdentity`, `:612-650`) explicitly requires BOTH the exact handle and the domain because "metadata is permissionless" — but a bio link is equally permissionless, and the CoinGecko gate accepts domain alone.

**Fix.** (a) Treat `entities.description.urls` as *leads*, not official scopes: only the profile `url` field (and its t.co expansion) should feed `profileOfficialScopes`; (b) when CoinGecko's `twitter_screen_name` (or any X link on the record) resolves to a handle that is not the audited one, refuse the `official_domain` bind and record a `SuspectedImpersonation`/namesake finding instead; (c) scan the bio for `not affiliated|unofficial|fan|parody|community` before any bio-derived scope is trusted.

**Confidence:** high. **Repro:** confirmed.

## 3. P1 — Operator/role bio and tweet grammar binds former, negated, and neighbouring-handle roles as current team, artifact_verified

**Files:** `server/adapters/x.ts:1653-1709` (`operatorClaimInBio`), `:1711-1741` (`projectRoleClaimInBio`), `:2420-2447` (reverse-bio: tweet-text claims when bio merely @-mentions the subject), `:2483-2502` (`reverseBioTeamAsWebMembers` → `evidence_origin: "deterministic", artifact_verified: true, handleProvenance: "subject_first_party"`), `:1770-1817` and `:1872-1908` (followings/amplified lanes use the same parsers).

**Mechanism.** The grammar is verb-then-@handle within 40 chars (commas allowed) or @handle-then-verb within 16–24 chars. There is no negation or tense check (`ex`, `former`, `previously`, `not`, `no longer`) and the "after" pattern lets a verb that syntactically belongs to the *next* handle bind the previous one. In the reverse-bio lane, when a candidate's bio merely @-mentions the subject, their *tweets* are run through `operatorClaimInBio`, so a question or third-party sentence in a tweet binds the tweeter.

**Repro'd outputs:**
- bio `ex @proj, now building @newco` → `{ role: "operator", phrase: "@proj, now building" }` for @proj.
- bio `Former CEO @proj. Now investing.` → `{ role: "ceo" }` (both parsers).
- bio `Not the founder of @proj, just a fan` → `{ role: "founder" }`.
- tweet `Who is the founder of @proj? Anyone know?` from an account whose bio mentions @proj → `{ role: "founder", phrase: "founder of @proj" }` → team row "founder", `artifact_verified: true`, `handleProvenance: "subject_first_party"`, evidence "their current X bio @-mentions @proj and they wrote 'founder of @proj'".

Downstream this feeds `webTeam` with first-party provenance (avatar enrichment `teamEnrichment.ts:71-96`, team-known scoring, PDL leader-departure lookups at `peopledatalabs.ts:50-80` which spends ~$0.10 per founder/C-level name). A departed CTO whose bio says "Former CTO @proj" is published as current CTO; a critic who tweets "the founder of @proj rugged" becomes the founder.

**Fix.** (a) Reject when the 40-char window before the verb contains `\b(ex|former(ly)?|prev(iously)?|past|no longer|not|never|until)\b` or the verb is hyphen-prefixed by `ex-`; (b) in the "after" pattern, stop at a comma when another @handle follows the verb (`@x, building @y` → verb belongs to @y); (c) never derive a role from tweet text in `discoverReverseBioFromTwitterapiUncached` — keep tweet-only rows as leads (`artifact_verified: false`), or require a first-person frame (`I'm|I am|we are ... founder of @H`); (d) bind date: emit `period`/`asOf` from the profile capture so a "current" role is dated.

**Confidence:** high. **Repro:** confirmed.

## 4. P1 — PDL name-match upgrade launders a Grok-supplied `domain` into an `official_counterparty` verification host

**Files:** `server/adapters/peopledatalabs.ts:381-434` (upgrade on `company.toLowerCase()` name match: sets `evidence_origin: "deterministic"`, `artifact_verified: true`, keeps existing `x_handle`/`domain`); `server/orchestrate.ts:948-964` (ventures created from `discoverAffiliations` carry Grok's `domain`/`x_handle` as `model_lead`); `server/adapters/basicFacts.ts:4255-4263` (`verifiedCounterpartyHosts`: any venture with `artifact_verified && evidence_origin !== "model_lead"`), `:3910-3928` (`verifiedVentureOfficialScopes` — `venture.domain` is accepted **without** the `evidenceUrlMatchesVentureIdentity` check that `evidence_url` gets), `:3290-3305` and `:3437-3446` (`officialCounterparty` → `status: "verified"`, `sourceClass: "official_counterparty"`, plus `trustedHostContextTokens` supplying the org anchor).

**Mechanism.** Grok's `discoverAffiliations` returns `{name, role, domain}`; `domain` is only regex-shape validated (`x.ts:1490`). PDL confirms *employment at a company of that name* and flips the venture to deterministic/verified but leaves the model's `domain` untouched. `verifiedCounterpartyHosts` then treats `https://<grok-domain>/` as a first-party counterparty scope for the whole basic-facts run: any lead whose source URL is on that host verifies as `official_counterparty` (no two-source requirement), and `directClaimClause` accepts `OFFICIAL_SELF_REFERENCE` ("we", "our company") clauses on it with the host label as a trusted anchor (`:2589-2596`).

**Failure scenario.** Subject worked at "Aave" (PDL confirms). Grok returned `domain: "aave.net"` (lookalike / phishing / stale) or a namesake company's domain. Every claim fetched from `aave.net` — roles, tokens (`official_token` is in `counterpartyPredicate`), public_security — publishes as `verified`, `sourceClass: official_counterparty`, and feeds `verifiedVentureAssetRelationships` / person asset binding. The comment at `basicFacts.ts:4948-4952` explicitly acknowledges "a fact-named venture … can be spoofed by an organization-NAMED host (aave.net)" for the SEC screen but the counterparty-host path has the same hole.

**Fix.** In `verifiedVentureOfficialScopes`, apply `evidenceUrlMatchesVentureIdentity` (or better, `scopeMatchesOrganizationIdentity`) to `venture.domain` as well, and only accept a `domain` whose provenance is deterministic (PDL `company.website`, archived page, registry) — clear or mark `domain_evidence_origin: "model_lead"` on PDL upgrade unless PDL's own `company.website` agrees.

**Confidence:** high (code trace; not run end-to-end).

## 5. P2 — `reverseBioMemo` is never reset: outage-empty and stale results replay for the process lifetime

**Files:** `server/adapters/x.ts:2327-2346` (module-level `Map<string, Promise<ReverseBioDiscovery>>`, keyed by handle, only deleted on *rejection*; `resetReverseBioMemo` exists but is only imported by tests — orchestrate resets `resetFollowScanMemo` only, `orchestrate.ts:3847`); `:2372-2384` (all provider failures are swallowed → resolves `{team: [], orgs: []}`).

**Failure scenario.** Scan A of `@proj` runs during a twitterapi 429/outage → every search throws inside the `try` → memo stores a *resolved* empty discovery. Scan B, C … of `@proj` (any tenant, same warm container — Vercel keeps containers for many minutes/hours) get the empty team without any provider call and without any "unavailable" marker; the report's team lane records a checked-empty. Conversely a bio that changed (founder removed "CEO @proj") keeps returning the old claim. This violates both "UNAVAILABLE never becomes measured empty" and rescan reproducibility (evidence is not re-collected, and `getProfile` fallbacks for accounts fetched inside are also frozen).

**Fix.** Call `resetReverseBioMemo()` next to `resetFollowScanMemo()` at scan start, or give the memo a TTL like `LAST_TWEETS_MEMO_TTL_MS`, and do not memoize a result produced after a caught provider failure (return `{team, orgs, unavailable: true}` and skip `set`).

**Confidence:** high.

## 6. P2 — Entity-fact reuse is keyed by @handle only; handle reuse/rename replays the previous holder's verified facts

**Files:** `server/adapters/basicFacts.ts:4552-4587` (`loadReusableBasicFacts`: key = `canonicalEntityKey({handle})`; for `project`/organization audiences no identity check at all; per-predicate TTLs up to 365 days for `security_incident`, 30 days for `education/funding/investor/exit`), `src/engine/audit.ts:1011-1017` (`canonicalEntityKey` = lowercased handle), `server/entityStore.ts:39-63` (no account id / created_at stored or compared). Gated by `ARGUS_ENTITY_REUSE=on`.

**Failure scenario.** `@alpha` (project A) is audited, facts stored. Project A renames to `@alpha_old`; a new project B registers `@alpha` (X releases handles). Scan of `@alpha` within the TTL: `hydrateOfficialProjectIdentityFromFacts` sets `profile.website`, `display_name`, `identity_confidence = "Confirmed"` and `roles += PROJECT` from A's facts (`server/projectIdentity.ts:48-71`); A's `security_incident`, funding, legal-entity facts close B's questions (`cachedFactClosesDiscovery`) and are published as B's. The X account id (`handleHistory` already exposes `idStr`, `x.ts:486`) and `account_created_at` are available but not part of the key or the freshness check.

**Fix.** Store the X user id (and `created_at`) with the entity record and require equality on read; for projects also require the stored `display_name`/website domain to still match the live profile before reuse.

**Confidence:** high (flag-gated feature).

## 7. P2 — Archived-page affiliation corroboration promotes on a display-name match

**Files:** `server/adapters/wayback.ts:229-305` (`archivedAffiliation(domain, subjectName, ventureName)`), `:317-323` (`nameNeedles` from display name); call site `server/orchestrate.ts:1862` passes `ctx.evidence.profile.display_name`; promotion `orchestrate.ts:1880-1884` sets `evidence_origin: "deterministic", artifact_verified: true`.

**Mechanism.** The archived `/team` or `/about` page must contain the subject's *display name* (first+last) and the venture's name or domain root. The venture-side check proves the page belongs to the venture; nothing proves the named person is the audited account (invariant: "Display name is not a bind key"). Grok proposes ties by name similarity, so the namesake case is the expected failure mode, not an edge case.

**Failure scenario.** Subject `@johnsmith_dev`, display name "John Smith". Grok returns `{name: "Acme Labs", role: "cofounder", domain: "acme.io"}` (a different John Smith). archive.org's `acme.io/about` lists "John Smith, co-founder" → venture promoted to scoreable deterministic evidence, `rec.evidence_url` set, and (via finding 4's path) `acme.io` becomes an official counterparty host.

**Fix.** Require the archived page to also carry the exact @handle or `x.com/<handle>` backlink (the same `handleBacklinkPattern` linkHub uses), or a PDL/verified identity_binding before display-name matching is allowed; otherwise keep as `corroborated lead`, not `artifact_verified`.

**Confidence:** medium-high.

## 8. P2 — `recoverOfficialSiteBindings` confirms identity from a model-cited brand-stem domain; backlink regex accepts tweet URLs

**Files:** `server/adapters/basicFacts.ts:1075-1092` (`officialSiteBindingCandidate`: registrable label must be a prefix of the handle with an allowed suffix), `:1111-1118` (`documentLinksExactHandle`: `x.com/<handle>(?:[/?#"'\s<]|$)` — matches `x.com/<handle>/status/123`), `:4703-4768` (sets `profile.website`, `display_name`, `identity_confidence = "Confirmed"`, records `identity-resolution: confirmed`, and adds the origin to `officialHosts` so every fact from it verifies as `official_subject`). Runs whenever `canonicalOfficialWebsite(profile.website)` is null — including a *live* profile whose link is linktr.ee — not only suspended accounts.

**Failure scenario.** Audited `@driftprotocol` (website field is a link hub). A model lead cites `https://drift.finance/…` (a phishing/lookalike site: brand stem "drift", handle suffix "protocol" ∈ `OFFICIAL_SITE_HANDLE_SUFFIXES`). The page contains "Drift Protocol" text and embeds one tweet link `https://x.com/driftprotocol/status/…`. Result: `identity_confidence = "Confirmed"`, `profile.website = https://drift.finance/`, and the phishing domain becomes the `official_subject` scope for token declaration (finding 1) and basic-fact verification. Same regex shape in `linkHub.ts:42-43` (related to known #359 tweet-URL-as-official-X; noting only that these two backlink checks share the defect).

**Fix.** Require the backlink to be a bare profile URL (`x.com/<handle>` followed by end/`?`/`#`/quote, not `/status/`), require the link to appear in an anchor/`rel="me"`/JSON-LD `sameAs` rather than anywhere in text, and do not run the recovery when the live profile is resolved and merely uses a link hub (use `resolveLinkHubWebsite`, which already enforces the bidirectional backlink).

**Confidence:** medium.

## 9. P3 — Unbounded reads of attacker-controlled HTML; site-declared fetch bypasses deadline

- `server/adapters/projectToken.ts:963-968,983`: `fetchImpl(scope.canonicalUrl, {redirect: "follow"})` with `fetchImpl = fetch` (global, passed at `:1803`) — not `deadlineFetch`, so the stage deadline signal is not applied; `await response.text()` reads the whole body before `.slice(0, 400_000)`. Same class as known #364 (raw follow-redirect site fetch on a profile-declared domain) — noting only that this path is also unguarded and additionally escapes `providerDeadline`.
- `server/adapters/teampage.ts:552-556` (`response.text()` unbounded, up to 24 discovered URLs + 8 forum URLs + 16 candidates per project) and `:114-116` (index bodies read fully then sliced to 250k).
- `server/adapters/sitecheck.ts:161-163` (`readBody` without `maxBytes` for the substance page).

`documentText` / `sourceSentencePassages` in basicFacts are bounded by `MAX_TEXT_BYTES` upstream and are O(n·3) — fine. I found no catastrophic-backtracking regexes on bio/site text: bio regexes are anchored with bounded `{0,N}` gaps; `attributionClauses` lookaheads are bounded; `SITE_SOLANA_ADDRESS`/`CASHTAG` are linear.

**Fix.** Use `fetchPublicText`/`readBoundedText` (1.5 MB cap, pinned DNS, redirect validation) on all three paths.

## 10. P3 — Raw provider error text in scan steps

`server/adapters/teamEnrichment.ts:88-94` emits `String(error)` from `getProfile`/image fetch into `ctx.emit` detail (shown to the browser). Related to known #383 hygiene; mention only.

---

## Checked and found correct (no re-check needed)

- `server/publicWeb.ts`: DNS-pinned lookup per hop, redirect re-validation, IPv4/IPv6 private ranges (incl. NAT64, 6to4, Teredo, `::ffff:`), port pinning, sensitive-query rejection, 1.5 MB bounded read, Jina reader recovery keeps `url` = original and `retrievalUrl` = reader, requires `URL Source:` to equal the original, refuses query/capability paths, detects relayed challenge bodies. `verifyBasicFactLead` labels the source `provider: "jina-reader"` correctly (`basicFacts.ts:3418-3421`). No SSRF via `r.jina.ai` (reader URL itself is validated).
- Verified-passage check (`basicFacts.ts:2807-2825`, `2047-2056`): the model excerpt is a locator only; promotion requires `page.includes(excerpt)` or exact token-sequence match, else a fetched ≤720-char sentence/anchor passage containing alias + value + predicate + attribution clause. Not LLM-claimed.
- Grok outputs: `grokSearch`/`generalWebSearch` results are parsed into leads only (`parseBasicFactLeads` requires a `safeCandidateUrl`, later fetched); adverse signals, manipulation tooling, affiliations, team JSON are all leads/`model_lead` except via the promotion paths in findings 3, 4, 7. `parseOrientation` binds only the packet handle/host; hallucinated `boundDomain` → UNKNOWN. Minor: `boundSourceUrls` falls back to *all* packet URLs when the model cites none (cosmetic).
- `officialXProfileHandle` (`src/lib/officialXProfile.ts`): rejects `/status/`, `/i/…`, `intent`, lookalike hosts, requires exactly one path segment; handles www/http/case. `firstMatchingOfficialX` normalises case. `canonicalOfficialWebsite` rejects shared hosts/link hubs/press/regulators and 2-label public suffixes; `sameOfficialScope` handles path-tenanted hosts (github/x/medium…) with case-insensitive tenant paths where appropriate.
- `linkHub.ts`: uses `fetchPublicText`, requires exact-handle backlink on hub and on the chosen site, unique external/brand-stem rule — sound (modulo the `/status/` regex note in finding 8).
- Stock-vs-token: `verifyBasicFactLead:3328-3345` requires explicit crypto-token language for `official_token` on venture pages, `public_security` requires issuer/regulator (`resolveBasicFactCandidates:3583`), SEC exchange registry screen keyed on authoritative relationships only. Looks right.
- Legal attribution: `attributionScopeFor` exact-key match for `direct_subject`, `identity_unresolved` for person/investor regulator hits without a venture bridge, conflicting event statuses → `conflicted`. Looks right.
- `declaredTokenFromBio`: explicit `CA:`/`contract:` label, single distinct address; bare addresses do not route (known #371 covers promoted tokens).
- `peopledatalabsAdapter.run`: requires `personMatchesAuditedHandle` on the exact X handle before adopting identity; outage vs no-match distinguished. (`checkLeaderDepartures` by name+company is PDL-likelihood-gated; not flagged.)
- `profilePhoto.ts`: twimg-only host allowlist, manual redirects re-validated, 750 kB cap, magic-byte check.
- `snapshot.ts spaceBinding`: verified flag AND (exact X handle OR related official domain). `domainAge.ts`: shared-host suffixes excluded, RDAP 400/404 not treated as outage.
- `dynamicNotable` is organization-scoped; `checkFollow` memo is 30 s and never caches null; `lastTweetsMemo` has TTL.
- `collectCorpus` drops RTs so `scanPostsForRoles`' "our founder" cannot come from a retweeted third party (it still binds "our former CTO @x" — same tense gap as finding 3, lower impact).
- `tokenSearchQueries`/`bioTickerQueries`: >3 cashtags → watchlist, no queries; tickers must still pass the identity gate (finding 2 is the gate's weakness, not the query's).
