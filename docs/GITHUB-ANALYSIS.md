# GitHub analysis: the reference review and the ARGUS shipping assessment

Date: 2026-09-15. Branch: `feat/github-analysis`. Author: Enigma with Claude.

This note records (1) what was learned from reviewing a Robinhood Chain
builder-discovery product (referred to here as the reference product; it is not
named in this repository), (2) what of its published method is replicable, and
(3) the design of the shipping assessment that this branch adds to every
project-shaped ARGUS report (token, investigation, recon), with the parts still
open. The token behind the reference product was assessed with the same
checklist; that read lives in the cabal registry and the session notes, not
here.

---

## 1. The reference product, reviewed with our own checklist

**What it is.** A builder-discovery site for Robinhood Chain (chain 4663). It
tracks projects, records "ships" (GitHub releases, code activity, contract
deploys), derives an activity status from source-backed development only, shows
token market status beside it but never inside it, and ranks builders on a
formula that ignores price. Its own token pays research bounties and gates API
allowance.

**Its GitHub, read with the checklist the user asked for:**

| Question | Finding |
| --- | --- |
| Maintained properly? | Yes at the code level: strict TypeScript, `any` banned, 69 test files (~41% test-to-source lines), CI with a secret scan before lint, a real lockfile, dated rationale comments on almost every decision. |
| Commit cadence | 44 commits in 4 days, all squashed "Sync from ..." exports of a private repository. The product's own project page reports the same count and one contributor, which is what our GraphQL read returns. |
| Who commits | One account, a noreply identity created the same week. The public repo is a mirror; the private repo's contributor list is invisible. The squashed bodies list the private commit subjects, so the private cadence is readable even though authorship is not. |
| Commits tied to people | Nobody. The export manifest's redaction list discloses the shape of what was scrubbed: a founder's former handle, a production IP, local assistant paths. The project is assistant-driven (its docs cite an assistant rules file by number). |
| Substance | Real. The sync commits change hundreds of lines across 10 to 20 files each; the sources package (9.7k lines, 52 test files) and the scoring package (1.2k lines, every threshold published) are genuine work, not boilerplate. |
| Vibe-coded or unique? | AI-assisted, human-directed. The tell is negative results and self-corrections with production numbers (a share-of-supply denominator bug, an absurd market cap caught by a guard, an admission that a launch factory was never indexed). Generated code does not record what it got wrong. |
| Replica of something else? | No. It is the dev-activity idea applied to one chain, but the code is its own. Zero forks in the account. |
| Marketing matches code? | Mostly. The pinned post promises commit velocity and shipping frequency, and the site does that. The README says the scoring rules stay private; they are in fact published in full. The MCP docs say "five tools" three times and list eleven. |
| Stars | 0 stars, 0 forks, 0 watchers. Nothing to authenticate; also nothing anyone is using. |
| Who talks about them | About 1,500 followers and 350 posts; the pinned post reached 11k views. No third-party project, builder or KOL was found citing it as a data source. The MCP server has no package and no download count. |

**The finding the checklist would have missed.** The brand is recycled: the
same X account and name sold an Ethereum token in 2022 to 2023 that went dark in
2024, and the 2026 site, docs and token page never mention it. This is the
relaunch/rebrand pattern in `investigation-methodology`; the on-chain record of
the 2026 launch and its predecessor is in the cabal registry.

**Verdict on it as a subject.** Real product, real code, one visible builder,
no adoption yet, a recycled brand with an abandoned earlier token behind it, and
a launch that snipers dominated. Not a scam; a thin, early, single-operator
project whose marketing is ahead of its footprint.

---

## 2. Is the method replicable?

Yes, about 80% of the GitHub-assessment method is in its open repository, and
the remaining 20% is exactly the part that is hard.

**Published, reusable today**

- Every data adapter with saved fixtures: GitHub repo, releases, commits, code
  search, contents, owner repos; Blockscout, DEX Screener, GeckoTerminal,
  CoinGecko, launchpads, feeds, npm. Bot and dependency-bump commit filters.
  "One code-activity event per repo per ISO week" so commit spam cannot inflate
  a score.
- The complete scoring rulebook: momentum weights (recency .35, consistency .25,
  significance .20, verification .15, diversity .05), 22 event base weights
  (product launch 10, docs 3, announcement 0), activity thresholds (7/30/60
  days), a "still building" flag (market at or below 50% of the 90-day high
  while building continues), the market-status decision tree with all eight
  thresholds.
- The link-provenance rule that makes a repo mapping authoritative: the project
  must link the repo from a site it controls; a name or ticker match never
  qualifies.
- The wording discipline: status never by colour alone, absent means unknown
  (never 0), "no builder signal yet" instead of "unknown", market data shown
  beside development and never inside it, no verdict words.

**Withheld in its private repo**

- The candidate pipeline and quality gate: how a code-search hit on a chain
  fingerprint becomes a project, fingerprint grading, identity-resolution
  rules, the launcher-template rejection list.
- The code-search marker list that finds repos by deployment fingerprint.
- The database schema, the worker, the signal-rule engine, the builder-ranking
  sub-scores.

**What ARGUS takes.** Not the pipeline (we scan one subject at a time; it
indexes a chain). The separation of development from market, the evidence
labels on every ship, the weekly capping, the plain-language status vocabulary,
and the honesty rules about absence. Then ARGUS goes where it deliberately does
not: it publishes no verdicts and names no people; ARGUS exists to say who is
committing, whether the stars are bought, whether the claims are true, and how
the project compares with its sector.

---

## 3. The ARGUS shipping assessment (this branch)

### Where it lives

| Layer | File | Role |
| --- | --- | --- |
| Judgement | `src/threat/shipping.ts` | Pure `assessShipping(input)`. Replayable, no network, shared by server and client. |
| Peers | `src/threat/shippingPeers.ts` | Eleven sectors, three verified public repos each, keyword detection from the project's own copy. |
| Fetch | `api/github-shipping.ts` | Three GraphQL calls (owner repos, history across the four busiest, sector peers cached daily) plus up to four REST pages of daily star counts for the flagship repo. Panel-metered, cached in six-hour buckets, fails closed. |
| Panel | `src/components/GithubShipping.tsx` | On-click, mounted by `ProjectResearch` above the existing commit-forensics panel, so it appears on token, investigation and recon reports. Re-runs the judgement locally with the price series and posts. |
| Tests | `src/threat/shipping.test.ts` (24), `api/github-shipping.test.ts` (13), `src/components/GithubShipping.test.tsx` (3) | Fixtures include the private-mirror shape, a bought-stars shape, a launch-week star burst, price-versus-commit joins, claim grading and peer positioning. |

### What it answers, mapped to the checklist

| Checklist item | Metric | Vocabulary |
| --- | --- | --- |
| Maintained properly | license, README, CI workflow, test directory, open issues/PRs per repo | hygiene: maintained / partial / neglected |
| How often commits happen | 13 weekly buckets over 90 days, active weeks, longest and median gap, days since last commit | cadence: shipping (≤7d) / active (≤30d) / quiet (≤60d) / dormant |
| Who commits | distinct human authors, top-author share, HHI, bot share, mirror share, fresh accounts | concentration: team / lead-plus (≥50%) / single-author (≥85%) / unattributed |
| Tie commits to X profiles | roster carries GitHub logins with account age; the existing `recon-team` org-member → `twitter_username` bridge and `resolve-github` X → GitHub bridge complete the loop | rendered as linked logins; the X join is the next step (§4) |
| Token behaviour vs shipping | first-half vs second-half commit count against price change over the window | market: shipping-into-weakness / price-without-shipping / aligned-up / aligned-down / mixed |
| One person or several; how far apart; how substantial | above, plus median lines and files per commit, trivial share (≤5 lines), bulk drops (≥1,500 lines and ≥15 files) | substance block |
| Vibe-coded or unique | AI co-author trailers (Claude, Copilot, Cursor, Codex, Devin, Gemini, Aider, Windsurf), placeholder messages ("update", "fix", "wip"), bulk drops, mirror exports | authorship: hand-authored / mixed / machine-heavy / mirrored |
| Replica of something else | declared forks with parents, template repos, repos whose history opens with a ≥1,500-line drop inside the window | origin: original / partly-derivative / derivative |
| Marketing matches code | ship-claim posts ("launched", "v1.2", "mainnet", "is live") matched to releases within ±7 days or ≥3 commits in [−7d, +2d] | claims: supported / context / unsupported |
| Sector comparison | subject vs peer median on commits, human authors and stars, positioned below (<0.5×) / within / above (>1.5×) | peers table with the three repos named |
| Stars real or bought | daily star history from GitHub: largest three-day burst share (≥50% outside launch month is suspect; ≥30% with disproportionate forks/watchers/commits is suspect); StarScout account read when a stargazer sample is supplied; proportional fallback otherwise | stars: organic / suspect / insufficient / none |
| Socials vs usage | not in this slice; see §4 | |

### Star authenticity after GitHub's June 2026 restriction

GitHub restricted `/repos/{owner}/{repo}/stargazers` and `/subscribers` to a
repository's own admins and collaborators on 2026-06-30 ("misused to collect
user data for spam activities"); the GraphQL `stargazers` connection returns an
empty list for everyone else and the REST endpoint answers 404. The account
half of the StarScout screen (young, empty accounts) therefore cannot run
against the live API. On 2026-09-04 GitHub shipped
`GET /repos/{owner}/{repo}/stargazers/history`, weekly rows with per-day star
counts back to creation, public without authentication. The handler walks up to
four pages of it for the most-starred repository (30 weeks a page) and the
module times the largest three-day burst against the whole history, exempts a
burst inside the repository's first month, and combines the timing with the
proportion check (stars against forks, watchers and commits). The stargazer
sample input stays in the module for anyone who can still supply one.

### Reading the reference repo through it

`assessShipping` on the reference repo's input (44 commits, one noreply mirror
account, repo four days old, 0 stars) returns grade `shipping-solo`, concentration
`unattributed`, authorship `mirrored`, origin `original`, stars `none`, with the
headline "Shipping, but it is an unattributed mirror account: 44 commits in 90
days" and two caveats: a mirrored repo hides a team and a contractor equally
well, and every reviewed repo was created inside the window so cadence cannot be
told from a launch push. That is the right read and it is what the test
`reads a private-repo mirror as unattributed` pins.

---

## 4. From diagnostic to decision (second pass, 2026-09-15)

The first pass was a paid on-click panel that reached nothing else. This pass
makes the read count, shows the trend, names the people, grades the words,
proves the code is live, compares like with like, measures use, checks repo
health, discloses coverage and backtests the grades.

| # | What an investor needed | Where it now lives |
| --- | --- | --- |
| 1 | The read reaches the verdict, the checklist and the saved report | `api/shipping-summary.ts` (scan-time lane, middleware-gated, six-hour cache) → `TokenDossier.shipping: ShippingSummary` frozen by `src/token/audit.ts` (Corroborate · Development) → `judge()` in `src/threat/scan.ts` scores it class-aware (stalled or thin utility: soft 10 / 6; rally without shipping: 8; departed lead: 6; unbacked claims: 6; suspect stars: 5; poor health: 3; team shipping, live code and outside use as positives; memes never penalised for thin development; absence never penalised) → `shippingCheck()` in `src/lib/scanChecklist.ts` closes the `github-forensics` row (confirmed / finding / unavailable / honest unknown) → `ShippingScorecard` prints the frozen read in the report and the PDF (`#development`). The sweep (`server/sweep.ts`) injects the same collector so watched tokens carry it too. |
| 2 | Trend, deltas and a stall alert | `trend` in the assessment: 52 weeks of provider commit statistics per repo (`stats/commit_activity`), price per week, releases and deploys as ticks, drawn by `TrendChart` in the panel with the 90-day window shaded. `developmentDelta()` in `src/lib/reportDelta.ts` is a new material-delta category computed at save time from the prior report (stalled, halved, team halved, lead departed, resumed) and carries `previousShipping` so the panel can print the delta line. The sweep emits a `stall` alert when a watched token that was shipping reads stalled, thin, halved or lead-departed. |
| 3 | Who, and whether they are still there | Committer accounts are resolved in one GraphQL query (`readIdentities`): X handle, employer, public orgs, account age, joined onto the roster. `committers.churn` reads the prior-60-day lead against the last 30: `departed` when the lead stopped and others continued; `goneQuiet` lists everyone who did. Rendered as "Still there?" and per-person 30/60-day counts with links to GitHub and X. |
| 4 | Claims against the project's own words | `api/x-posts.ts` returns the project account's last 60 posts (twitterapi.io `last_tweets`, panel-metered); the panel joins them on click and `claims` grades every shipping claim against releases and commit bursts. `extractRoadmapClaims()` finds dated promises ("Q3 2026: mainnet", "H1 2026", "March 2026") in docs text and grades them met / missed / pending against releases, deploys and weekly commits; investigations pass the site's retrieved text. |
| 5 | Proof the code is live | `api/evm-deployer.ts` now returns `deploymentList` (address, time); the panel fetches it on click and `live` reads deploys and npm publishes (registry `time` map, keyless) that follow a release or a burst of commits within 14 days: live / committed-only / deploys-without-code. No public repo reads as unknown, and the checklist says private builders are read through on-chain deploys. |
| 6 | Like against like | `api/shipping-cohort.ts` builds the stage cohort from the workspace's own saved token reports: same chain, a quarter-to-four-times cap band, half-to-double age band, at least five members, subject percentile on commits and human authors, share still shipping. The sector leaders stay in the panel labelled "the ceiling, not the yardstick". |
| 7 | Adoption, not attention | `adoption` from pull-request and issue `authorAssociation` (OWNER / MEMBER / COLLABORATOR are insiders; everyone else is outside), forks pushed to inside the window, npm downloads last month: used / noticed / unused. |
| 8 | Repo health | `health` from the default branch's `statusCheckRollup`, licence class (permissive / copyleft / source-available / none), an `audits/` or `audit/` directory, and the last commit touching a lockfile: sound / mixed / poor. |
| 9 | Coverage and backtest | `coverage` on every assessment (repos read of total, commits read of counted, star-history days, whether yearly stats and identities were read, verbatim read notes such as the stargazer restriction) shown as "What this read saw". `scripts/backtest-shipping.ts` takes `eval/shipping-backtest.json`, reads each subject as of a past date (`collectShipping` with `now` and `until`), grades it with the same pure function, and pairs the grade with the forward return from GeckoTerminal daily candles; output is the grade distribution against outcomes. |

Tests added: `src/threat/shipping.decision.test.ts` (14), `src/threat/scan.shipping.test.ts` (6),
`api/shipping-cohort.test.ts` (3), `api/shipping-summary.test.ts` (3), plus development
cases in `src/lib/reportDelta.test.ts` and `src/lib/scanChecklist.test.ts`, and the
rewritten `api/github-shipping.test.ts` (12) with a URL-routed fetch.

**Backtest.** `eval/shipping-backtest.json` now holds 33 subjects whose token
addresses were confirmed on DEX Screener and whose GitHub organisations were
confirmed to exist, read as of 2026-04-01 with a 90-day horizon. The run
found two bugs before it found anything about tokens: a `Math.max(..., NaN)`
that poisoned the recency read, so a repository with no commits in the window
graded "unknown" instead of "stalled" (fixed, pinned by a test, and it
affected live reads too); and a "thin" rule that fired on 400 small commits
from 21 people (now thin needs low volume as well as low substance). With
those fixed:

| grade | n priced | median 90-day return | share positive |
| --- | --- | --- | --- |
| shipping-team | 8 | -14% | 38% |
| stalled | 2 | -32% | 0% |
| thin | 1 | -31% | 0% |

The direction is what the engine assumes (stalled and thin projects did worse
than shipping teams over a quarter in which almost everything fell) and the
numbers are far too few to reweight anything. Coverage is the limit, not the
method: 11 of 33 subjects priced (GeckoTerminal rate-limits bursts and serves
200 daily candles), and 4 failed at GitHub's edge (the wide GraphQL query
times out on the largest organisations even at the five-repository fallback).
The set is skewed to blue chips because those are the tokens with verifiable
GitHub organisations; the stalled and thin rows that would carry the finding
are exactly the projects that rarely link a repository. Growing the set means
adding small tokens with linked repositories as they are scanned, which the
frozen summary on every saved report now does automatically.

## 5. Still open

1. **Backtest breadth.** 33 subjects, 11 priced. The engine's development
   penalties remain judgement until stalled and thin rows number in the dozens;
   small tokens with linked repositories are the rows to add, and each saved
   report now contributes a frozen summary to that pool.
2. **Very large organisations.** GitHub's edge returns 502 on the repository
   query for the largest orgs even at the five-repository fallback. A
   per-repository read path (one query per repo, no nested samples) would
   close it at the cost of more calls.
3. **Star lists.** Only a repository admin can read who starred. If a project
   under review grants collaborator access, the stargazer sample input already
   runs the account-level StarScout read.
