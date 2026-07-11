# ARGUS investigation-quality benchmark

ARGUS uses two complementary quality checks. Neither is presented as a claim of
universal real-world accuracy.

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
