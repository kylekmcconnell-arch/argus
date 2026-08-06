# ARGUS master review brief

You are reviewing ARGUS, a crypto due-diligence engine. Read this whole file before opening code. It exists so you spend your effort on real defects instead of rediscovering things that are already known, already fixed, or already disproven.

---

## 1. What the product is, and what "a bug" means here

ARGUS takes an X handle or a token contract, gathers evidence from ~34 provider adapters, and produces a scored, signed verdict a human will act on with money.

**The governing value is epistemic honesty, not uptime.** The worst defect this codebase can ship is not a crash. It is a sentence that a reader believes and that is not true. Rank findings that way.

The four failure modes that matter most, in order:

1. **A false claim about a real subject.** Publishing another company's funding round, calling a live developer "gone", naming someone an impersonator. These are close to defamatory and they outrank everything.
2. **Absence published as exoneration.** "No adverse findings" when the screen never ran. "0% insider supply" when holder data was suppressed. A provider that did not answer must never render as a clean answer.
3. **A bounded read published as a total.** A capped list, a truncated page walk, a partial candle window, a counter at its provider's ceiling. These must publish as floors.
4. **A provider's opinion adopted as ARGUS's finding.** GMGN's wallet tags, RugCheck's flags, Snapshot's verified flag: all are carried with attribution and never restated as ARGUS having verified them.

A finding that says "this could crash" is worth less here than a finding that says "this prints something untrue."

---

## 2. Where to work

- Repo: `/Users/kyle/Documents/ARGUS`, worktree `.claude/worktrees/visual-overhaul`
- Branch: `integrate/uniswap-final`, currently identical to `origin/main` at `9a45bb2`
- Deploy: pushing to `main` only. **Never run `vercel --prod`** from a worktree; it has broken production auth before. Rollback is `vercel promote`.

Scale: 578 TS/TSX files, 240 test files, 65 API routes, 34 adapters, 111 components.

**Read `docs/architecture.json` first.** It is a self-describing map of the pipeline, adapters, scoring, invariants and env wiring, and it is maintained in the same commit as architecture changes. It will save you hours. Its `invariants` array is effectively the spec.

---

## 3. Gates you must run before reporting anything

```bash
npm run typecheck      # tsc -b + server + api tsconfigs. NEVER bare `npx tsc --noEmit`: it skips 2 projects
npm test               # full vitest suite, currently 240 files / 2826 tests, all passing
npm run canary:offline # 7 deterministic release cases, all providers intercepted, expect 0 unexpected URLs
npm run calibrate      # 19-case golden verdict set; the safety net proving scoring changes don't inflate bad actors
npm run truth:check    # source-of-truth doc contract
npm run build          # REQUIRED after editing server/: routes import the api/_collector.js bundle, not source
```

Two gotchas that will waste your time:

- **No em dashes or en dashes anywhere in authored copy.** Enforced by a `uiCopyPolicy` test, the analyst validator and `truth:check`. The local vitest run is flaky on this specific test; CI is not. Grep your diff before pushing.
- **After any `server/` edit you must `npm run build`.** API routes import the generated bundle. Editing source without rebuilding produces a passing test suite and a production that ignores your change.

---

## 4. Review offline, for free, using the eval harness

Live audits cost real money (see §7). You do not need to spend any to review.

```bash
npm run eval:replay -- @uniswap    # replays a full recorded pipeline offline, deterministically, for $0
```

Three recordings exist under `eval/recordings/`: `uniswap` (20MB), `linkrbot`, `orbitgroup_ai`. Each contains `calls.jsonl` (every provider request/response, including the Anthropic calls), `emits.jsonl`, and `snapshot.json` (the finished dossier, including the run's own `costUsd`).

**The single highest-yield review technique in this codebase is reading what a run actually did, not what the code appears to do.** The most valuable findings in the last audit round came from replaying uniswap and inspecting the emitted evidence: that is how it was found that the scam sweep screened `$ARB` on a Uniswap audit (it took `evidence.promotions[0]`, the first ticker the account ever mentioned, while routing had already resolved `$UNI`), and that `check_follow_relationship` was being bought twice for the same pair depending on race timing. Neither was visible by reading the source.

Do this. Replay, then diff what was published against what the evidence actually supports.

---

## 5. What changed in the last session (review this first)

Five commits, ~3,850 insertions. All shipped to production with green CI.

| commit | what |
|---|---|
| `5a67b3e` | GMGN bundle panel (`server/adapters/gmgn.ts` `fetchGmgnBundleReading`, `api/gmgn-bundle.ts`, `src/components/GmgnBundlePanel.tsx`) + ARGUS's own early-buyer funding tracer (`api/early-buyers.ts`, `api/_funding-core.ts`, `src/components/EarlyBuyerFunding.tsx`) |
| `79c5ac8` | Removed a published claim built on GMGN's `cto_flag` |
| `acd0f94` | Namesake collision fix: `src/lib/projectLeadRelevance.ts` extracted from `Report.tsx`, funding/investor leads gated |
| `9853251` | Retired providers no longer reported as an outage; LinkedIn person-vs-company split; investigation report now applies the full lead rule |
| `9a45bb2` | Snapshot governance lane (`server/adapters/snapshot.ts`, `api/governance.ts`, `src/components/GovernancePanel.tsx`) |

New code is concentrated in: `api/early-buyers.ts` (478 lines), `server/adapters/snapshot.ts` (476), `server/adapters/gmgn.ts` (+360), `src/lib/projectLeadRelevance.ts` (179), `src/components/GovernancePanel.tsx` (180), `src/components/EarlyBuyerFunding.tsx` (172).

**Specific things to attack in the new code:**

- `api/early-buyers.ts`: the launch-window walk collects signatures across the last few pages because failed sniper spam dominates the oldest page. Is the window it produces actually the launch, or can it start mid-life on some token shape? The CEX-funder exclusion uses `src/lib/marketAddresses.ts`; is that list complete enough that a shared exchange never forms a cluster? `historyTruncated` wallets are excluded from clustering: verify they cannot leak into a cluster by another path.
- `server/adapters/snapshot.ts`: the binding rule is `verified === true` AND one of (strategy reads the audited token contract / space X handle matches / space website relates to official domain). Try to construct a case that binds the wrong space. Note the live trap that motivated it: `dodus.eth` is named "uniswap", has 0 followers, and its voting strategy points at the genuine UNI contract.
- `src/lib/projectLeadRelevance.ts`: the discriminator for a namesake is industry vocabulary, because naming the subject proves nothing. A same-named *crypto* project would still pass. Is that reachable in practice?
- `server/adapters/gmgn.ts`: every number is GMGN's and must be attributed. `wallet_tags_stat` caps at 1000, so counts at the cap must render as floors.

---

## 6. Defect classes found in the last session. Sweep for more instances of each.

These are not one-off bugs. Each is a pattern, and each was found in production code that looked correct. **Finding further instances of these is probably the highest-value thing you can do.**

1. **A provider's field name overclaims what its values mean.** GMGN's `cto_flag` is documented as "community takeover, original dev abandoned". Measured across ten tokens it is `1` on nine, including JUP, WIF, BONK, POPCAT, TRUMP and pump.fun tokens minutes old, and `0` only on USDC. ARGUS was rendering "the original developer is gone" for essentially every Solana token. **Sweep: every place a provider's boolean or enum is trusted to mean what it is named.**

2. **The name IS the collision, so naming the subject is not a guard.** An audit of `$STONKBROKER` (project named Clutch) published a funding round from a law firm's page about Clutch the Canadian used-car retailer. A "does the document mention the subject" test cannot catch this, because the namesake page genuinely mentions it. **Sweep: every lane that resolves an entity by name.** The lanes that already do this right are DeFiLlama (a slug discovers, only the CoinGecko id binds) and Monid (refuses to search by company name at all).

3. **Attacker-chosen values cannot establish identity.** A Snapshot space's strategy address is set by whoever created the space. An LP locker's contract name is chosen by its author (the motivating case was literally named "CheeseLock"). **Sweep: any binding that trusts a value the counterparty controls.**

4. **A detection failure silently becoming a negative claim.** The Snapshot delegation caveat was gated on recognising a delegation-aware strategy by name; Aave's opaque `contract-call` strategies failed the regex, so the caveat vanished and voting-power shares read as ownership. False must mean "not recognised", never "not present". **Sweep: every boolean derived from pattern-matching a provider value, and ask what happens when the pattern misses.**

5. **A disabled subsystem reported as a degraded one.** `/api/health` listed retired adapters (Crunchbase, Reddit, both commented out of the registry) as merely unconfigured, so every report carried a red "2 providers are unavailable, this report has reduced coverage" for lanes that cost nothing, and pointed at a rescan that could not change anything. **Sweep: every user-facing status derived from a config check rather than a capability check.**

6. **Test fixtures too sparse to exercise the rule they cover.** `BasicFactLead.excerpt` is required in production, but component fixtures cast through `unknown` and omitted it, which made an identity rule look far too aggressive under test. **Sweep: fixtures cast through `as unknown as`, and check they carry the fields production guarantees.**

---

## 7. Cost, so you do not spend the user's money

Live audits are billed. Measured from the recorded runs' own ledgers:

| recording | `costUsd` | model mix |
|---|---|---|
| uniswap | $3.44 | 27 calls, all Sonnet 4-6 |
| linkrbot | $2.18 | 19 calls, all Sonnet 4-6 |
| orbitgroup_ai | **$1.08** | 18 Haiku + 3 Sonnet 5 |

Production today runs Sonnet 5 analyst, **Haiku discovery on the grounded route**, Gemini flash-lite extraction via OpenRouter, and knowledge-base reuse (confirm with `GET /api/health`, which is zero-spend). Only `orbitgroup_ai` was recorded under that configuration, and it cost roughly half of `linkrbot` on slightly more input tokens. So `$3.44` describes a configuration no longer in use.

Under the current route, **discovery volume dominates and the analyst is nearly free**: in `orbitgroup_ai` the analyst used 14,833 input tokens across 3 calls while Haiku discovery used 331,263. Optimise discovery, not the analyst.

**Do not run live audits to review.** Replay. If you believe a live run is genuinely required, say so and ask first.

---

## 8. Do NOT report these. They are already disproven, with evidence.

Re-reporting these wastes a review cycle. Each was investigated and rejected:

- **LP-locker name allowlist**: locker contract names are attacker-chosen ("CheeseLock").
- **Preferring RugCheck's `totalHolders`**: it returns 0 for USDC.
- **Any browser-side pump.fun call.**
- **GitHub org `public_members` walk.**
- **Scraping GitHub hrefs from site HTML**: already done in `src/collect/recon.ts`.
- **"Launch N of N has no date filter"**: fixed and tested (`operatorLaunches.test.ts`: "never calls the audited token the operator's latest when a sibling is newer").
- **GMGN's AI rating being unread**: deliberate. A score ARGUS did not compute must never reach a verdict it signs.
- **GMGN's `cto_flag`**: see §6.1. Parsed, never published, with a regression test.
- **Snapshot `search` for space discovery**: their search ignores `orderBy` and never returns the real space for "uniswap" or "gitcoin".

---

## 9. Known-open work (context, not necessarily your job)

- **Notable-follower lane is concurrency-starved.** Reference set is 304 accounts with a fixed 45s self-budget. Measured against @uniswap: CHUNK 15 checks 82; CHUNK 60 checks 302. But the end-to-end run at 60 cost $4.45 and returned 13 verified facts (failing `minVerifiedFacts` 15) versus $3.44 and 24 facts at 15. One run per arm cannot separate the change from variance. Needs 2-3 live runs per arm, roughly $27. **Reverted to 15 pending a decision.**
- **`SuspectedImpersonation` has never had a producer.** `git log -S` is empty. Wiring it means crossing identity signals where a false positive accuses a real person of impersonation, so the evidence bar needs designing deliberately.
- **Funding namesake, deeper fix.** The current guard uses industry vocabulary; a same-named crypto project would pass. The real fix is a counterparty-corroboration hop like `securityAudits.ts` (the auditor's own domain must name the subject).
- **Snapshot space discovery misses irregular ids** (Lido, Compound, Optimism). The clean fix is reading the Snapshot link off the project's own site; `src/collect/recon.ts` already extracts links and the adapter already accepts a supplied `spaceId`.
- **`api/_funding-core.ts` is the first shared home of the Solana funding walk.** `api/deployer.ts`, `api/deployer-origin.ts` and `api/cluster.ts` still carry private copies. Folding them onto it needs all three to move at once.
- **Junk on disk**: `eval/recordings/uniswap/` contains duplicate `... 2.jsonl` macOS copy artifacts, ~20MB of noise.

---

## 10. How to report

For each finding give:

1. **The false sentence or wrong behaviour**, quoted, with `file:line`.
2. **The concrete case that triggers it**: inputs, or a real subject/token, or a recording to replay. A finding without a trigger is a hypothesis.
3. **Why it is wrong**, against §1 and the `invariants` array in `docs/architecture.json`.
4. **Severity** by §1's ordering, not by how hard it was to find.

**Verify before reporting.** This codebase has burned review cycles on plausible-but-wrong findings. Before you write one up, try to refute it: read the surrounding code, check whether a guard already exists elsewhere in the chain, and where possible reproduce it against a recording. Say explicitly which findings you confirmed by execution and which are code-reading only.

If you change anything, every gate in §3 must pass, and `npm run build` must be re-run if you touched `server/`.
