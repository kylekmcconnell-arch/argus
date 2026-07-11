-- Adversarial regression test for typed, atomic augmentations.
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

insert into public.organizations (id, slug, name)
values ('10000000-0000-4000-8000-000000000002', 'augmentation-tenant-two', 'Augmentation Tenant Two');

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000101'),
  ('10000000-0000-4000-8000-000000000102'),
  ('10000000-0000-4000-8000-000000000103'),
  ('10000000-0000-4000-8000-000000000104');

insert into public.argus_members (
  user_id,
  organization_id,
  role,
  display_name
) values
  (
    '10000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'owner',
    'Tenant One Owner'
  ),
  (
    '10000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'analyst',
    'Tenant One Analyst'
  ),
  (
    '10000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000001',
    'viewer',
    'Tenant One Viewer'
  ),
  (
    '10000000-0000-4000-8000-000000000104',
    '10000000-0000-4000-8000-000000000002',
    'owner',
    'Tenant Two Owner'
  );

-- All mutations are service-only. The RPC still verifies that the supplied
-- actor is an active member with the required role in the supplied tenant.
set local role service_role;

select (public.submit_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000102',
  'token',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME',
  'token:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'github',
  '',
  '',
  'github:alpha-labs',
  'alpha-labs',
  'Alpha Labs',
  'https://github.com/alpha-labs',
  null,
  'github:alpha-labs',
  false,
  null
)).id;

-- A duplicate fact must update exactly one row and append a second event.
select (public.submit_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000102',
  'token',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME',
  'token:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'github',
  '',
  '',
  'github:alpha-labs',
  'alpha-labs',
  'Alpha Labs updated',
  'https://github.com/alpha-labs',
  'second corroborating submission',
  'github:alpha-labs',
  false,
  null
)).id;

-- The same subject and fact remain independent across organizations.
select (public.submit_augmentation_item(
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000104',
  'token',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME',
  'tenant-two-token-node',
  'github',
  '',
  '',
  'github:alpha-labs',
  'alpha-labs',
  'Alpha Labs',
  'https://github.com/alpha-labs',
  null,
  'github:alpha-labs',
  false,
  null
)).id;

-- The same canonical ref remains independent across case kinds.
select (public.submit_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000102',
  'investigation',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME investigation',
  'investigation:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'github',
  '',
  '',
  'github:alpha-labs',
  'alpha-labs',
  'Alpha Labs',
  'https://github.com/alpha-labs',
  null,
  'github:alpha-labs',
  false,
  null
)).id;

-- Distinct targets for the same subject must never collapse.
select (public.submit_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000102',
  'token',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME',
  'token:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'github',
  '',
  '',
  'github:beta-labs',
  'beta-labs',
  'Beta Labs',
  'https://github.com/beta-labs',
  null,
  'github:beta-labs',
  false,
  null
)).id;

-- A pending duplicate that becomes corroborated is an auto-publication event,
-- not another ordinary submission event.
select (public.submit_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000102',
  'token',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME',
  'token:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'website',
  '',
  '',
  'website:example.org',
  'https://example.org',
  'Example',
  'https://example.org',
  null,
  'site:example.org',
  false,
  null
)).id;
select (public.submit_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000102',
  'token',
  'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '$SAME',
  'token:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'website',
  '',
  '',
  'website:example.org',
  'https://example.org',
  'Example',
  'https://example.org',
  null,
  'site:example.org',
  true,
  'independently corroborated'
)).id;

select pg_temp.expect_error('viewer submission', $sql$
  select public.submit_augmentation_item(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000103',
    'person', 'viewer', 'Viewer', null,
    'x', '', '', 'x:viewer', 'viewer', '@viewer', null, null, 'x:viewer', false, null
  )
$sql$, '42501');

select pg_temp.expect_error('cross-tenant actor submission', $sql$
  select public.submit_augmentation_item(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000104',
    'person', 'cross-tenant', 'Cross tenant', null,
    'x', '', '', 'x:cross-tenant', 'cross-tenant', '@cross-tenant', null, null,
    'x:cross-tenant', false, null
  )
$sql$, '42501');

-- Only an owner in the item's organization can make the durable decision.
select pg_temp.expect_error('analyst review', $sql$
  select public.review_augmentation_item(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000102',
    (select id from public.augmentation_items
      where organization_id = '00000000-0000-4000-8000-000000000001'
        and subject_kind = 'token'
        and target_canonical_ref = 'github:alpha-labs'),
    'approve', null
  )
$sql$, '42501');

select pg_temp.expect_error('cross-tenant owner review', $sql$
  select public.review_augmentation_item(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000104',
    (select id from public.augmentation_items
      where organization_id = '00000000-0000-4000-8000-000000000001'
        and subject_kind = 'token'
        and target_canonical_ref = 'github:alpha-labs'),
    'approve', null
  )
$sql$, 'P0002');

select (public.review_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  (select id from public.augmentation_items
    where organization_id = '00000000-0000-4000-8000-000000000001'
      and subject_kind = 'token'
      and target_canonical_ref = 'github:alpha-labs'),
  'approve',
  'owner verified source control identity'
)).id;

-- Replaying the same owner's same decision is idempotent and appends no event.
select (public.review_augmentation_item(
  '00000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  (select id from public.augmentation_items
    where organization_id = '00000000-0000-4000-8000-000000000001'
      and subject_kind = 'token'
      and target_canonical_ref = 'github:alpha-labs'),
  'approve',
  'owner verified source control identity'
)).id;

select pg_temp.expect_error('conflicting owner decision', $sql$
  select public.review_augmentation_item(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101',
    (select id from public.augmentation_items
      where organization_id = '00000000-0000-4000-8000-000000000001'
        and subject_kind = 'token'
        and target_canonical_ref = 'github:alpha-labs'),
    'deny', null
  )
$sql$, '40001');

-- Composite event ownership prevents even a service caller from pairing an
-- item ID with another tenant.
select pg_temp.expect_error('cross-tenant event pairing', $sql$
  insert into public.augmentation_events (
    organization_id, item_id, event_type, to_status
  )
  select
    '10000000-0000-4000-8000-000000000002', id,
    'augmentation.submitted', status
  from public.augmentation_items
  where organization_id = '00000000-0000-4000-8000-000000000001'
    and subject_kind = 'token'
    and target_canonical_ref = 'github:alpha-labs'
$sql$, '23503');

-- Events are append-only and items cannot be deleted through the API role.
select pg_temp.expect_error('service event update', $sql$
  update public.augmentation_events set metadata = '{"tampered":true}'::jsonb
$sql$, '42501');
select pg_temp.expect_error('service item delete', $sql$
  delete from public.augmentation_items
$sql$, '42501');

reset role;

do $assert_rows_and_events$
declare
  v_item public.augmentation_items;
begin
  select item.* into strict v_item
  from public.augmentation_items item
  where item.organization_id = '00000000-0000-4000-8000-000000000001'
    and item.subject_kind = 'token'
    and item.target_canonical_ref = 'github:alpha-labs';

  if v_item.submission_count <> 2
     or v_item.status <> 'live'
     or v_item.decision_source <> 'owner_approved'
     or v_item.subject_graph_key <> 'token:eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
     or v_item.reviewed_by <> '10000000-0000-4000-8000-000000000101' then
    raise exception 'duplicate submission or owner review state is incorrect: %', row_to_json(v_item);
  end if;

  if (select count(*) from public.augmentation_items
      where canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        and target_canonical_ref = 'github:alpha-labs') <> 3 then
    raise exception 'same canonical ref did not remain independent across tenant and kind';
  end if;

  if (select count(*) from public.augmentation_items
      where organization_id = '00000000-0000-4000-8000-000000000001'
        and subject_kind = 'token'
        and canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') <> 3 then
    raise exception 'distinct targets collapsed for one subject';
  end if;

  if (select count(*) from public.augmentation_events
      where item_id = v_item.id and event_type = 'augmentation.submitted') <> 2
     or (select count(*) from public.augmentation_events
      where item_id = v_item.id and event_type = 'augmentation.approved') <> 1 then
    raise exception 'duplicate or idempotent-review event history is incorrect';
  end if;

  select item.* into strict v_item
  from public.augmentation_items item
  where item.organization_id = '00000000-0000-4000-8000-000000000001'
    and item.subject_kind = 'token'
    and item.target_canonical_ref = 'website:example.org';
  if v_item.status <> 'live'
     or v_item.decision_source <> 'auto_corroborated'
     or v_item.submission_count <> 2
     or (select count(*) from public.augmentation_events
         where item_id = v_item.id
           and event_type = 'augmentation.auto_published') <> 1 then
    raise exception 'pending-to-auto-live transition was not recorded correctly';
  end if;
end;
$assert_rows_and_events$;

-- Direct Data API reads are tenant scoped. Members can see facts; only owners
-- can see the immutable decision/event history.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000101',
  true
);
set local role authenticated;
select pg_temp.expect_count('tenant-one owner item visibility',
  $sql$select count(*) from public.augmentation_items
    where canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$sql$,
  4);
select pg_temp.expect_count('tenant-one owner event visibility', $sql$
  select count(*)
  from public.augmentation_events event
  join public.augmentation_items item
    on item.organization_id = event.organization_id and item.id = event.item_id
  where item.canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$sql$, 7);
select pg_temp.expect_count('tenant-one owner cross-tenant isolation', $sql$
  select count(*) from public.augmentation_items
  where organization_id = '10000000-0000-4000-8000-000000000002'
$sql$, 0);
select pg_temp.expect_error('authenticated RPC execution', $sql$
  select public.review_augmentation_item(
    '00000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101',
    (select id from public.augmentation_items limit 1),
    'approve', null
  )
$sql$, '42501');
select pg_temp.expect_error('authenticated direct write', $sql$
  insert into public.augmentation_items (
    organization_id, subject_kind, canonical_ref, subject_label,
    item_type, target_canonical_ref, value, label, status,
    decision_source, submitted_by_label
  ) values (
    '00000000-0000-4000-8000-000000000001', 'person', 'forbidden', 'Forbidden',
    'x', 'x:forbidden', 'forbidden', '@forbidden', 'pending',
    'awaiting_owner', 'Forbidden'
  )
$sql$, '42501');
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000102',
  true
);
set local role authenticated;
select pg_temp.expect_count('tenant-one analyst item visibility',
  $sql$select count(*) from public.augmentation_items
    where canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$sql$,
  4);
select pg_temp.expect_count('tenant-one analyst event privacy',
  'select count(*) from public.augmentation_events', 0);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000104',
  true
);
set local role authenticated;
select pg_temp.expect_count('tenant-two owner item visibility',
  $sql$select count(*) from public.augmentation_items
    where canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'$sql$,
  1);
select pg_temp.expect_count('tenant-two owner event visibility', $sql$
  select count(*)
  from public.augmentation_events event
  join public.augmentation_items item
    on item.organization_id = event.organization_id and item.id = event.item_id
  where item.canonical_ref = 'eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$sql$, 1);
reset role;

do $assert_catalog$
declare
  submit_rpc regprocedure := pg_catalog.to_regprocedure(
    'public.submit_augmentation_item(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text)'
  );
begin
  if submit_rpc is null then
    raise exception '17-argument subject-graph-key submit RPC is missing';
  end if;
  if pg_catalog.to_regprocedure(
    'public.submit_augmentation_item(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text)'
  ) is not null then
    raise exception 'stale 16-argument submit RPC remains';
  end if;
  if not pg_catalog.has_function_privilege('service_role', submit_rpc, 'execute')
     or pg_catalog.has_function_privilege('authenticated', submit_rpc, 'execute')
     or pg_catalog.has_function_privilege('anon', submit_rpc, 'execute') then
    raise exception 'submit RPC grants are unsafe';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_proc function
    where function.oid in (
      submit_rpc::oid,
      'public.review_augmentation_item(uuid,uuid,uuid,text,text)'::regprocedure::oid,
      'public.record_augmentation_diagnosis(uuid,uuid,uuid,text,text)'::regprocedure::oid
    )
      and (
        function.prosecdef
        or not ('search_path=""' = any(function.proconfig))
      )
  ) then
    raise exception 'augmentation RPC security mode or search path is unsafe';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.augmentation_items'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.augmentation_events'::regclass and relrowsecurity
  ) then
    raise exception 'augmentation RLS is disabled';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', 'public.augmentation_items', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.augmentation_items', 'insert,update,delete')
     or not pg_catalog.has_table_privilege('authenticated', 'public.augmentation_events', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.augmentation_events', 'insert,update,delete') then
    raise exception 'authenticated table grants are unsafe';
  end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.augmentation_items', 'select,insert,update')
     or pg_catalog.has_table_privilege('service_role', 'public.augmentation_items', 'delete,truncate')
     or not pg_catalog.has_table_privilege('service_role', 'public.augmentation_events', 'select,insert')
     or pg_catalog.has_table_privilege('service_role', 'public.augmentation_events', 'update,delete,truncate') then
    raise exception 'service-role table grants are unsafe';
  end if;
  if exists (
    select 1 from public.augmentation_items
    where char_length(target_canonical_ref) > 1200
  ) then
    raise exception 'an augmentation target canonical ref exceeds its bound';
  end if;
  if exists (
    select 1 from public.augmentation_items
    where subject_kind = 'legacy'
      and target_canonical_ref !~ '^legacy-sha256:[0-9a-f]{64}$'
  ) then
    raise exception 'a legacy augmentation lacks its bounded collision-resistant identity';
  end if;
end;
$assert_catalog$;

rollback;
