-- Executable contract for the production database-advisor remediation.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(2);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join lateral pg_catalog.unnest(constraint_row.conkey)
      with ordinality first_key(attnum, ordinal_position)
      on first_key.ordinal_position = 1
    join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
     and attribute_row.attnum = first_key.attnum
    where constraint_row.contype = 'f'
      and (constraint_row.conrelid::regclass::text, attribute_row.attname) in (
        ('audit_log', 'contributor_user_id'),
        ('case_events', 'actor_user_id'),
        ('case_events', 'report_version_id'),
        ('cases', 'created_by'),
        ('member_events', 'actor_user_id'),
        ('member_events', 'target_user_id'),
        ('report_versions', 'created_by'),
        ('reports', 'created_by'),
        ('reports', 'report_version_id'),
        ('share_links', 'created_by'),
        ('usage_events', 'user_id')
      )
      and not exists (
        select 1
        from pg_catalog.pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and index_row.indisready
          and index_row.indkey[0] = attribute_row.attnum
      )
  ),
  'every advisor-reported foreign key has a valid leading index'
);

select ok(
  not exists (
    select 1
    from (values
      ('auth_request_limits'),
      ('credit_ledger'),
      ('entity_facts'),
      ('feedback_items'),
      ('provider_cache'),
      ('referral_attributions'),
      ('referral_commissions'),
      ('referral_profiles'),
      ('waitlist_signups')
    ) service_table(table_name)
    join pg_catalog.pg_class table_row
      on table_row.relname = service_table.table_name
    join pg_catalog.pg_namespace schema_row
      on schema_row.oid = table_row.relnamespace
     and schema_row.nspname = 'public'
    where not table_row.relrowsecurity
       or exists (
         select 1
         from information_schema.role_table_grants grant_row
         where grant_row.table_schema = 'public'
           and grant_row.table_name = service_table.table_name
           and grant_row.grantee in ('anon', 'authenticated')
       )
       or not exists (
         select 1
         from pg_catalog.pg_policy policy_row
         where policy_row.polrelid = table_row.oid
           and policy_row.polname = service_table.table_name || '_deny_browser_roles'
           and policy_row.polcmd = '*'
       )
  ),
  'service-only tables retain RLS, no browser grants, and an explicit deny policy'
);

select * from finish();
rollback;
