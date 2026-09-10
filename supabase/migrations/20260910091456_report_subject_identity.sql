begin;
-- Add an identity index without rewriting case IDs, immutable payloads, or
-- historical references. Existing canonical_ref remains a stable alias.
alter table public.cases add column subject_identity text;
alter table public.cases add column identity_state text not null default 'not_applicable'
  check (identity_state in ('not_applicable','verified','legacy_unknown','legacy_ambiguous'));

create function public.argus_token_identity(p_kind text, p_payload jsonb)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare t jsonb; network text; addr text;
begin
  if p_kind not in ('token','investigation') then return null; end if;
  t := case when p_kind = 'investigation' then p_payload->'token' else p_payload end;
  network := lower(trim(t->>'chain')); addr := trim(t->>'address');
  network := case network when 'eth' then 'ethereum' when '1' then 'ethereum' when '8453' then 'base'
    when '42161' then 'arbitrum' when '10' then 'optimism' when '137' then 'polygon'
    when '56' then 'bsc' when '43114' then 'avalanche' else network end;
  if network is null or network !~ '^[a-z0-9_-]{1,40}$' or addr is null then return null; end if;
  if network = 'solana' then
    if addr !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return null; end if;
  elsif addr ~* '^0x[0-9a-f]{40}$' then
    addr := lower(addr);
  elsif network ~ '^(ethereum|base|arbitrum|optimism|polygon|bsc|avalanche|fantom|cronos|linea|scroll|mantle|zksync|blast|celo|gnosis|sonic|abstract|pulsechain|berachain|unichain|opbnb|polygonzkevm)$' or addr !~ '^[A-Za-z0-9._-]{10,128}$' then
    return null;
  end if;
  return network || ':' || addr;
end $$;
revoke all on function public.argus_token_identity(text,jsonb) from public, anon, authenticated;
grant execute on function public.argus_token_identity(text,jsonb) to service_role;

-- Every saved version must agree. Unknown or mixed-chain histories are never
-- guessed from the latest payload. Duplicate cases remain separate for review.
create temporary table argus_identity_candidates on commit drop as
select c.id, c.organization_id, c.kind,
  case when count(v.id) > 0 and count(v.id) = count(public.argus_token_identity(c.kind,v.payload))
    and count(distinct public.argus_token_identity(c.kind,v.payload)) = 1
    then min(public.argus_token_identity(c.kind,v.payload)) end identity,
  count(distinct public.argus_token_identity(c.kind,v.payload)) variants
from public.cases c left join public.report_versions v on v.case_id=c.id and v.organization_id=c.organization_id
where c.kind in ('token','investigation') group by c.id;
update public.cases c set
 subject_identity = case when a.identity is not null and not exists (
   select 1 from argus_identity_candidates b where b.id <> a.id and b.organization_id=a.organization_id and b.kind=a.kind and b.identity=a.identity
 ) then a.identity end,
 identity_state = case when a.variants > 1 or exists (
   select 1 from argus_identity_candidates b where b.id <> a.id and b.organization_id=a.organization_id and b.kind=a.kind and b.identity=a.identity
 ) then 'legacy_ambiguous' when a.identity is null then 'legacy_unknown' else 'verified' end
from argus_identity_candidates a where a.id=c.id;
create unique index cases_subject_identity_unique on public.cases(organization_id,kind,subject_identity) where subject_identity is not null;

alter function public.persist_report_version(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb)
rename to persist_report_version_before_subject_identity;
create function public.persist_report_version(
 p_organization_id uuid,p_kind text,p_canonical_ref text,p_query text,p_created_by uuid,p_payload jsonb,
 p_run_id text default null,p_attestation_state text default 'analyst_submitted',p_verdict text default null,
 p_score numeric default null,p_completeness_state text default 'partial',p_methodology_version text default null,
 p_provider_snapshot jsonb default '{}'::jsonb,p_cost jsonb default '{}'::jsonb
) returns table(case_id uuid,report_version_id uuid,version integer)
language plpgsql security invoker set search_path = '' as $$
declare identity text; target_ref text; saved record;
begin
 target_ref := p_canonical_ref;
 if p_kind in ('token','investigation') then
   identity := public.argus_token_identity(p_kind,p_payload);
   if identity is null then raise exception 'token chain and address required'; end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text || ':' || p_kind || ':' || identity,0));
   select c.canonical_ref into target_ref from public.cases c where c.organization_id=p_organization_id and c.kind=p_kind and c.subject_identity=identity;
   target_ref := coalesce(target_ref,identity);
   if exists(select 1 from public.cases c where c.organization_id=p_organization_id and c.kind=p_kind and c.canonical_ref=target_ref and c.identity_state in ('legacy_unknown','legacy_ambiguous')) then
     raise exception 'legacy token identity needs reconciliation';
   end if;
 end if;
 select * into saved from public.persist_report_version_before_subject_identity(p_organization_id,p_kind,target_ref,p_query,p_created_by,p_payload,p_run_id,p_attestation_state,p_verdict,p_score,p_completeness_state,p_methodology_version,p_provider_snapshot,p_cost);
 if identity is not null then
   update public.cases c set subject_identity=identity,identity_state='verified' where c.id=saved.case_id and c.organization_id=p_organization_id;
 end if;
 return query select saved.case_id,saved.report_version_id,saved.version;
end $$;
revoke all on function public.persist_report_version(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_report_version(uuid,text,text,text,uuid,jsonb,text,text,text,numeric,text,text,jsonb,jsonb) to service_role;
alter function public.resolve_case_subject(uuid,text) rename to resolve_case_subject_before_token_identity;
create function public.resolve_case_subject(p_organization_id uuid,p_input text)
returns table(case_id uuid,subject_kind text,subject_ref text,display_query text,case_status text,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
 select c.id,c.kind,c.canonical_ref,c.display_query,c.status,c.updated_at
 from public.cases c
 where c.organization_id=p_organization_id and c.subject_identity is not null
   and (c.subject_identity = case when split_part(p_input,':',2) ~* '^0x[0-9a-f]{40}$' then lower(p_input) else lower(split_part(p_input,':',1)) || ':' || split_part(p_input,':',2) end
     or split_part(c.subject_identity,':',2) = case when p_input ~* '^0x[0-9a-f]{40}$' then lower(p_input) else p_input end)
 union
 select * from public.resolve_case_subject_before_token_identity(p_organization_id,p_input) legacy
 where legacy.subject_kind not in ('token','investigation') or p_input !~* '^[a-z0-9_-]+:[A-Za-z0-9._-]{10,128}$';
$$;
revoke all on function public.resolve_case_subject(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_case_subject(uuid,text) to service_role;
commit;
