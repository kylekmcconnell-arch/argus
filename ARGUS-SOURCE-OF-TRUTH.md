# ARGUS product and methodology source of truth

Published field manual: [Claude artifact](https://claude.ai/code/artifact/4599c1f2-73cb-462c-9382-65282945a087)

Last reconciled: July 13, 2026

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

## July 13, 2026 reconciliation

The v3.0 candidate adds role-aware basic-fact ledgers, targeted repair passes,
verified-passage promotion, founder decision checks, direct-versus-related legal
attribution, separate token and public-security outcomes, coverage-qualified
readiness, one open-question count, adviser-style report framing, immutable
evidence semantics, and access-gap-safe site checks.

These changes remain a release candidate until the production canaries above pass.
