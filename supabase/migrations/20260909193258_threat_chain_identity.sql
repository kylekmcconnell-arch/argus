begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Keep every legacy payload. Missing chain cannot be reconstructed safely.
update public.reports
set kind = kind || '-chain-unresolved'
where kind in ('threat-receipt', 'threat-alert', 'holder-edge')
  and (coalesce(payload->>'chain', '') !~ '^[a-z0-9_-]+$' or payload->>'chain' = 'unknown');
-- Pick the newest observation within each exact tenant/chain/address identity.
-- Archive collisions before changing the conflict key; never overwrite evidence.
create temporary table threat_identity_keys on commit drop as
select ctid as row_tid, organization_id, kind, ts,
  case when kind = 'holder-edge' then
    (payload->>'chain') || ':' || case when payload->>'wallet' ~* '^0x[0-9a-f]{40}$' then lower(payload->>'wallet') else payload->>'wallet' end || '|' ||
    (payload->>'chain') || ':' || case when payload->>'token' ~* '^0x[0-9a-f]{40}$' then lower(payload->>'token') else payload->>'token' end
  else (payload->>'chain') || ':' || case when payload->>'address' ~* '^0x[0-9a-f]{40}$' then lower(payload->>'address') else payload->>'address' end end as new_ref
from public.reports where kind in ('threat-receipt', 'threat-alert', 'holder-edge');
-- Archive losing identities first so immediate unique checks cannot collide
-- with a canonical row that is being displaced in the same statement.
create temporary table threat_identity_ranked on commit drop as
select *, row_number() over (partition by organization_id, kind, new_ref order by ts desc nulls last, row_tid desc) as n
from threat_identity_keys;
update public.reports r set kind = r.kind || case when k.new_ref is null then '-chain-unresolved' else '-chain-history' end
from threat_identity_ranked k where r.ctid = k.row_tid and (k.new_ref is null or k.n > 1);
update public.reports r set ref = k.new_ref
from threat_identity_ranked k where r.ctid = k.row_tid and k.new_ref is not null and k.n = 1;
drop table threat_identity_ranked;
drop table threat_identity_keys;
commit;
