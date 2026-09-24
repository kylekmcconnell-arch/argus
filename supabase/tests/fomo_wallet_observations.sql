begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(8);
select has_table('public','fomo_wallet_observations','Fomo receipts have a durable index');
select ok(not has_table_privilege('anon','public.fomo_wallet_observations','select'),'anonymous cannot read evidence');
select ok(not has_table_privilege('authenticated','public.fomo_wallet_observations','select'),'clients cannot bypass workspace scope');
select ok(has_table_privilege('service_role','public.fomo_wallet_observations','insert'),'server importer can append');
select ok(not has_table_privilege('service_role','public.fomo_wallet_observations','update'),'server cannot rewrite evidence');
select has_trigger('public','fomo_wallet_observations','immutable_fomo_observation','immutability also enforced for privileged updates');
insert into public.fomo_wallet_observations (organization_id,chain,address,captured_at,source_url,receipt_hash,state,label)
values ('00000000-0000-4000-8000-000000000001','base','0x1111111111111111111111111111111111111111','2026-01-01T00:00:00Z','https://api.fomoscan.sh/v2/user/wallet/0x1111111111111111111111111111111111111111',repeat('a',64),'reported','fixture');
select throws_ok($$update public.fomo_wallet_observations set label='changed' where receipt_hash=repeat('a',64)$$,'P0001','Fomo observations are immutable; append a new dated receipt','even privileged updates cannot rewrite labels');
select throws_ok($$delete from public.fomo_wallet_observations where receipt_hash=repeat('a',64)$$,'P0001','Fomo observations are immutable; append a new dated receipt','even privileged deletion is blocked');
select * from finish();
rollback;
