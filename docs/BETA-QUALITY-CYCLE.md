# ARGUS early-access quality cycle

This is the operating contract for the first measured cohort. It uses consented product records and a privacy-minimized local export. It does not authorize outreach, production writes, a new database schema, billing, or a deployment.

## Owner approvals before the window opens

The owner supplies and approves:

1. the 10–20 invitees;
2. the start and end dates;
3. the consent language shown to participants;
4. the two human adjudicators; and
5. any contact with testers outside ARGUS.

Do not invite, message, or enroll anyone automatically. Use an opaque `participantId` in the analysis export. Keep email, wallet, handle, IP address, and free-form private notes out of the export.

## What the repository already provides

- report versions and completion state;
- append-only provider usage and exact reported USD cost, with `report_cost_lines` as its aggregate read model;
- the authenticated feedback queue and report-version context;
- saved Eye conversations when the private-conversation migration is present in the deployed environment; and
- the read-only stored-report quality audit in `scripts/report-quality-audit.ts`.

Provider credits or quotas without an official dollar value remain non-USD telemetry. Never estimate them into the cost total.

## Export contract

Create one private JSONL export outside git. Each line is one of the following records:

- `participant`: opaque participant ID and invite/signup/first-investigation timestamps;
- `investigation`: participant ID, report version, report type, completion timestamp, and provider-failure count;
- `eye_question`: opaque question ID, report version, whether it is substantive, adjudication, optional 1–5 confidence before/after, and whether the decision changed;
- `provider_cost`: report version, canonical provider, calls, and exact reported USD from the usage ledger; or
- `feedback`: opaque feedback ID and normalized confusion tags.

Raw question and answer text belongs in the restricted adjudication workspace, not in the aggregate JSONL. Join the two only by `questionId`. Do not commit either export.

Run:

```sh
npm run beta:measure -- /absolute/path/to/private-export.jsonl
```

The command prints JSON containing conversion, completion, provider failures, Eye adjudication, decision lift, exact cost per completed investigation, and confusion-tag counts. A missing denominator is `null`, never a misleading zero.

## Eye adjudication rubric

Review substantive questions in time order, blinded to tester identity. Two reviewers independently assign:

- `supported`: every material claim follows from cited saved evidence;
- `partly_supported`: the answer is directionally useful but contains an overreach, missing boundary, or unsupported material detail;
- `unsupported`: at least one decision-relevant claim lacks support or contradicts the saved report; or
- `unreviewed`: no adjudication yet.

Resolve disagreement in a short recorded note. Count only `unsupported` in the headline unsupported-claim rate, but report `partly_supported` separately in the weekly memo. Product questions such as “where is export?” are not substantive Eye questions.

## Decision-lift prompt

Immediately before and after a participant reads the completed report, ask the same two questions:

1. “How confident are you in your current decision?” (1–5)
2. “Did the report change what you would do?” (yes/no)

Decision lift is the mean change in confidence among answered pairs. Report negative lift; never take an absolute value. Decision-change rate uses only rows with an explicit yes/no response.

## Confusion tags

Every feedback item gets one or more stable tags before weekly review. Start with:

- `copy-confusing`
- `internal-language`
- `score-unclear`
- `evidence-unclear`
- `eye-too-dense`
- `navigation`
- `missing-data`
- `provider-failure`
- `slow-scan`
- `other`

Do not rewrite historical tags mid-window. Add a tag and document the change when a genuinely new class appears.

## Weekly decision memo

Publish one short internal memo with:

1. cohort size and funnel;
2. completed reports, median time, and provider-failure rate;
3. substantive Eye questions adjudicated, unsupported and partly-supported rates;
4. confidence lift and decision-change rate;
5. cost per completed investigation and cost by provider;
6. top confusion tags with representative paraphrases; and
7. one decision per finding: **keep**, **revise**, **remove**, or **investigate**.

Do not quote a tester publicly or expose a scanned-token verdict without separate approval.

## Exit criteria

The cycle is ready for a pricing recommendation only when:

- at least 10 participants completed a first investigation;
- the first 100 substantive Eye questions, or every available substantive question if fewer than 100, are adjudicated;
- provider cost is joined to the exact report version;
- every feedback item has a confusion tag; and
- the weekly memo records the decision owner for every proposed change.

If these conditions are not met, report the missing coverage and continue the cycle. Do not extrapolate a price from incomplete cost or usage data.

