begin;

-- An index over immutable report evidence, not another mutable source of truth.
-- Service-only: the authenticated API must constrain organization_id. Private
-- investigations are not persisted into organization report_versions.
create or replace view public.holder_observations
with (security_invoker = true) as
select r.organization_id, r.id as report_version_id, r.case_id,
       r.attestation_state, r.created_at as saved_at,
       snapshot->>'chain' as chain,
       snapshot->>'tokenAddress' as token_address,
       snapshot->>'capturedAt' as captured_at,
       snapshot->>'source' as provider,
       snapshot->>'sourceUrl' as source_url,
       snapshot->>'status' as coverage,
       snapshot->>'registryVersion' as registry_version,
       holder->>'address' as wallet_address,
       holder as observation
from public.report_versions r
cross join lateral (
  select s as snapshot from jsonb_array_elements(jsonb_build_array(
    r.payload->'holderIntelligence',
    r.payload->'token'->'holderIntelligence',
    r.payload->'holderProfile'->'holderIntelligence',
    r.payload->'projectAccount'->'holderProfile'->'holderIntelligence'
  )) s where jsonb_typeof(s) = 'object' and s->>'version' = '1'
) snapshots
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(snapshot->'rows') = 'array' then snapshot->'rows' else '[]'::jsonb end
) holder
where jsonb_typeof(holder) = 'object' and holder->>'address' is not null;

revoke all on public.holder_observations from public, anon, authenticated;
grant select on public.holder_observations to service_role;
comment on view public.holder_observations is 'Immutable, organization-scoped holder observations. A recorded match or change in supply share is not proof of identity, a trade or common control.';
commit;
