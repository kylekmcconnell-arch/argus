# GitHub analysis: the HEY Research Lab review and the ARGUS shipping assessment

Date: 2026-09-15. Branch: `feat/github-analysis`. Author: Enigma with Claude.

This note records (1) a due-diligence review of HEY Research Lab and its token,
(2) what in HEY's published code is replicable and what is not, and (3) the
design of the shipping assessment that this branch adds to every project-shaped
ARGUS report (token, investigation, recon), with the parts still open.

---

## 1. HEY Research Lab, reviewed with our own checklist

**What it is.** heyresearch.xyz is a builder-discovery site for Robinhood Chain
(chain 4663). It tracks projects, records "ships" (GitHub releases, code
activity, contract deploys), derives an activity status from source-backed
development only, shows token market status beside it but never inside it, and
ranks builders on a formula that ignores price. The `$HEY` token pays research
bounties and gates API allowance. The founder's rule that holders are never
tracked was relaxed on 2026-09-14 for one bubble map of one token's supply.

**The GitHub.** `github.com/hey-research-lab/hey-research-open`, MIT, created
2026-09-11. Read with the checklist the user asked for:

| Question | Finding |
| --- | --- |
| Maintained properly? | Yes at the code level: strict TypeScript, `any` banned, 69 test files (~41% test-to-source lines), CI with a secret scan before lint, a real lockfile, dated rationale comments on almost every decision. |
| Commit cadence | 44 commits in 4 days (2026-09-11 to 09-15), all squashed "Sync from HEY Research Lab (hash)" exports. HEY's own project page reports "43 commits in the last 90 days across 1 contributor", which is exactly what our GraphQL read returns. |
| Who commits | One account, the `hey-research-lab` noreply identity, created 2026-09-11. The public repo is a mirror; the private repo's contributor list is invisible. The squashed bodies list the private commit subjects, so the private cadence is readable (security fixes, denominator audits, deslop passes) even though authorship is not. |
| Commits tied to people | Nobody. The manifest's redaction list discloses the shape of what was scrubbed: a founder's former handle, a production IP, local `~/.claude` paths. The project is Claude-Code driven (its docs cite `CLAUDE.md` rules by number). |
| Substance | Real. The sync commits change hundreds of lines across 10 to 20 files each. `packages/sources` (9.7k lines, 52 test files) and `packages/scoring` (1.2k lines, every threshold published) are genuine work, not boilerplate. |
| Vibe-coded or unique? | AI-assisted, human-directed. The tell is negative results and self-corrections with production numbers ("twenty-eight token-days summed past 100%", "$7.3 septillion market cap", the 2026-09-03 admission that the main Pons factory was never indexed). Generated code does not record what it got wrong. |
| Replica of something else? | No. It is the mirror-image of Santiment's dev-activity idea applied to one chain, but the code is its own. Zero forks in the account. |
| Marketing matches code? | Mostly. The pinned X post promises "GitHub activity and commit velocity, shipping frequency, builder..." and the site does that. The README says the scoring rules stay private; they are in fact published in full in `packages/scoring`. The MCP docs say "five tools" three times and list eleven. |
| Stars | 0 stars, 0 forks, 0 watchers on 2026-09-15. Nothing to authenticate; also nothing anyone is using. |
| Who talks about them | The @HeyResearch account has 1,509 followers and ~351 posts; the pinned post reached 11k views. No third-party project, builder or KOL was found citing HEY as a data source. Their MCP server has no npm package and no download count. |

**The finding the checklist would have missed.** The brand is recycled. The
@HeyResearch X account joined October 2022 and on 2023-01-12 posted "$HEY, great
news for our investors! We're extending our liquidity lock for an extra year"
for an Ethereum token, `0xE61F6e39711cEc14f8D6c637c2f4568bAA9FF7Ee`, whose
verified source header names `heytoken.pro`, `t.me/heyerc20` and
`twitter.com/heyresearch`. That project ("a research platform to help
pro-traders or institutions gather obscure crypto alpha", MVP Medium post,
GitHub `heyplatform` with two commits by "Hey Research Dev <hi@heyresearch.io>")
went offline in August 2024 and its token reads $0.00 with 520 holders today.
The 2026 site, docs and token page never mention it. This is the
relaunch/rebrand pattern in `investigation-methodology`, and the new token's
launch already sits in the cabal registry on `feat/robinhood-launch-farm-cabals`
as `rh-snipe-ring-hey` (seven same-block wallets took 15.4% and dumped;
deployer never sold). The lineage should be added to that entry.

**The token, briefly.** Pons V2 launch 2026-09-09, 1B supply, 2% creator tax to a
treasury, graduated in 7 minutes. On 2026-09-15: $160k to $183k market cap,
~$37k liquidity in the main HEY/ETH v4 pool, $65k 24h volume, 253 buys / 344
sells, price down 26% on the day. HEY's own market page says $102 can be sold
before a 1% move and 22 addresses hold half the supply. Two dust pools were
created on 2026-09-15 morning.

**Verdict on HEY as a subject.** Real product, real code, one visible builder,
no adoption yet, a recycled brand with an abandoned 2022 token behind it, and a
launch that snipers dominated. Not a scam; a thin, early, single-operator project
whose marketing ("builder intelligence layer for Robinhood Chain") is ahead of
its footprint.

---

## 2. Is HEY's method replicable?

Yes, about 80% of the GitHub-assessment method is in the open repo, and the
remaining 20% is exactly the part that is hard.

**Published, reusable today**

- Every data adapter with saved fixtures: GitHub repo, releases, commits, code
  search, contents, owner repos; Blockscout, DEX Screener, GeckoTerminal,
  CoinGecko, launchpads, feeds, npm. Bot and dependency-bump commit filters.
  "One `CODE_ACTIVITY` event per repo per ISO week" so commit spam cannot
  inflate a score.
- The complete scoring rulebook: Build Momentum weights (recency .35,
  consistency .25, significance .20, verification .15, diversity .05), 22 event
  base weights (product launch 10, docs 3, announcement 0), activity thresholds
  (7/30/60 days), Still Building (market at or below 50% of the 90-day high while
  building continues), the market-status decision tree with all eight
  thresholds.
- The link-provenance rule that makes a repo mapping authoritative: the project
  must link the repo from a site it controls; a name or ticker match never
  qualifies.
- The wording discipline: status never by colour alone, absent means unknown
  (never 0), "no builder signal yet" instead of "unknown", market data shown
  beside development and never inside it, no verdict words.

**Withheld in the private repo**

- The candidate pipeline and quality gate: how a code-search hit on a chain
  fingerprint becomes a project, the STRONG/WEAK fingerprint grading, the
  identity-resolution rules, the launcher-template rejection list.
- The `CODE_SEARCH_MARKERS` list that finds repos by deployment fingerprint.
- The database schema, the worker, the signal-rule engine, the Builder Radar
  sub-scores.

**What ARGUS should take.** Not the pipeline (we scan one subject at a time; HEY
indexes a chain). Take the separation of development from market, the evidence
labels on every ship, the weekly capping, the plain-language status vocabulary,
and the honesty rules about absence. Then go where HEY deliberately does not: HEY
"publishes no verdicts" and never names people; ARGUS exists to say who is
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
| Tests | `src/threat/shipping.test.ts` (24), `api/github-shipping.test.ts` (10), `src/components/GithubShipping.test.tsx` (3) | Fixtures include the HEY mirror shape, a bought-stars shape, a launch-week star burst, price-versus-commit joins, claim grading and peer positioning. |

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

### Reading the HEY repo through it

`assessShipping` on the HEY input (44 commits, one noreply mirror account, repo
four days old, 0 stars) returns grade `shipping-solo`, concentration
`unattributed`, authorship `mirrored`, origin `original`, stars `none`, with the
headline "Shipping, but it is an unattributed mirror account: 44 commits in 90
days" and two caveats: a mirrored repo hides a team and a contractor equally
well, and every reviewed repo was created inside the window so cadence cannot be
told from a launch push. That is the right read and it is what the test
`reads a private-repo mirror as unattributed` pins.

---

## 4. Still open

1. **Own-post corpus for claim grading.** The panel accepts `claims` but no
   report currently carries the project's own X timeline (the social-activity
   snapshot holds mentions of the subject, not its posts). Feeding the
   project-account posts collected during the audit into `ProjectResearch` turns
   the claims block on with no other change.
2. **Committer → X bridge.** For each human login in the roster, call the
   existing `/api/resolve-github` in reverse (GitHub `twitter_username`, bio
   handle) and show the X handle beside the login; the org-member path in
   `api/recon-team.ts` already does this for public org members.
3. **Scan-time lane.** The panel is paid and on-click. A cheap scan-time version
   (one GraphQL call: repos with `history(since).totalCount`) can close the
   `github-forensics` checklist row that today is never produced, and let the
   engine penalise "price without shipping" the way it penalises other
   contradictions. That needs the five-file check registration described in
   `server/checks.ts` and must leave the frozen check arrays untouched.
4. **Downloads and usage.** npm / PyPI / crates download counts and GitHub
   dependents for the project's packages, against social mention volume, to
   answer "who is using them versus who is talking about them".
5. **Cabal registry.** Add the 2022 Ethereum HEY lineage to `rh-snipe-ring-hey`
   on the cabal branch once it merges.
6. **Star lists.** Only a repository admin can read who starred. If a project
   under review grants collaborator access, the stargazer sample input already
   runs the account-level StarScout read.
