begin;
-- Read-only projection of immutable report versions. Only service_role can read;
-- the API must bind every query to the authenticated organization and token.
create or replace view public.holder_snapshot_history
with (security_invoker = true) as
select r.organization_id, r.id as report_version_id, r.attestation_state,
       r.created_at as saved_at, snapshot->>'chain' as chain,
       snapshot->>'tokenAddress' as token_address,
       snapshot->>'capturedAt' as captured_at, snapshot
from public.report_versions r
cross join lateral (
  select s as snapshot from jsonb_array_elements(jsonb_build_array(
    r.payload->'holderIntelligence', r.payload->'token'->'holderIntelligence',
    r.payload->'holderProfile'->'holderIntelligence',
    r.payload->'projectAccount'->'holderProfile'->'holderIntelligence'
  )) s where jsonb_typeof(s) = 'object' and s->>'version' = '1'
) snapshots;
revoke all on public.holder_snapshot_history from public, anon, authenticated;
grant select on public.holder_snapshot_history to service_role;
comment on view public.holder_snapshot_history is 'Saved holder snapshots for bounded observation comparisons, not evidence of buys, sales or common control.';
commit;
