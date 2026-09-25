begin;
-- Owner API supplies the authenticated workspace. No raw payloads or credentials
-- leave this aggregate read. Shared tables expose structure only, not other tenants.
create function public.get_data_program_inventory(p_organization_id uuid)
returns jsonb language plpgsql stable security invoker
set search_path = '' set statement_timeout = '20s' as $$
declare
  t record; n bigint; first_at timestamptz; last_at timestamptz;
  date_column text; datasets jsonb := '[]'::jsonb; columns_json jsonb;
  day_start timestamptz := date_trunc('day', now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon';
  spend jsonb; payloads jsonb; holders jsonb;
begin
  if p_organization_id is null then raise exception 'workspace required'; end if;
  for t in
    select c.table_name, bool_or(c.column_name = 'organization_id') as scoped
    from information_schema.columns c
    join information_schema.tables it on it.table_schema=c.table_schema and it.table_name=c.table_name
    where c.table_schema='public' and it.table_type='BASE TABLE'
    group by c.table_name order by c.table_name
  loop
    select jsonb_agg(jsonb_build_object('name', c.column_name, 'type', c.data_type) order by c.ordinal_position)
      into columns_json from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name;
    select c.column_name into date_column from information_schema.columns c
      where c.table_schema='public' and c.table_name=t.table_name
      and c.data_type in ('timestamp with time zone', 'timestamp without time zone')
      and c.column_name in ('captured_at','created_at','started_at','imported_at','updated_at')
      order by array_position(array['captured_at','created_at','started_at','imported_at','updated_at'],c.column_name::text) limit 1;
    n := null; first_at := null; last_at := null;
    if t.scoped then
      if date_column is null then
        execute format('select count(*) from public.%I where organization_id=$1',t.table_name) into n using p_organization_id;
      else
        execute format('select count(*), min(%I), max(%I) from public.%I where organization_id=$1',date_column,date_column,t.table_name)
          into n,first_at,last_at using p_organization_id;
      end if;
    end if;
    datasets := datasets || jsonb_build_array(jsonb_build_object('table',t.table_name,
      'scope',case when t.scoped then 'workspace' else 'schema_only' end,
      'rows',n,'dateColumn',date_column,'firstAt',first_at,'lastAt',last_at,'columns',columns_json));
  end loop;
  select coalesce(jsonb_agg(x),'[]'::jsonb) into payloads from (
    select key as field, count(*) as reports from public.report_versions r
    cross join lateral jsonb_object_keys(case when jsonb_typeof(r.payload)='object' then r.payload else '{}'::jsonb end) key
    where r.organization_id=p_organization_id group by key order by key
  ) x;
  select coalesce(jsonb_agg(x),'[]'::jsonb) into holders from (
    select chain, snapshot->>'source' as provider, count(*) as snapshots,
      min(saved_at) as first_saved_at,max(saved_at) as last_saved_at,
      count(*) filter(where attestation_state='server_attested') as server_attested,
      count(*) filter(where snapshot->>'status'='complete') as coverage_complete
    from public.holder_snapshot_history where organization_id=p_organization_id
    group by chain,snapshot->>'source' order by chain,snapshot->>'source'
  ) x;
  select jsonb_build_object('timezone','Europe/Lisbon','from',day_start,'to',now(),
    'recordedUsd',coalesce(sum(usd),0),'events',count(*),'calls',coalesce(sum(calls),0),
    'zeroUsdEvents',count(*) filter(where usd=0),'notifyAboveUsd',100,
    'thresholdExceeded',coalesce(sum(usd),0)>100,'hardCapUsd',null,
    'basis','Recorded report usage only; estimates and exact charges are mixed. Zero-dollar rows may be free, subscription-backed or unpriced. Bulk jobs and unrecorded calls are not included. This is not a complete provider bill.')
    into spend from public.provider_usage_events
    where organization_id=p_organization_id and created_at>=day_start and created_at<=now();
  return jsonb_build_object('version',1,'capturedAt',now(),'scope','authenticated_workspace',
    'datasets',datasets,'savedReportFields',payloads,'holderHistory',holders,'dailySpend',spend,
    'limitations',jsonb_build_array('Shared tables expose schema only. This is not a full physical database audit.',
      'Saved fields and row counts do not establish source accuracy, identity binding or complete history.',
      'Daily spend uses ledger recording time; delayed or missing receipts can change totals.'));
end;
$$;
revoke all on function public.get_data_program_inventory(uuid) from public, anon, authenticated;
grant execute on function public.get_data_program_inventory(uuid) to service_role;
commit;
