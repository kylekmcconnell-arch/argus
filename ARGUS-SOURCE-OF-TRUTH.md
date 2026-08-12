# ARGUS product and methodology source of truth

Published field manual: [Claude artifact](https://claude.ai/code/artifact/4599c1f2-73cb-462c-9382-65282945a087)

Last reconciled: July 14, 2026

Product version: 3.0

Release state: implementation in validation until the live benchmark canaries pass

This file is the version-controlled companion to the published field manual. The
artifact is the readable product narrative. This file, the evidence contract in
code, and `QUALITY-BENCHMARK.md` together govern what ARGUS may claim. A material
release is not complete until all three agree.

## The decision standard

ARGUS must be more useful than a generic ChatGPT or Claude research scan.

A generic model can summarize public facts. ARGUS must build a reproducible
investment case. It verifies exact fetched passages, separates discoveries from
facts, attributes legal events to the correct person or company, distinguishes
public securities from crypto tokens, connects people, companies, wallets,
contracts, funders, and infrastructure, tests contradictions, ranks unresolved
decision questions, freezes provider states and report versions, and shows what
changed between scans.

The report should feel like a sharp financial adviser who can show every receipt,
not a provider log or a data sheet.

## The ARGUS advantage

Getting the biography, founders, token, product, and headline legal history right
is the minimum acceptable result. The investigation earns its value by connecting
facts a generic answer normally leaves separate. Where the evidence exists, ARGUS
should surface:

- who actually controls the company, protocol, contracts, treasury, governance,
  and public narrative;
- how founder claims compare with dated launches, funding, code, product usage,
  token activity, and prior outcomes;
- where capital came from, which entities received it, what insiders can unlock
  or sell, and which counterparties create concentration risk;
- direct legal or regulatory events separately from company events, associates,
  and same-name records;
- contradictions between first-party claims, historical pages, filings, market
  data, repositories, and independent reporting;
- the strongest evidence against ARGUS's own conclusion, not only evidence that
  supports it;
- what changed since the prior immutable report and whether the investment case
  is strengthening or deteriorating; and
- a short, ranked diligence plan framed as decision-changing questions, with the
  cheapest reliable way to answer each one.

The summary must answer four questions in plain language: what is true, what is
material, what could change the decision, and what ARGUS found that a normal web
summary would probably miss. Raw source inventories and provider telemetry belong
below that decision layer.

## Proof status

This manual separates implemented behavior from release validation and product
targets. A target is not described as shipped until a production report proves it.

- **Implemented and regression-tested:** immutable versions, organization-scoped
  access, source fetch attribution, verified-passage promotion, role-aware scoring,
  direct-versus-related legal attribution, stock-versus-token separation, and
  provider-state truth. The report parent, evidence rows, check runs, and axis
  links now persist in one transaction with exact replay-content equality.
- **Release validation:** the named Brian Armstrong, Hayden Adams, Sam
  Bankman-Fried, and Jupiter canaries; live persistence and reopen; frozen-evidence
  answers; and first-viewport adviser UX.
- **Target:** a repeatable head-to-head benchmark against generic ChatGPT and
  Claude, semantic change analysis between report versions, and next steps ranked
  by decision impact, cost, and reliability.

Green unit tests prove invariants, not live research recall. A famous-person or
major-project release stays in validation until the live collector finds the
adjudicated facts itself.

## Evidence contract

Every published decision fact needs:

- the exact subject and predicate;
- a stable source URL;
- a fetched supporting passage;
- retrieval time and provider state;
- verification state;
- the decision question or scoring axis it affects;
- conflict and counter-evidence handling; and
- immutable report-version attribution.

The evidence states remain distinct: `verified`, `corroborated`, `conflicted`,
`lead`, `unanswered`, `checked_empty`, `unavailable`, `partial`, and `failed`.
Search models discover leads only. They cannot promote a claim without an exact URL
and a passage that was fetched and checked.

Promotion also requires bounded attribution. The subject, predicate, atomic value,
and any date, class, qualifier, or legal status must belong to the same claim. A
partner, portfolio company, competitor, namesake, nearby executive, or another
tenant on a shared host cannot lend its facts to the audited subject. Exact-name
legal or sanctions matches remain identity-review leads until the source binds the
record to the investigated identity.

A batched search that returns no result is unresolved, not `checked_empty` for
every question in the batch. Only a question-specific completed screen can create
a checked-empty outcome. Access failures remain unavailable or partial.

Coverage-only and absence artifacts stay in the immutable evidence catalog for
inspection. They may be linked to an axis only when they match an explicit gap,
and they never count as positive support for a score. A clear sanctions screen,
provider miss, or empty search cannot prove identity, authority, traction, or
integrity.

## Investigation standard

Every founder, project, and investor receives a role-aware question ledger split
into identity, track record, and structure or risk batches. Critical unanswered
questions trigger a targeted repair pass. A thin first pass cannot suppress deeper
research.

Founder readiness is governed by six investor questions:

1. Is identity and current authority verified?
2. Which companies, cofounders, and current roles are verified?
3. What track record and outcomes are established?
4. What control, governance, or conflicts matter?
5. What legal or regulatory history is directly attributable, and what is its
   current status?
6. Which related assets exist, and are they public securities, crypto tokens,
   neither, or both?

Provider diagnostics remain visible, but an optional vendor failure does not make
an otherwise answered investment case incomplete. A `401`, `403`, `429`,
Cloudflare page, or other anti-bot response is an access gap, never evidence that a
site or product is dead. Only a directly served parked or explicit coming-soon page
can support that conclusion.

## Decision experience

The report opens with:

1. the source-backed investment case;
2. what could break the thesis; and
3. what the investor should verify next.

It then shows the ARGUS edge: verified decision facts, cited decision sources,
conflicts tested, relationship records, ranked open questions, and an immutable
evidence snapshot. Provider diagnostics, axes, source excerpts, hashes, and
methodology remain available beneath that adviser layer.

One governing count controls open questions across the header, summary, report
rail, persisted report, and public report. Optional vendor failures do not become
fake investment questions.

## Release canaries

The full live gates and expected outcomes live in `QUALITY-BENCHMARK.md`. The
current subjects are:

- Brian Armstrong, a clean founder and public-security distinction case;
- Hayden Adams, a founder, entity-attribution, and crypto-token case;
- Sam Bankman-Fried, a direct legal-attribution and distressed-token case; and
- Jupiter, a major-project completeness, founder discovery, and token-chart case.

Each canary must run through the live collector, persist as an immutable report,
reopen from storage, and answer grounded questions from frozen evidence. Hand-coded
demo facts do not count.

The build does not ship when a famous subject misses an obvious foundational fact,
report persistence fails, the headline says zero open questions while the body
lists gaps, an access-blocked site becomes adverse evidence, a company legal event
is attributed to a founder, or a stock and token are conflated.

## Continuous-update rule

For every material investigation, scoring, provider, persistence, or report-UX
change:

1. Update this file and the relevant benchmark or audit document in the same
   change set.
2. Add or update deterministic regression coverage.
3. Run unit tests, TypeScript checks, touched-file lint, offline canaries,
   calibration, and a production build.
4. Run the live founder and project canaries in production, persist them, reopen
   them, and inspect grounded answers.
5. Republish the Claude field manual to the same artifact URL and update its date.
6. Record only observed production behavior as shipped. Keep unverified targets
   labeled as validation work.

## July 14, 2026 reconciliation

Full-clearance coverage policy. A recorded outcome for every applicable check
remains the ideal, but an enrichment path a provider cannot serve no longer
withholds final clearance indefinitely. One shared rule now governs the stored
completeness claim, the trust-graph qualification cross-check, and the
readiness status. Clearance requires both: every never-waive safety screen
recorded (identity resolution, OFAC sanctions name screen, trust-graph
connections, and founder related-asset distinction, because an unresolved
token or security candidacy is a capital-risk unknown, never an enrichment
gap), and recorded coverage of at least 75 percent of applicable governing
checks. Waived gaps stay disclosed in the readiness guidance; only their power
to withhold clearance changed. Legacy snapshots without stable check ids keep
the strict everything-recorded rule.

Evidence sources. Project audits now complete backing and traction from hard
public data: DeFiLlama funding rounds and lead investors plus on-chain TVL
(free, keyless), with Monid/Akta private-company enrichment (funding, lead
investors, leadership, firmographics; keyed and metered) as the fallback when
the free source has no record. A verified founder's primary venture is
resolved the same way, minting a venture-scoped financing fact that never
presents the person as having raised the money themselves. A supplementary
EU, UN, and UK (FCDO) consolidated-sanctions screen now runs beside the OFAC
screen as a frozen artifact and finding; OFAC remains the only gating
sanctions check. Crunchbase and Reddit were retired from the pipeline.
Monid enrichment runs inside a hard 25-second wall-clock box so a slow
provider degrades to a skipped enrichment, never a dead run.

Live validation state. Both flagship subjects now publish full clearance.
Stani Kulechov (founder) publishes a decision-ready PASS 82 with every never-
waive safety screen recorded at 87 percent coverage (seven of eight applicable
checks; the eighth is an enrichment gap that no longer withholds clearance).
Aave (project) publishes a decision-ready PASS 72 with complete coverage
(seven of seven checks, one hundred percent). The founder related-asset
binding that had held both at provisional is landed: on the person side ARGUS
resolves the venture's canonical token through the venture's own official X
account (never a name match) and screens the US exchange registry for the
venture's public-security status only after that identity verifies, so the
never-waive related-asset check clears on evidence rather than assumption. Aave
reaches full clearance in turn because the trust-graph connection to Stani now
qualifies against his active, coverage-complete report.

## July 13, 2026 reconciliation

The v3.0 candidate adds role-aware basic-fact ledgers, targeted repair passes,
verified-passage promotion, founder decision checks, direct-versus-related legal
attribution, separate token and public-security outcomes, coverage-qualified
readiness, one open-question count, adviser-style report framing, immutable
evidence semantics, and access-gap-safe site checks.

The verifier now binds executives to their own titles, including ordered
"respectively" statements; accepts explicit founder lists without turning
advisers, investors, employees, or directors into founders; rejects related-company
metrics, funding, token, network, audit, governance, and security claims; preserves
original source URLs after reader recovery; and enforces path ownership on shared
hosts such as GitHub.

These changes remain a release candidate until the production canaries above pass.
