# ARGUS: agent onboarding

Written for a coding agent (Codex, Claude, Cursor, Grok, Copilot) joining this
repository with no prior context. Read this before opening code. It explains what
the product is, the doctrines that govern what it is allowed to say, how the system
is built, and where the work currently stands.

For review work specifically, `docs/CODEX-REVIEW-BRIEF.md` is the companion
document: it ranks the failure modes that matter and lists what is already known,
fixed, or disproven. The engineering contract in `AGENTS.md` outranks both.

Last refreshed 2026-09-20.

---

## 1. What the product is

ARGUS is a forensic due-diligence product. A user enters an X handle, a token
contract address, a person, or a website URL, and ARGUS produces an evidence-cited
report: who is behind the subject, what they have built, whether their token (if
any) is authentic and safe, who actually backs them, what has gone wrong before,
and a score with an explicit verdict (PASS / CAUTION / FAIL / AVOID / INCOMPLETE).

It is not only a crypto tool. The standing doctrine is that ARGUS assesses all
startups, businesses and persons. Every subject is categorized as one of:

1. Web3 with a live token
2. Web3 with a token indicated as coming
3. Web3 explicitly tokenless
4. Non-Web3, listed on a stock exchange
5. Non-Web3, private

Metric families that do not apply to a category (token metrics for a tokenless
company, stock metrics for a private one) are **scrapped from the score and the
remaining weights re-normalized**, never zero-scored, because a zero reads as a
finding when it is really an absence. Tokenized-stock venues get pairing
assessment; launchpads with no native token are judged as ecosystems rather than
being marked down for a token that was never supposed to exist.

The reader is someone about to act with money. That is the bar every sentence in a
report has to clear.

## 2. Doctrines that govern the output

These came from the product owner through specific incidents. They outrank
convenience, and violating them is how past agents have shipped real defects.

**Epistemic honesty over uptime.** The worst thing this codebase can ship is not a
crash; it is a sentence a reader believes that is not true. A false claim about a
real subject (publishing another company's funding round, calling a live developer
gone, naming someone an impersonator) is close to defamatory and outranks
everything else.

**Absence is never exoneration.** "No adverse findings" when the screen never ran
is a lie. A provider that did not answer records an `unavailable` check: a
provider gap, not an assessed result. The engine publishes INCOMPLETE with a
withheld score rather than inventing a clean one.

**A bounded read publishes as a floor.** A capped list, a truncated page walk, a
partial candle window, a counter at its provider's ceiling: all of these publish as
"at least N", never as a total.

**A provider's opinion is carried with attribution, never restated as ours.**
Aggregator data (CryptoRank, DeFiLlama, GMGN tags, RugCheck flags, StartupWho-class
sources) may be used, but the report names the source and its uncorroborable
status: one aggregator naming a backer is an attribution, not a verified
investment.

**Identity binds on unique IDs only, never names.** An exact X handle, an exact
domain, a CoinGecko id, a contract address. A display-name match is a lead. Name-only
entities get non-binding `name:` keys so a namesake on a failed report can never
lend weight to an unrelated subject.

**Token attribution requires reciprocity (bi-linkage).** Anyone can deploy a token
and point its DexScreener websites and socials at any account. That is exactly how
scam "$CZ" tokens declared `x.com/cz_binance`. A listing alone never binds. The
subject's own side must adopt the contract: the CA in their provider-frozen bio, in
their own posts, or published on their official site. Refused contenders are
recorded as `evidence.namesakeTokens` and the report states plainly that they were
launched by someone else.

**A person is never assessed as a company.** A famous founder routes as a PERSON;
their companies are ventures *of* the person. BNB attaches to the Binance venture,
never to CZ as a canonical personal token.

**A backer edge requires backing evidence bound to the subject**: a funding record
naming the backer, or a first-party statement by the subject about itself ("we are
backed by @X"). Co-mention, amplification, quoting someone else's raise, or a
follow-back never mint a backer or advisor edge.

**Saved reports are immutable.** Every save is a frozen `report_versions` row. A
hard rescan produces version x+1 with a new audit id; it never mutates history, and
a presentation repair must be explicitly versioned rather than quietly re-rendering
old evidence.

**Evidence tiers travel with every fact**: `verified` / `reported` / `rumor`,
plus `evidence_origin: deterministic | model_lead` and `artifact_verified`. Model
leads are visible to the investigator but can never govern routing or scores.

**Copy doctrine**: absolute, investor-perspective language ("Strong team data, no
leading concerns"), never comparative or leaderboard phrasing ("has the most
recorded evidence, next to check"). Meta and how-to-read text renders visually
subordinate. No em dashes in authored strings or test descriptions
(`uiCopyPolicy` enforces this).

## 3. Architecture

```
Browser (React 19 + Vite + Tailwind v4, src/)
  │  the client orchestrates scans: it calls many small API lanes and streams progress
  ▼
api/  (~116 Vercel serverless functions)
  │  magic-link session auth (requireArgusAuth), panel cost tokens, per-lane endpoints,
  │  api/audit = SSE stream running the full pipeline (maxDuration 600s)
  ▼
server/  (the audit pipeline, bundled into api/_collector.js by scripts/build-collector.mjs)
  │  orchestrate.ts (the conductor) + ~42 adapters in server/adapters/
  ▼
Supabase (Postgres + RLS)   ·   ~34 provider APIs
```

Providers include twitterapi.io, Grok (xAI), Claude, Serper, CoinGecko,
DexScreener, GeckoTerminal, DeFiLlama, CryptoRank, Etherscan, Helius, Arkham,
GitHub, People Data Labs, SEC EDGAR, Companies House and OpenCorporates.

Deployment is Vercel (project `kyle-mcconnells-projects/argus`, production at
`argus-one-flax.vercel.app`). Database is Supabase project `mpjpmgdklxpzggypmpwn`;
migrations in `supabase/migrations/` apply to production through the Supabase
GitHub integration on merge to main.

### Directory map

| Path | Contents |
|---|---|
| `src/engine/` | Scoring engine: axes, weights, routing (`router.ts`), taxonomy, `audit.ts`, corroboration |
| `src/data/evidence.ts` | `CollectedEvidence`, the working shape every adapter writes into |
| `src/data/dossier.ts` | `Dossier`, the frozen projection persisted with a report version |
| `src/collect/` | Client-side website recon lane (retrieve → recon → siteProfile → projectverdict) |
| `src/threat/` | Token threat scanner: classification, site safety, launch venues, shipping analysis |
| `src/lib/` | Shared client+server libs, compiled by DOM-less tsconfigs (see gotchas) |
| `src/reports/argus/chapters/` | The eight report chapters (Decision, Scores, People, Product, Market, Code, Connections, Evidence) |
| `src/components/` | Report panels, dialogs, workspace pages |
| `server/orchestrate.ts` | `runAudit()`: collection passes, routing, scoring, persistence, knowledge-base write-back |
| `server/adapters/` | One adapter per evidence source (x, projectToken, teampage, siteBackers, cryptoRank, defiLlama, stockHealth, securityAudits, …) |
| `api/` | Serverless routes; `_collector.js` (prebuilt server bundle), `_auth.ts`, `_cache.js`, `_provenance.ts` |
| `supabase/` | Migrations and database tests |
| `scripts/` | `validate-agent-context.mjs`, `build-collector.mjs`, `release-canary.ts`, `source-of-truth-check.ts`, eval harness |
| `docs/` | Briefs, handoffs, audits, decisions |

### How a scan flows

1. **Input resolution** (`src/lib/resolveInput.ts`) decides handle vs contract vs
   URL vs ticker.
2. **Collection** (`server/orchestrate.ts`) gathers the provider-frozen profile,
   post corpus, team page (`fetchTeamPage` walks /team, /about and docs pages, does
   LLM roster extraction, then binds LinkedIn/X/Telegram/email/portraits from the
   page's own anchors), token identity (CoinGecko, then DexScreener behind the
   reciprocity gate, then contracts the official site declares), fundraising
   (DeFiLlama, CryptoRank rounds, company enrichment), the site's backer wall,
   registries (SEC EDGAR, Companies House, OpenCorporates), security audits, GitHub
   shipping forensics, sanctions and adverse sweeps (always live, never cached),
   launch-venue tagging, stock health and tokenized-stock pairing.
3. **Routing** (`providerBackedRoles` → `src/engine/router.ts`) selects the
   governing methodology: PERSON/FOUNDER, PROJECT, TOKEN or INVESTOR. Only
   provider-backed evidence routes; model candidates never do.
4. **Scoring** (`src/engine/audit.ts`) over six project axes:
   `P1_team_and_identity`, `P2_product_substance`, `P3_token_conduct`,
   `P4_backing_and_partners`, `P5_traction_and_liveness`,
   `P6_transparency_integrity`. `deriveTokenApplicability`
   (`server/tokenApplicability.ts`) marks each axis `assess`, `not_applicable`,
   `deferred` or `provisional`; the engine normalizes over applicable weight and the
   weakest applicable lens governs. Hard caps (an OFAC-sanctioned address, for
   example) floor the score regardless of the rest.
5. **Persistence** (`api/audit.ts` → `api/_provenance.ts`):
   `persistReportVersionBundle` writes the immutable `report_versions` row;
   activation updates the mutable `reports` projection and derives
   `graph_contributions` in Postgres. At finalize, best-effort write-backs populate
   `entity_facts` (cross-scan verified-facts knowledge base, keyed by
   `canonicalEntityKey`) and `investor_records` (cross-scan backer observations).
6. **Rendering**: the principal report is an interactive eight-chapter layout
   (Decision, Scores, People, Product, Market, Code, Connections, Evidence) with
   score composition, evidence ledgers, a corroboration table, the connections
   workspace, the fundraising and backers section, a roster showing full roles with
   hyperlinked X/LinkedIn/Telegram and copy/mailto email buttons, and the challenge
   flow. Token reports additionally show dual scores: token safety plus the linked
   project's diligence score.

## 4. Subsystems worth knowing before you touch them

**Token threat scan** (`src/threat/`) is the contract-first lane: holders,
liquidity, deployer origin, bytecode, sell structure, burns, site safety, and X-bio
authenticity (`api/x-authenticity.ts`, the scanned CA must appear in the linked X
bio; a *different* CA there is an impersonation flag).

**Site recon** (`src/collect/`, `api/recon-site.ts`, `api/recon-team.ts`) handles
URL-first scans. Because browser fetches of third-party origins are CORS-blocked, a
server-side raw-markup fetch supplies the anchors; hrefs are absolutized so footer
icon-only socials resolve; the first-party team page roster is promoted into the
standard team section; and once an official X account is found, the lane bridges to
the full audit.

**Challenge flow** (`api/report-challenge.ts`, `ChallengeDialog.tsx`,
`report_challenges`): a dropdown separates team members from the community. Team
members verify through an email whose domain matches the company URL, which returns
them in a verified state, that is the impersonation defense. Evidence files can be
attached. There are two distinct free-text fields: "What's wrong here?" about this
report, and "Where did this go wrong?" which feeds global system learning.

**Fundraising and backers** (`src/lib/fundraising.ts`): merged chronological rounds
carrying date, amount, valuation, instrument (equity vs equity-plus-token), token
price, tokens for sale and allocation of supply; backer classification (angel,
launchpad, platform, venture fund, family office, private equity); a residue filter
that discards rounds stating neither amount, valuation nor token terms, because
those are aggregator relationship noise rather than financing events.

**Cross-scan VC registry** (`investor_records`, `server/investorStore.ts`,
`api/investor-registry`, the VCs page): every saved scan contributes one row per
investor per subject per round. The ranking (subjects backed, lead share, cadence,
valuation direction) is derived at read time, labeled as aggregator attribution over
this workspace's own scan history, and never feeds any subject's verdict.

**Entity knowledge base** (`entity_facts`, `server/entityStore.ts`) recalls verified
facts across scans so discovery is not re-paid. Legal, sanctions and other
time-sensitive facts are deliberately excluded and re-screened live every run.

**GitHub shipping analysis** freezes `TokenDossier.shipping` at scan time, feeding
engine penalties, committer identity and churn, claims measured against the
subject's own posts, and stage cohorts. `api/shipping-cohort.ts` is the canonical
pattern for a pure fold over an org-scoped PostgREST read, with an honest
"not enough data yet" floor.

**Background scan tray** (`src/lib/runner.ts`, `src/lib/scanrunner.ts`, `ScanTray`):
deep-dive scans never replace the open report. They run in a sticky bottom tray with
progress bars, turn solid green when finished, and expand to fill the window with a
sticky "go back to the report" bar.

**Stale-tab heartbeat** (`src/lib/versionHeartbeat.ts`) compares the served index
asset every five minutes and offers a manual reload when a new version ships.

**Cost discipline**: paid supplements only run against a persisted report version,
authorized by a short-lived signed `panelCostToken`, and every provider call is
metered into `report_cost_lines`.

## 5. Working in this repository

From `AGENTS.md`, which is binding:

1. Run `node scripts/validate-agent-context.mjs` and read
   `config/agent-context.json` before editing.
2. GitHub is the durable handoff: issue → short-lived branch → draft PR → CI →
   protected `main`. Continue durable GitHub state; never rebuild another agent's
   work from chat memory.
3. OENBOT dashboard and UI work belongs in
   `kylekmcconnell-arch/oenbot-dashboard-source`, not here. If ownership is
   unclear, stop and open an issue labeled `needs-routing`.
4. Keep secrets, customer data and credentials out of the repository. Never bypass
   protected branches or required checks.

Verification battery, all must be green before a PR:

```
npm run typecheck        # tsc -b plus the server and api tsconfigs
npm run truth:check      # source-of-truth contract
npm run canary:offline   # 7 full offline pipeline audits, provider calls intercepted
npm run calibrate        # 21 calibration subjects, fails on drift
TZ=UTC npx vitest run    # ~5,000 tests (the TZ pin matters)
```

CI on pull requests runs `agent-context`, `verify` and `database`, plus a Vercel
preview. Merging requires the branch to be up to date with main; there is no
auto-merge, so the sequence is update branch, wait for green, squash-merge.

Gotchas that have cost real time:

- `src/lib` is compiled by DOM-less server and api tsconfigs. Do not reach for DOM
  types there; use structural types (see `versionHeartbeat.ts`, `challenge.ts`).
- `api/_collector.js` is a prebuilt bundle regenerated by the build; api routes
  import server code through it.
- Sensitive environment variables pull as empty strings from Vercel locally, so
  local runs are keyless by design. Use the offline canary and fixtures.
- The lint baseline sits around 700 warnings. That is normal; do not chase it.
- Parallel work uses git worktrees under `/Users/enigma/argus-wt/<name>`; copy
  `node_modules` in rather than reinstalling.
- Report exports follow `<subject>_<date>_Argus_Forensic_due_diligence.<ext>`
  (`src/lib/printPdf.ts`).

## 6. Where things stand (2026-09-20)

Recently shipped, in rough order: subject categorization and the stock/registry and
launchpad lanes (#441, #442, #445, #446); report copy overhaul, tokenless security
audits, self-published backers and the stale-tab heartbeat (#449, #463); the
verified challenge flow (#450); sitemap-driven GitHub discovery, roster contacts,
person-vs-company routing, the fundraising section, slug recall and the scan tray
(#451, #452, #456, #457, #458, #460); the namesake-token reciprocity gate and the
challenge dialog styling fix (#465); site-scan depth (#466); the backer-edge
ownership gate (#467); the cross-scan VC ranking (#468); a one-time flush of
`provider_cache` and `entity_facts` so no pre-fix cached answers feed new scans
(#469); and the report audit series plus the eight-chapter interactive redesign
(#473, #475, #476, #478, #479, #480).

Open work to be aware of:

- **#472, the Altcoinist v4 defect register (ARGUS-01..20)** is the live quality
  thread. Much of it landed across #473/#475/#476/#478; check the register before
  touching report presentation, and follow its ground rules, reproduce against the
  saved version first, never invent corrected scores, never rescan to conceal
  history, never mutate frozen evidence, and version any presentation repair.
- **#440** tracks the subject-categorization doctrine end to end.
- A cluster of engine and hygiene issues: #374, #375, #376, #378, #379, #380, #381,
  #382, #383, #384.
- Open pull requests: #477 (machine-checked "no personal approval gates" contract),
  #410 (forensic outages unavailable until saved) and #412 (draft, fail closed on
  unusable market figures). #410 and #412 predate the current report work and need
  rebasing before review.
- Environment keys still unset in production: `RESEND_API_KEY` and `RESEND_FROM`
  (challenge verification email), `COMPANIES_HOUSE_API_KEY`,
  `OPENCORPORATES_API_TOKEN`. `CRYPTORANK_API_KEY` is set.

## 7. Glossary

| Term | Meaning |
|---|---|
| Dossier | The frozen evidence projection persisted with a report version |
| Axis / P1–P6 | The six project scoring dimensions |
| Applicability | Per-axis `assess` / `not_applicable` / `deferred` / `provisional` |
| Governing role | The methodology selected by provider-backed routing |
| Hard rescan | A full re-audit producing version x+1 |
| Namesake | A token or entity sharing the subject's name that failed identity binding: recorded, never attributed |
| Panel cost token | Signed capability binding paid supplements to one persisted report version |
| Recon | The keyless, client-side website scan lane |
| Provider-frozen | Captured verbatim from a provider at scan time, as opposed to model-derived |
| Floor-eligible | Whether a fact may move the score floor; self-published and aggregator facts are not |

---

Anything this file does not answer lives in `AGENTS.md`,
`config/agent-context.json`, `docs/CODEX-REVIEW-BRIEF.md`, or the GitHub issue
history, which is the durable specification trail.
