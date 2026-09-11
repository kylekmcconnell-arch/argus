# Failed-check recovery

## Repairs

- Saved unknown/stale gaps no longer fail authorization merely because their states differ from intelligence-question states. New token questions carry a valid domain, state, basis and reference arrays.
- Token follow-ups derive the exact contract and chain from the frozen payload, validate scope before consuming quota, and reject mismatched collector output before saving a proposal.
- A failed or running launch refresh preserves the last completed analysis as a separately dated snapshot. The latest attempt remains visible; old evidence is never presented as refreshed.
- Deduplicated launch requests report reuse explicitly. The UI explains when collection did not start.
- The full person-rescan button says “Run a fresh assessment” rather than promising selective retries.

## Limits and next work

Read-only inspection of recent saved check runs found unresolved founder evidence and project-account identity gates. These are not all provider outages. No saved scores or check states were changed by this repair.

Token gap follow-up still runs the integrated token audit. Launch refresh still runs its bounded collector. Selective provider retries require evidence merging and freshness rules before they can replace those paths safely. Public Robinhood trace-provider support remains a separate limitation.

Regression coverage includes open-state authorization, chain/contract mismatch rejection, pre-quota validation, failed-refresh fallback and reuse reporting. No schema migration is required. Roll back through a reviewed application revert.
