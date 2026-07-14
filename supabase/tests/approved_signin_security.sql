-- Executable regression coverage for approved-member sign-in infrastructure.
-- Run against a migrated local database with `supabase test db`.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(1);

do $catalog_assertions$
begin
  if pg_catalog.has_table_privilege('anon', 'public.auth_request_limits', 'select')
     or pg_catalog.has_table_privilege('authenticated', 'public.auth_request_limits', 'select')
     or not pg_catalog.has_table_privilege(
       'service_role',
       'public.auth_request_limits',
       'select,insert,update,delete'
     ) then
    raise exception 'auth request limit table grants are unsafe';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.consume_auth_request_limit(text,text,integer,integer)',
       'execute'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.consume_auth_request_limit(text,text,integer,integer)',
       'execute'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.consume_auth_request_limit(text,text,integer,integer)',
       'execute'
     ) then
    raise exception 'auth request limiter function grants are unsafe';
  end if;

  if pg_catalog.has_table_privilege('service_role', 'auth.users', 'select') then
    raise exception 'service role unexpectedly has broad auth.users read access';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'sync_argus_member_normalized_email'
      and procedure.prosecdef
  ) then
    raise exception 'private SECURITY DEFINER member email trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'public.argus_members'::regclass
      and trigger.tgname = 'argus_members_sync_normalized_email'
      and trigger.tgfoid = 'private.sync_argus_member_normalized_email()'::regprocedure
      and not trigger.tgisinternal
  ) then
    raise exception 'member email trigger is not bound to the private function';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger
    where trigger.tgrelid = 'auth.users'::regclass
      and trigger.tgname = 'argus_members_sync_auth_email'
      and trigger.tgfoid = 'private.sync_argus_members_after_auth_email_change()'::regprocedure
      and not trigger.tgisinternal
  ) then
    raise exception 'Auth email changes are not bound to member synchronization';
  end if;

  if pg_catalog.to_regclass('public.argus_members_normalized_email_uidx') is null then
    raise exception 'normalized member email index is missing';
  end if;
end;
$catalog_assertions$;

insert into public.organizations (id, slug, name)
values (
  '50000000-0000-4000-8000-000000000001',
  'approved-signin-test',
  'Approved Sign-in Test'
);

insert into auth.users (id, email)
values (
  '50000000-0000-4000-8000-000000000101',
  'approved-owner@argus.test'
);

set local role service_role;

insert into public.argus_members (
  user_id,
  organization_id,
  role,
  display_name
) values (
  '50000000-0000-4000-8000-000000000101',
  '50000000-0000-4000-8000-000000000001',
  'owner',
  'Approved Owner'
);

reset role;

update auth.users
set email = 'approved-owner-updated@argus.test'
where id = '50000000-0000-4000-8000-000000000101';

set local role service_role;

insert into public.auth_request_limits (
  scope,
  key_hash,
  window_started_at,
  attempts,
  updated_at
) values (
  'signin_email',
  repeat('b', 64),
  now() - interval '2 days',
  1,
  now() - interval '2 days'
);

do $service_role_assertions$
declare
  v_first record;
  v_second record;
  v_normalized_email text;
begin
  select normalized_email
  into v_normalized_email
  from public.argus_members
  where user_id = '50000000-0000-4000-8000-000000000101';

  if v_normalized_email <> 'approved-owner-updated@argus.test' then
    raise exception 'Auth email update did not resync approved membership';
  end if;

  select * into v_first
  from public.consume_auth_request_limit(
    'signin_email',
    repeat('a', 64),
    3600,
    1
  );
  select * into v_second
  from public.consume_auth_request_limit(
    'signin_email',
    repeat('a', 64),
    3600,
    1
  );

  if v_first.allowed is distinct from true
     or v_first.remaining <> 0
     or v_first.retry_after_seconds <> 0 then
    raise exception 'first auth request should be allowed: %', row_to_json(v_first);
  end if;
  if v_second.allowed is distinct from false
     or v_second.remaining <> 0
     or v_second.retry_after_seconds < 1 then
    raise exception 'second auth request should be throttled: %', row_to_json(v_second);
  end if;

  if exists (
    select 1
    from public.auth_request_limits
    where scope = 'signin_email' and key_hash = repeat('b', 64)
  ) then
    raise exception 'stale auth request limit row was not pruned';
  end if;
end;
$service_role_assertions$;

reset role;
select pass('approved sign-in lookup, email sync, grants, throttling, and retention are safe');
select * from finish();
rollback;
