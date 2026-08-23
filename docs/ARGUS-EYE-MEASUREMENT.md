# ARGUS Eye measurement

ARGUS Eye is measured against an adjudicated, versioned corpus of conversations bound to frozen report fixtures. The first corpus lives at `eval/argus-eye/corpus.v1.json`; `npm run eval:eye` replays it without a provider call or network access.

## What the corpus grades

The corpus spans person, investor, firm, company, project, and token reports. It includes multi-turn referents, graph traces, typed contradictions, score explanations, gap planning, and abstention. Each case freezes:

- expected deterministic route and reasoning mode;
- allowed entity keys, evidence references, citations, and contradiction IDs;
- the strongest permissible answer basis;
- required language, prohibited claims, and adjudicator notes.

The evaluator hard-fails entity invention, unsupported graph or evidence paths, false contradictions, citation violations, and answers stronger than the frozen evidence permits. Corpus edits require a new schema/version or an adjudicator note explaining why the expected judgment changed; provider output must never silently rewrite the expected result.

## Per-question operational event

`argus-eye-question.v1` is an append-only server event contract. The live answer response exposes a tenant-safe subset: provider, exact model, input/output tokens when supplied by the provider, end-to-end latency, estimated cost and rate-card version, route, answer basis, abstention, and receipt completeness.

The server-only event adds organization ID, exact report-version ID, event ID, timestamp, and an optional HMAC question fingerprint. A fingerprint is emitted only when `ARGUS_TELEMETRY_HASH_KEY` is configured; it is keyed by organization so identical questions cannot be correlated across tenants. The event never contains raw question or answer text, dialogue history, report content, source URLs or excerpts, credentials, or raw provider responses.

The current increment defines and returns the event but does not deploy a persistence migration. A future storage PR must preserve append-only writes, organization-scoped reads/RLS, idempotent event IDs, and the same redaction boundary. It requires separate production database approval.

## Decision lift

Decision lift is never inferred from score, answer basis, sentiment, model confidence, or whether the analyst agreed with the answer. `argus-eye-decision-lift.v1` accepts only an authenticated analyst's explicit 0–100 before and after judgment, linked to the question event and exact report version. The stored lift is `after - before`, with one declared reason: changed action, changed confidence, confirmed view, or no change.

The response reports `decisionLift: null` until that explicit judgment exists. A later product surface may collect the before rating before asking and the after rating after reading; it must create a second append-only event rather than mutating the question event.

## Retention and redaction

- Raw dialogue and provider payloads: never stored in telemetry.
- Question events and explicit decision-lift events: target retention 90 days for early testing, then delete under a documented organization-scoped retention job.
- Aggregates stripped of organization, analyst, report-version, event, and fingerprint identifiers: up to 13 months for model/cost calibration.
- Support exports: aggregated metrics only; no organization or analyst-level rows without that tenant's authorization.
- Deletion or legal hold: handled per tenant and event class; never backfill raw text from application logs.

Vercel/runtime logs must not print the server event, report packet, question, answer, or provider payload. A future durable sink should receive the typed event directly after the response path is verified, and failures must not weaken or alter the grounded answer.
