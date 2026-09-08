begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Recover only exact base58 addresses retained in payloads. Lowercase-only
-- payloads cannot reveal lost capitalization and are deliberately untouched.
-- Keep colliding historical rows as archives; do not overwrite newer canonical rows.
update public.reports old
set kind = old.kind || '-legacy-case'
where old.kind in ('threat-receipt', 'threat-alert', 'threat-scan')
  and old.payload->>'address' ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  and old.ref = lower(old.payload->>'address')
  and old.ref <> old.payload->>'address'
  and exists (select 1 from public.reports current
    where current.organization_id = old.organization_id and current.kind = old.kind
      and current.ref = old.payload->>'address');
update public.reports
set ref = payload->>'address'
where kind in ('threat-receipt', 'threat-alert', 'threat-scan')
  and payload->>'address' ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  and ref = lower(payload->>'address') and ref <> payload->>'address';
commit;
