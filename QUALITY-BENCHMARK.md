# ARGUS investigation-quality benchmark

ARGUS uses two complementary quality checks. Neither is presented as a claim of
universal real-world accuracy.

## Product north star

A release must be more useful than a generic ChatGPT or Claude research scan.
Finding a public fact is table stakes. ARGUS earns its place by tying each
decision claim to an exact fetched passage, attributing it to the correct
person or entity, distinguishing securities from crypto tokens, testing
contradictions, connecting people and on-chain actors, ranking the remaining
questions, and freezing the evidence so a later scan can show what changed.

The build does not ship when any of these are true:

- a famous subject is missing an obvious foundational fact;
- a completed report cannot be persisted and reopened;
- the summary says there are no open questions while the body lists gaps;
- a blocked website fetch becomes evidence that the product is dead;
- a company legal event is attributed to a founder without an exact source;
- a public stock is shown as a crypto token, or vice versa.

## Live founder canaries

These are release gates, not hand-authored demo dossiers. Each case must run
through the live collector, persist as an immutable report, reopen from storage,
and answer grounded follow-up questions from the frozen evidence.

### Brian Armstrong

- Coinbase cofounder, chair, and CEO; Fred Ehrsam; former Airbnb role.
- COIN is a public security, not a crypto token.
- Base has no native token.
- The SEC case against Coinbase is not attributed to Armstrong personally.
- Expected useful result: decision-ready PASS with no token chart.

### Hayden Adams

- Uniswap Labs founder and CEO; protocol launch date.
- Uniswap Labs, the protocol, and the Foundation remain distinct entities.
- Canonical UNI contract and relevant GitHub footprint.
- CFTC settlement and SEC investigation closure with exact entity and status
  attribution.
- Expected useful result: PASS or CAUTION with a UNI chart.

### Sam Bankman-Fried

- Former FTX and Alameda roles; cofounders; FTX founding and bankruptcy.
- Historical FTT contract, labeled historical or distressed.
- Seven-count conviction, 25-year sentence, and forfeiture.
- SEC allegations remain separate from the criminal conviction.
- Expected useful result: FAIL below 20.

## Deterministic release canary

Before a deployment, run the focused offline matrix:

```sh
npm run canary:offline
```

The matrix exercises the real person dossier/verdict engine and the real token
scorer across six release-critical scenarios: a known-good founder, a
known-good investor protected from an unverified model allegation, a verified
risky actor, a sparse/unknown identity that must abstain, an established token,
and a honeypot token. Token-provider calls are intercepted by exact synthetic
DexScreener, GoPlus, Honeypot, and CoinGecko responses. Unknown URLs are blocked
and fail the canary, so the command cannot trigger live or paid scans.

For machine-readable CI output:

```sh
npm run --silent canary:offline:json
```

## Offline person and founder calibration

`src/calibration/golden.ts` contains deterministic evidence packages that run
through the same dossier assembly and verdict engine used by investigations.
The suite currently covers four ground-truth classes:

- `clean`: strong subjects and controls where an unverified model allegation
  must not create a false avoid.
- `harmful`: verified rugs, fraud, contradictory claims, manipulation services,
  and attributed wallet dumping that must not receive PASS or CAUTION.
- `insufficient-evidence`: missing required checks that must produce
  `INCOMPLETE` with no numeric score.
- `identity-fraud`: suspected impersonation that must block publication.

Every case can pin the verdict, governing role, cap, and an acceptable score
range. The aggregate gate separately counts:

- false passes;
- false avoids;
- unsafe conclusions from insufficient evidence; and
- missed identity blocks.

Run the human-readable gate:

```sh
npm run calibrate
```

Emit versioned JSON for CI or longitudinal tracking:

```sh
ARGUS_METHODOLOGY_VERSION=2026-07-p0 npm run calibrate:json
```

Run calibration, all unit tests, and every TypeScript target together:

```sh
npm run quality
```

## Live token benchmark

`src/benchmark/corpus.ts` is a transparently labeled set of real Ethereum token
contracts. `src/benchmark/run.ts` evaluates them against live market and
contract-safety data with bounded concurrency. It distinguishes established,
fixed-supply controls from governance contracts that retain mint or freeze
authority.

Live results can change when providers, liquidity, ownership, or contracts
change. Provider failures are reported as errors and must never be counted as a
correct detection.

## Adding adjudicated cases

1. Start from an evidence package, not the desired score.
2. Assign ground truth before running the current engine.
3. Record why the label is defensible and which source artifact establishes any
   hard-cap predicate.
4. Tag model discoveries as `model_lead` with `artifact_verified: false` until a
   deterministic collector or human verifies the source artifact.
5. Prefer score ranges over exact scores unless the case specifically pins a
   cap ceiling.
6. Run `npm run quality` and review every drift; never silently relabel a case to
   make a methodology change pass.

## Interpretation limits

The current golden suite is an invariant and regression set, not a statistically
representative accuracy study. A defensible accuracy claim requires a larger,
time-split, independently adjudicated corpus with blinded labels and explicit
measurement of inter-rater disagreement. ARGUS should publish those numbers
only after that corpus exists.
