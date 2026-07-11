-- Regression coverage for exact historical snapshot sharing.
-- Run after the canonical migrations with psql -v ON_ERROR_STOP=1.

begin;

create or replace function pg_temp.expect_error(label text, statement text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
  exception when others then
    return;
  end;
  raise exception '% unexpectedly succeeded', label;
end;
$$;

insert into public.organizations (id, slug, name)
values ('20000000-0000-4000-8000-000000000002', 'historical-share-two', 'Historical Share Two');

insert into public.cases (
  id, organization_id, kind, canonical_ref, display_query, status
) values
  (
    '20000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'person', 'historical-share', '@historical-share', 'open'
  ),
  (
    '20000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'person', 'archived-share', '@archived-share', 'archived'
  );

insert into public.report_versions (
  id, case_id, organization_id, version, payload, contributor_label
) values
  (
    '20000000-0000-4000-8000-000000000201',
    '20000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    1, '{"report":{"handle":"historical-share"}}', 'test'
  ),
  (
    '20000000-0000-4000-8000-000000000202',
    '20000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    2, '{"report":{"handle":"historical-share"}}', 'test'
  ),
  (
    '20000000-0000-4000-8000-000000000203',
    '20000000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    1, '{"report":{"handle":"archived-share"}}', 'test'
  );

-- Version one is no longer latest, but remains an immutable version of the
-- same open case and must be independently shareable.
insert into public.share_links (organization_id, report_version_id, token_hash)
values (
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000201',
  'historical-share-positive'
);

select pg_temp.expect_error('cross-tenant historical share', $sql$
  insert into public.share_links (organization_id, report_version_id, token_hash)
  values (
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000201',
    'historical-share-cross-tenant'
  )
$sql$);

select pg_temp.expect_error('archived historical share', $sql$
  insert into public.share_links (organization_id, report_version_id, token_hash)
  values (
    '00000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000203',
    'historical-share-archived'
  )
$sql$);

select pg_temp.expect_error('share identity update', $sql$
  update public.share_links
  set report_version_id = '20000000-0000-4000-8000-000000000202'
  where token_hash = 'historical-share-positive'
$sql$);

-- Revocation remains possible even after the case closes.
update public.cases
set status = 'archived'
where id = '20000000-0000-4000-8000-000000000101';

update public.share_links
set revoked_at = now()
where token_hash = 'historical-share-positive';

do $assert_share_guards$
begin
  if not exists (
    select 1
    from public.share_links
    where token_hash = 'historical-share-positive'
      and report_version_id = '20000000-0000-4000-8000-000000000201'
      and revoked_at is not null
  ) then
    raise exception 'exact historical share or post-archive revocation failed';
  end if;

  if pg_catalog.has_function_privilege('anon', 'public.enforce_open_case_share()', 'execute')
     or pg_catalog.has_function_privilege('authenticated', 'public.enforce_open_case_share()', 'execute')
     or not pg_catalog.has_function_privilege('service_role', 'public.enforce_open_case_share()', 'execute') then
    raise exception 'share guard function grants are unsafe';
  end if;
end;
$assert_share_guards$;

rollback;
