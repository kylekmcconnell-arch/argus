-- Adversarial regression coverage for append-only exact-version provider usage.
-- Run after the canonical migrations with psql -v ON_ERROR_STOP=1.

begin;

create or replace function pg_temp.expect_error(
  label text,
  statement text,
  expected_state text default null
)
returns void
language plpgsql
as $$
declare
  actual_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if expected_state is not null and actual_state <> expected_state then
      raise exception '% raised SQLSTATE %, expected %', label, actual_state, expected_state;
    end if;
    return;
  end;
  raise exception '% unexpectedly succeeded', label;
end;
$$;

create or replace function pg_temp.expect_count(
  label text,
  statement text,
  expected_count bigint
)
returns void
language plpgsql
as $$
declare
  actual_count bigint;
begin
  execute statement into actual_count;
  if actual_count is distinct from expected_count then
    raise exception '% returned %, expected %', label, actual_count, expected_count;
  end if;
end;
$$;

insert into public.organizations (id, slug, name) values
  ('40000000-0000-4000-8000-000000000001', 'provider-usage-one', 'Provider Usage One'),
  ('40000000-0000-4000-8000-000000000002', 'provider-usage-two', 'Provider Usage Two');

insert into auth.users (id) values
  ('40000000-0000-4000-8000-000000000101'),
  ('40000000-0000-4000-8000-000000000102');

insert into public.argus_members (
  user_id, organization_id, role, display_name
) values
  (
    '40000000-0000-4000-8000-000000000101',
    '40000000-0000-4000-8000-000000000001',
    'owner',
    'Usage Tenant One Owner'
  ),
  (
    '40000000-0000-4000-8000-000000000102',
    '40000000-0000-4000-8000-000000000002',
    'owner',
    'Usage Tenant Two Owner'
  );

insert into public.cases (
  id, organization_id, kind, canonical_ref, display_query
) values
  (
    '40000000-0000-4000-8000-000000000201',
    '40000000-0000-4000-8000-000000000001',
    'token',
    'eip155:1:0x4000000000000000000000000000000000000001',
    '$USAGE-ONE'
  ),
  (
    '40000000-0000-4000-8000-000000000202',
    '40000000-0000-4000-8000-000000000002',
    'token',
    'eip155:1:0x4000000000000000000000000000000000000002',
    '$USAGE-TWO'
  );

insert into public.report_versions (
  id, case_id, organization_id, version, payload, contributor_label
) values
  (
    '40000000-0000-4000-8000-000000000301',
    '40000000-0000-4000-8000-000000000201',
    '40000000-0000-4000-8000-000000000001',
    1,
    '{"report":{"symbol":"USAGE-ONE"}}',
    'test'
  ),
  (
    '40000000-0000-4000-8000-000000000302',
    '40000000-0000-4000-8000-000000000202',
    '40000000-0000-4000-8000-000000000002',
    1,
    '{"report":{"symbol":"USAGE-TWO"}}',
    'test'
  );

set local role service_role;

select (public.record_provider_usage_event(
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'request:first',
  'grok',
  'panel:namesake',
  1,
  0.125,
  '40000000-0000-4000-8000-000000000101',
  'succeeded',
  'first call'
)).id;

-- An exact retry returns the same immutable event and does not increment the
-- aggregate projection again.
select (public.record_provider_usage_event(
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'request:first',
  'grok',
  'panel:namesake',
  1,
  0.125,
  '40000000-0000-4000-8000-000000000101',
  'succeeded',
  'first call'
)).id;

-- A distinct request for the same provider operation appends and accumulates.
select (public.record_provider_usage_event(
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'request:second',
  'grok',
  'panel:namesake',
  2,
  0.375,
  '40000000-0000-4000-8000-000000000101',
  'partial',
  null
)).id;

-- Calls made by an old application instance after the migration starts are
-- bridged into the event ledger. Each completed legacy invocation is a distinct
-- historical request, and sub-cent estimates retain their precision.
select public.upsert_report_cost_line(
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'legacy-provider',
  'panel:legacy-bridge',
  1,
  0.00000075,
  'legacy bridge'
);
select public.upsert_report_cost_line(
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'legacy-provider',
  'panel:legacy-bridge',
  2,
  0.00000125,
  'legacy bridge'
);

-- Reproduce a request that resolved the old RPC body before CREATE OR REPLACE
-- committed, then reached report_cost_lines after the migration. The bridge
-- triggers must capture both the insert and ON CONFLICT update, and convert the
-- retired set-style update to additive projection semantics.
insert into public.report_cost_lines (
  organization_id, report_version_id, provider, operation, calls, usd, meta
) values (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'stale-old-instance',
  'panel:stale-old-body',
  1,
  0.000001,
  'pre-resolved legacy body'
)
on conflict (report_version_id, provider, operation)
do update set
  calls = excluded.calls,
  usd = excluded.usd,
  meta = excluded.meta,
  updated_at = pg_catalog.now()
where public.report_cost_lines.organization_id = excluded.organization_id;

insert into public.report_cost_lines (
  organization_id, report_version_id, provider, operation, calls, usd, meta
) values (
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000301',
  'stale-old-instance',
  'panel:stale-old-body',
  2,
  0.000002,
  'pre-resolved legacy body'
)
on conflict (report_version_id, provider, operation)
do update set
  calls = excluded.calls,
  usd = excluded.usd,
  meta = excluded.meta,
  updated_at = pg_catalog.now()
where public.report_cost_lines.organization_id = excluded.organization_id;

do $assert_service_summary$
declare
  summary record;
begin
  select * into strict summary
  from public.get_provider_usage_summary(
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000301'
  );

  if summary.event_count <> 6
     or summary.calls <> 9
     or summary.usd <> 0.500005 then
    raise exception 'historical usage summary is incomplete: %', row_to_json(summary);
  end if;
end;
$assert_service_summary$;

select pg_temp.expect_error('conflicting idempotency replay', $sql$
  select public.record_provider_usage_event(
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000301',
    'request:first',
    'grok',
    'panel:namesake',
    99,
    0.125,
    '40000000-0000-4000-8000-000000000101',
    'succeeded',
    'first call'
  )
$sql$, '40001');

select pg_temp.expect_error('cross-tenant report version', $sql$
  select public.record_provider_usage_event(
    '40000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000301',
    'request:cross-report',
    'grok',
    'panel:namesake',
    1,
    0.1
  )
$sql$, '23503');

select pg_temp.expect_error('cross-tenant actor', $sql$
  select public.record_provider_usage_event(
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000301',
    'request:cross-actor',
    'grok',
    'panel:namesake',
    1,
    0.1,
    '40000000-0000-4000-8000-000000000102'
  )
$sql$, '42501');

select pg_temp.expect_error('service update privilege', $sql$
  update public.provider_usage_events set calls = 999
$sql$, '42501');
select pg_temp.expect_error('service delete privilege', $sql$
  delete from public.provider_usage_events
$sql$, '42501');

reset role;

do $assert_event_and_projection$
declare
  v_first_id uuid;
  v_retry_id uuid;
begin
  select event.id into strict v_first_id
  from public.provider_usage_events event
  where event.organization_id = '40000000-0000-4000-8000-000000000001'
    and event.idempotency_key = 'request:first';

  select (public.record_provider_usage_event(
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000301',
    'request:first',
    'grok',
    'panel:namesake',
    1,
    0.125,
    '40000000-0000-4000-8000-000000000101',
    'succeeded',
    'first call'
  )).id into v_retry_id;

  if v_retry_id is distinct from v_first_id then
    raise exception 'idempotent retry returned a different event';
  end if;

  if (select count(*) from public.provider_usage_events
      where organization_id = '40000000-0000-4000-8000-000000000001'
        and report_version_id = '40000000-0000-4000-8000-000000000301') <> 6 then
    raise exception 'usage event count does not preserve exact retries';
  end if;

  if not exists (
    select 1
    from public.report_cost_lines line
    where line.organization_id = '40000000-0000-4000-8000-000000000001'
      and line.report_version_id = '40000000-0000-4000-8000-000000000301'
      and line.provider = 'grok'
      and line.operation = 'panel:namesake'
      and line.calls = 3
      and line.usd = 0.5
      and line.meta = 'first call'
  ) then
    raise exception 'legacy report cost projection did not accumulate exactly';
  end if;

  if not exists (
    select 1
    from public.report_cost_lines line
    where line.organization_id = '40000000-0000-4000-8000-000000000001'
      and line.report_version_id = '40000000-0000-4000-8000-000000000301'
      and line.provider = 'legacy-provider'
      and line.operation = 'panel:legacy-bridge'
      and line.calls = 3
      and line.usd = 0.000002
      and line.meta = 'legacy bridge'
  ) then
    raise exception 'legacy writer bridge did not append into the projection';
  end if;

  if not exists (
    select 1
    from public.report_cost_lines line
    where line.organization_id = '40000000-0000-4000-8000-000000000001'
      and line.report_version_id = '40000000-0000-4000-8000-000000000301'
      and line.provider = 'stale-old-instance'
      and line.operation = 'panel:stale-old-body'
      and line.calls = 3
      and line.usd = 0.000003
      and line.meta = 'pre-resolved legacy body'
  ) then
    raise exception 'pre-resolved legacy body escaped trigger accounting';
  end if;
end;
$assert_event_and_projection$;

-- Even a table owner cannot mutate the append-only ledger accidentally.
select pg_temp.expect_error('owner update trigger', $sql$
  update public.provider_usage_events set calls = 999
  where idempotency_key = 'request:first'
$sql$, '55000');
select pg_temp.expect_error('owner delete trigger', $sql$
  delete from public.provider_usage_events
  where idempotency_key = 'request:first'
$sql$, '55000');

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '40000000-0000-4000-8000-000000000101',
  true
);
set local role authenticated;
select pg_temp.expect_count(
  'tenant-one member event visibility',
  'select count(*) from public.provider_usage_events',
  6
);
select pg_temp.expect_count(
  'tenant-one member cross-tenant isolation',
  $sql$select count(*) from public.provider_usage_events
    where organization_id = '40000000-0000-4000-8000-000000000002'$sql$,
  0
);
select pg_temp.expect_error('authenticated direct insert', $sql$
  insert into public.provider_usage_events (
    organization_id, report_version_id, idempotency_key,
    provider, operation, calls, usd
  ) values (
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000301',
    'request:browser', 'grok', 'panel:namesake', 1, 0.1
  )
$sql$, '42501');
select pg_temp.expect_error('authenticated RPC execution', $sql$
  select public.record_provider_usage_event(
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000301',
    'request:browser-rpc', 'grok', 'panel:namesake', 1, 0.1
  )
$sql$, '42501');
select pg_temp.expect_error('authenticated summary execution', $sql$
  select public.get_provider_usage_summary(
    '40000000-0000-4000-8000-000000000001',
    null
  )
$sql$, '42501');
reset role;

do $assert_catalog$
declare
  rpc regprocedure := pg_catalog.to_regprocedure(
    'public.record_provider_usage_event(uuid,uuid,text,text,text,integer,numeric,uuid,text,text)'
  );
  summary_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.get_provider_usage_summary(uuid,uuid)'
  );
  legacy_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.upsert_report_cost_line(uuid,uuid,text,text,integer,numeric,text)'
  );
begin
  if rpc is null or summary_rpc is null or legacy_rpc is null then
    raise exception 'provider usage RPC signature is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.provider_usage_events'::regclass
      and relrowsecurity
  ) then
    raise exception 'provider usage RLS is disabled';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.report_cost_lines'::regclass
      and t.tgname = 'report_cost_lines_bridge_legacy_update'
      and not t.tgisinternal
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.report_cost_lines'::regclass
      and t.tgname = 'report_cost_lines_capture_legacy_write'
      and not t.tgisinternal
  ) then
    raise exception 'legacy provider usage cutover triggers are missing';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.provider_usage_events', 'select')
     or not pg_catalog.has_table_privilege('authenticated', 'public.provider_usage_events', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.provider_usage_events', 'insert')
     or not pg_catalog.has_table_privilege('service_role', 'public.provider_usage_events', 'select,insert')
     or pg_catalog.has_table_privilege('service_role', 'public.provider_usage_events', 'update')
     or pg_catalog.has_table_privilege('service_role', 'public.provider_usage_events', 'delete') then
    raise exception 'provider usage table grants are unsafe';
  end if;

  if pg_catalog.has_function_privilege('anon', rpc, 'execute')
     or pg_catalog.has_function_privilege('authenticated', rpc, 'execute')
     or not pg_catalog.has_function_privilege('service_role', rpc, 'execute')
     or pg_catalog.has_function_privilege('anon', summary_rpc, 'execute')
     or pg_catalog.has_function_privilege('authenticated', summary_rpc, 'execute')
     or not pg_catalog.has_function_privilege('service_role', summary_rpc, 'execute')
     or pg_catalog.has_function_privilege('anon', legacy_rpc, 'execute')
     or pg_catalog.has_function_privilege('authenticated', legacy_rpc, 'execute')
     or not pg_catalog.has_function_privilege('service_role', legacy_rpc, 'execute') then
    raise exception 'provider usage RPC grants are unsafe';
  end if;
end;
$assert_catalog$;

rollback;
