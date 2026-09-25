# Company/person routing and interrupted company audits

Related issue: #537. Canonical ARGUS product. High attribution risk.

## Observed incident

The owner supplied the Hades token report v3 saved at 2026-09-25 15:10:10 UTC. Its open Chrome page showed Project diligence withheld, with the exact saved failure `timed out: the audit stream stopped responding`. The People chapter called @hades_privacy the project account, not a founder. That tab displayed presentation 2026-09-25.1 and an update notice. These observations establish an interrupted embedded company audit, not a successfully returned person classification. No runtime model response proving that classification was available from the saved report. Do not claim an LLM caused the transport failure.

## Trace and ownership

The old routing safeguard in 9b550eaf (#456), co-authored by Claude Fable 5, treated a handle-bound FOUNDER orientation as person evidence. It protected real founders from their companies' vocabulary, but could also reinforce a mistaken orientation when a product bio named its developer. Token-specific corrections already existed; a tokenless product with explicit separate builder credits needed the same boundary.

The Codex-authored report redesign (#544, retained in #552) selected person presentation from the absence of PROJECT methodology. Institution/agency organization detection existed alongside it, so company presentation and the score label could disagree. This repair uses organization identity consistently and withholds a legacy person score if company evidence contradicts its methodology. These are reproducible weaknesses, not proof that either authored commit caused the saved Hades timeout.

## Implemented repair

- Separate explicit third-party builder/founder/developer credits from the subject's own bio. A product description plus a separate builder, a timestamped provider-resolved profile and credible official website can establish the brand context without waiting for a token. Personal role statements, resolved people, unfetched profiles, self-mentions and names alone do not qualify.
- A conflicting model FOUNDER orientation cannot override that contextual company evidence. The orientation prompt explicitly distinguishes the subject from people it names.
- Organization presentation and company labels use the same decision. Legacy mismatched person scores are withheld with an explicit explanation; original payloads and scores are not rewritten or recalculated.
- Embedded project results require the exact expected account and an organization methodology. A founder's result cannot supply a company score, including when displaying historical token reports.
- Stream-drop messaging says the company connection was interrupted; it does not invent a classification, score or successful research. No automatic paid retries.
- Presentation revision: 2026-09-25.3. No schema or credential change.

## Validation and limits

Regression coverage includes tokenless brand/developer separation under an incorrect orientation, personal founder protection, unfetched sources, same-handle credits, legacy score withholding, and embedded exact-account/methodology checks. Full suite, types, production build, offline canaries and calibration are release gates.

The saved v3 company score cannot be recovered from a nonexistent result, and this patch does not establish the cause of that specific stream loss. Server-side recoverable embedded jobs remain separate reliability work. A fresh bounded authenticated company assessment is required to produce a new company score; a historical score must not be borrowed into v3. No paid audit was launched as part of this repair.

Rollout follows branch/PR checks and main-triggered deployment. Rollback reverts the repair commit and rebuilds the collector, retaining immutable report history.
