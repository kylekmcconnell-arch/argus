# Partial investigations: presentation and context repair

Issue: #520. Base reviewed: main at 0bdbdfb6 (#517). Presentation revision: 2026-09-23.3.

## Findings

The production lane still uses the promoted narrative renderer. The recent #515–#517 changes do not replace that renderer. The token-first path previously omitted its second score whenever a project account audit was absent, producing a substantially different opening for thin-identity tokens. This explains the observed fallback; it does not establish which upstream lookup failed.

Contextual diligence PR #513 was still open at review time despite successful checks. It is distinct from this repair and was not part of the deployed main branch inspected here. A shipping summary must distinguish merged, deployed, and externally delivered analysis.

Several defects were reproducible from source and synthetic fixtures:

- A header denied leading concerns when only scored counter-signals were absent, even if the report had concerns elsewhere. It also described supporting references as independent source counts.
- A provisional report could show a saved PASS threshold and a statement that market movement would not change that PASS.
- A raw top-ten address list could be described as ten holders even when it included a pool, custody wallet, or unclassified contract. The token scoring lane already used a different concentration population.
- Identity lookup HTTP failures and provider errors collapsed into a null identity. Saved output could not distinguish an incomplete lookup from a completed search without usable identity leads.
- A partial contract-control response could be described as no provider response at all.
- The production score renderer did not consume the reason supplied for an unavailable secondary score.

## Changes

The two-score layout now keeps a clearly withheld project score when the embedded project assessment is absent. It displays the saved explanation, without inventing a score. A bound, retrieved website self-description can supply product context independently of an X-account audit; unbound model-suggested sites cannot.

Provisional reports withhold decision-boundary language. Recorded concerns survive the absence of scored counter-signals. The headline describes supporting evidence without equating reference count with source diversity. Partial contract-control coverage is described accurately.

The presentation declines to infer a top-ten-holder concentration total from a raw register containing infrastructure or unclassified contract rows. It does not infer that those contracts are benign, substitute smaller holders, or erase the raw rows. Newly collected holder rows preserve deterministic market classifications for subsequent presentation.

Identity discovery now saves completed/failed/not-needed status, and errors propagate into the missing project-assessment explanation. Malformed model output is reported as unavailable rather than a completed search. Existing authentication, capabilities, budgets and provider costs are unchanged.

## Limits and follow-through

This repair neither changes historical scores nor adds missing evidence to frozen reports. An older report without identity diagnostics cannot establish whether its identity search returned nothing, timed out, or was rejected. Reconstructing that cause requires retained provider/request records. A new source-backed assessment belongs in a new report version.

This does not implement the wider launchpad product specification: a universal top-25 holder register, registry joins for every report, historical wallet behavior, and cohort-level project outcomes remain separate work. Ten-holder coverage cannot satisfy the requested 25-holder contract.

The product should treat official research notes as evidence candidates: bind them to chain plus contract, retain source receipts and dates, then make them available to project descriptions, report claims, holder analysis and alerts. A note delivered outside the report pipeline does not automatically strengthen later scans. Neither a database match nor common funding alone establishes control, coordination or manipulation.

## Verification and rollout

Full offline quality suite: source-of-truth checks passed; 7/7 canaries and 21/21 calibration cases passed; 5,238 tests passed with one expected failure; client, server and API type checks passed. A synthetic partial investigation was inspected in Chrome with production report styling. No live paid scan or saved-report mutation was used for verification.

Deploy only through the protected repository checks. Roll back by reverting this repair. Presentation version identifies the changed wording/layout separately from frozen evidence. After deployment, inspect an existing partial report for layout and contradictory-claim repairs; test identity recovery only as an explicitly initiated new report version with verified project sources.
