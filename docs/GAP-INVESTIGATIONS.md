# Authorized evidence-gap investigations

Argus Eye remains a frozen-report reasoning surface. It never turns a question into unrestricted search. When the saved question director identifies an open evidence gap, the Eye may instead present a separate bounded authorization.

## Authorization contract

The server binds one authorization to:

- the authenticated organization and analyst;
- the exact active source report version and case;
- one open saved Intelligence Spine question;
- task IDs already present in the source report's saved research plan;
- capabilities and allowlisted delegates derived by the server from those tasks;
- an expiry, a wall-clock limit, and an accepted estimated cost ceiling.

The browser cannot supply capabilities or specialist names. Identity and synthesis gates can be added only when the frozen director already selected those workstreams. Blocked, completed, invented, or out-of-plan tasks are rejected before provider work starts.

## Proposal lifecycle

The bounded collector re-runs identity, attribution, source-lineage, graph-integrity, provenance, and scoring gates. Candidate evidence, check outcomes, observed cost, and execution receipts are persisted under a new immutable report version marked `proposed`.

Proposal persistence and restoration of the exact source projection happen in one database transaction. The active report therefore remains visible and unchanged while the proposal is reviewed.

A normal activation call rejects a proposed version. An active analyst must explicitly promote it through `promote_gap_investigation_proposal`, which still applies the existing report-quality, graph, and lineage activation guards. The analyst may instead roll it back, leaving it inactive and preserving its audit receipt.

## Current increment

Execution is available for saved person and organization dossiers handled by the person collector. Other report kinds fail closed until their specialist collectors expose the same bounded task contract.

The migration in `supabase/migrations/20260822160000_gap_investigation_proposals.sql` must be reviewed and explicitly approved before it is applied to production. Application deployment alone does not create or alter these production tables or functions.
