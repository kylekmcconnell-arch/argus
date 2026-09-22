# Provider access failures and report recovery

A configured key does not prove that a provider accepts requests. `/api/health`
reports configuration only; `operationalStatus: not_tested` is intentional and
must not be presented as an operational health check. Reading health never
starts a paid probe.

## What a failed scan preserves

Within one audit, a Grok HTTP 401 stops subsequent Grok requests. A 403 stops
subsequent requests for that model and endpoint; search and chat permissions
remain distinct. Already in-flight calls may finish. The stop is request-local,
so one scan cannot disable another scan or a later repaired account. Transient
429 and server errors retain the existing retry policy.

Only physical calls enter the cost ledger. Rejected calls retain their HTTP
status, a bounded request identifier when available, and a controlled diagnostic
category. Raw provider response bodies are not logged or saved. Categories are
hints from the response, not proof of the underlying account problem.

When the scorer cannot run because its provider rejected access, the report
freezes that operational cause separately from missing evidence areas. Neither
an unavailable provider nor an unassessed axis becomes an adverse project
finding or a zero score. Explicitly enabled fallbacks retain their existing
behavior; this change does not enable them or change spending policy.

## Recovery procedure

1. Check the intended model and the deployment's provider configuration. In the
   provider's administrative console, confirm key validity, account status,
   funding, and model/endpoint permission. A 403 alone does not establish which
   of these is wrong.
2. Restore access through the existing authorized credential/deployment
   workflow. Never paste credentials or raw provider transcripts into an issue.
   Enabling paid fallback routing is a separate operational policy decision.
3. After access is restored, run an authorized bounded end-to-end check and
   inspect both collection completion and the scorer outcome. Key presence and
   passing offline tests are insufficient evidence of production recovery.
4. Generate a new report version. Preserve previous report evidence and scores;
   do not rewrite a failed snapshot to appear as a successful historical run.

## Description and presentation rules

A live official website's bounded product metadata is saved with its URL and
capture time, independently of the scoring packet. It can explain the product
when model research fails, but is labelled first-party and is not independent
validation of functionality, adoption, or safety. The narrative also retains
verified/corroborated product facts when their wording overlaps the profile;
unverified model leads remain ineligible.

Presentation revision `2026-09-22.1` preserves original token-safety and
market-risk scores. If a saved token PASS/SAFE conflicts with an adverse
market assessment, the current reading flags market risk and withholds overall
reassurance. It does not average opposite scales or invent a replacement score.
Saved reports display the current presentation revision separately from the
report's snapshot identity.
