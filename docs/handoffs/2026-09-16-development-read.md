# ARGUS development read, 2026-09-16

Prepared for Kyle to absorb and approve. Author: Enigma with Claude.

## What this repository is

ARGUS is the crypto due-diligence product: a reader starts with a decision
(back this token, this founder, this project, this site) and ARGUS builds the
evidence, keeping confirmed facts, decision-changing risks and open questions
apart. `main` is the canonical product; every change lands through a reviewed
pull request with four required checks, and a merge deploys production on
Vercel. `ARGUS-SOURCE-OF-TRUTH.md` governs what the product may claim.

## What changed, and why

Until today a project's GitHub was a paid on-click panel that recovered
committer emails and forks and reached nothing else: not the score, not the
checklist, not the saved report. Today's work turns the repository into a
development read that every project-shaped report carries and scores.

The governing idea, taken from a builder-discovery product on Robinhood
Chain that we reviewed (it is deliberately not named anywhere in this
repository): read *what was shipped* apart from *how the token trades*, and
set the two beside each other. ARGUS then goes where that product does not:
it says who is committing, whether the lead has stopped, whether the stars are
bought, whether the marketing claims are true, and how the project compares
with its sector and with tokens at the same stage.

## The seven merges

| PR | Commit | What it does |
| --- | --- | --- |
| [#427](https://github.com/kylekmcconnell-arch/argus/pull/427) | `064dab8` | The assessment: pure judgement in `src/threat/shipping.ts`, the collector in `src/threat/shippingCollect.ts`, the scan-time lane `api/shipping-summary.ts` that freezes a summary onto the token dossier, engine penalties in `judge()`, the checklist row, the scorecard on the token report, a `development` material-delta category, a `stall` alert in the watchlist sweep, the on-click panel with the yearly trend, committer identities and churn, claims graded against the project's own posts and dated roadmap promises, adoption, repo health, star timing from GitHub's daily history, sector leaders, a stage cohort from saved reports, coverage disclosure, and the backtest harness. |
| [#428](https://github.com/kylekmcconnell-arch/argus/pull/428) | `af37b82` | The scorecard on the investigation report (addresses open as investigations; found while verifying #427 in production). |
| [#429](https://github.com/kylekmcconnell-arch/argus/pull/429) | `5689bd1` | The frozen read joins the token's daily price series and the deployer's contract creations (`src/threat/deployTrail.ts`, keyless on Blockscout chains, keyed on Etherscan chains), so the saved card says "shipping into weakness" and "live" without a click; `scripts/backtest-from-reports.ts` grows the backtest set from saved reports; development signals in the noticed rail; a development line in the plain-text export. |
| [#430](https://github.com/kylekmcconnell-arch/argus/pull/430) | `46f805c` | Backtest set grown to 49 subjects with verified small caps. |
| [#414](https://github.com/kylekmcconnell-arch/argus/pull/414) | `57dbb32` | Robinhood Chain launch-farm learnings and the curated cabal registry (earlier work, brought current with main and merged; the snipe-ring entry for the reviewed product's token is keyed by contract address with the name withheld). |
| [#433](https://github.com/kylekmcconnell-arch/argus/pull/433) | `4a8fd43` | Merged after this handoff was first written: the o1 Launchpad (o1.exchange) becomes a launch venue in `src/threat/launch.ts` with server-side detection from its current and historical Robinhood factories, and the $WRESTLER registry record is retagged from "RWAERC20LaunchpadFactory" to o1, which o1's own contract registry identifies as its Robinhood Launch Factory. `RESEARCH.md` gains the o1 fee mechanics and a creator fee-farm read from Base. |
| [#435](https://github.com/kylekmcconnell-arch/argus/pull/435) | `fffa6fb` | Merged after this handoff was first written: the first Solana entry in the cabal registry, a pump.fun launch whose creator wallet is the coin-creator fee sink of ten PumpSwap pools that throwaway wallets opened with 191 to 451 SOL each and drained within minutes. Registry tests accept base58 addresses; `RESEARCH.md` carries the detection recipe. |

## What a reader now sees

- **Development scorecard** on token and investigation reports, frozen at
  scan time and printed with the PDF: grade (shipping team / solo / thin /
  stalled), cadence, who is committing and whether the lead has stopped,
  authorship (hand-authored / mixed / machine-heavy / mirrored), origin
  (original / derivative), reaching production (live / committed only),
  used by outsiders, stars (organic / suspect), repo health, chart vs commits.
- **Score and checklist.** A utility token that stalled loses up to 10 points
  (thin: 6); a rally with no code behind it (8), a departed lead (6),
  unbacked shipping claims (6), suspect stars (5) and poor repo health (3)
  score on any class. Every penalty is `soft()`: relaxed on established
  tokens. Memes are never penalised for thin development (they never claimed
  it). A missing or unreadable repository is never penalised. Positives: a
  shipping team, code that reaches production, outside contributors. The
  `github-forensics` checklist row now closes (confirmed / finding /
  unavailable / honest unknown) instead of reading "unknown" forever.
- **Noticed rail, deltas, alerts.** Stalls, rallies without code, departed
  leads and suspect stars sit in the noticed signals beside unlocked liquidity
  and holder concentration. A re-scan reports a development delta (stalled,
  halved, team halved, lead departed, resumed). The watchlist sweep raises a
  `stall` alert.
- **On-click panel** (paid, metered like the other deep tools): a year of
  weekly commits under the price line with releases and deploys as ticks;
  committers with X handle, employer and orgs and their 30/60-day split; the
  project's own "we launched X" posts graded against releases and commit
  bursts; dated roadmap promises graded met / missed / pending; comparison
  against three leading repos in the detected sector and against tokens at
  the same stage from this workspace's saved reports; "What this read saw".

## Decisions taken (please confirm or overrule)

1. **The reviewed product is not named in the repository.** Docs, comments,
   fixtures, PR bodies and the cabal registry refer to it generically or by
   contract address. Commit history keeps earlier mentions; force-push is
   disabled here.
2. **Penalties are judgement, capped and soft.** The backtest points the
   right way (stalled and thin projects did worse than shipping teams over
   the quarter) on too few priced rows to reweight anything. The weights
   above are the ones live now.
3. **Absence is never a finding.** No public repository reads as "unread";
   the checklist says private builders are read through on-chain deploys.
4. **The scan-time lane is unmetered.** It sits behind the middleware bearer
   gate like site-safety and costs GitHub calls (about 10 per scan, up to
   about 20 for very large organisations), one GeckoTerminal call and one
   explorer call; a six-hour cache dedupes repeats.

## Verification done

- Every PR: full vitest suite green (4,66x tests), `tsc` clean for app, API
  and server, ESLint clean on changed files, the four required checks green.
- Production, signed in as Enigma: scanned GMX (its official links carry the
  GitHub org). The lane returned 200, the saved investigation carries the
  frozen read (shipping team, 116 commits, 7 people, lead of the prior two
  months has stopped), the checklist row closed as a finding, the scorecard
  renders, and after #429 a rescan (version 2) carries the price join
  (`aligned-up`) and the deployer trail (`committed-only`).
- Backtest harness run live on 49 subjects as of 2026-04-01 / 2026-06-15.

## How to verify yourself (ten minutes)

1. Open the saved **$GMX** case. Below "People" there is a "Development ·
   github.com/gmx-io" card; the noticed rail should show "The lead committer
   has stopped".
2. Scan any token whose official links carry a GitHub organisation. Watch
   the trace for "Corroborate · Development"; the card appears on the report,
   and the "Everything we checked" list carries a development row.
3. Open the shipping panel on that report ("assess shipping") to see the
   yearly chart, the roster and the coverage disclosure.
4. Scan a token with no linked repository: no penalty, and the checklist row
   says why.
5. `docs/GITHUB-ANALYSIS.md` is the full write-up; `eval/shipping-backtest.json`
   is the set; `npx tsx scripts/backtest-shipping.ts` runs it with a
   `GITHUB_TOKEN`.

## Operations

- `GITHUB_TOKEN` is set in production (confirmed in Vercel and by the health
  endpoint). Without it every report reads the lane as unavailable, never
  failed.
- `ETHERSCAN_API_KEY` is used for the deploy trail on Etherscan chains;
  Robinhood Chain and Gnosis read Blockscout keyless.
- One migration: a partial index on `reports (organization_id, payload->>'chain')`
  for token rows carrying the read, for the stage-cohort query.
- Rollback of any PR is a revert; the frozen field is optional and older
  reports render without it.

## Known limits

- GitHub restricted stargazer lists to repository admins on 2026-06-30. Star
  timing uses the public daily star-history endpoint GitHub shipped on
  2026-09-04; the account-level fake-star screen cannot run.
- GitHub's edge times out the wide query on the largest organisations; the
  collector falls back to per-repository reads and says so.
- GeckoTerminal's free tier serves 200 daily candles and rate-limits bursts,
  which bounds how many backtest subjects price per run.
- Only npm, PyPI and crates.io are read for package publishes and downloads.

## Open

- Backtest breadth: priced stalled and thin rows in the dozens are needed
  before the penalty weights can be set on evidence. Every saved report now
  feeds the set; `scripts/backtest-from-reports.ts` needs the service
  credentials, so it belongs where the sweep runs.
- A paid GeckoTerminal tier would lift the pricing bound if the backtest is
  worth it.

## Asks

- Approve the four decisions above, or say which to change.
- Confirm the penalty weights are acceptable as a starting point.
- Decide whether the scan-time lane should stay unmetered.
