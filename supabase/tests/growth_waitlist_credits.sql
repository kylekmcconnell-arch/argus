begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select has_table('public', 'waitlist_signups', 'waitlist signup staging exists');

select ok(
  not has_table_privilege('anon', 'public.waitlist_signups', 'select')
  and not has_table_privilege('authenticated', 'public.waitlist_signups', 'select'),
  'waitlist signups are server mediated'
);

select has_function(
  'public',
  'consume_investigation_credit',
  array['uuid', 'uuid', 'text', 'bigint'],
  'credit consume function exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.consume_investigation_credit(uuid,uuid,text,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.consume_investigation_credit(uuid,uuid,text,bigint)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.consume_investigation_credit(uuid,uuid,text,bigint)',
    'execute'
  ),
  'credit consume is service-role only'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'referral_profiles_admitted_org_check'
      and conrelid = 'public.referral_profiles'::regclass
  ),
  'admitted referral profiles require an organization'
);

select col_is_null(
  'public',
  'referral_profiles',
  'organization_id',
  'waitlist profiles may exist without an organization'
);

select * from finish();
rollback;
