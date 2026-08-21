begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_table('public', 'credit_ledger', 'credit ledger exists');
select has_table('public', 'referral_profiles', 'referral profiles exist');
select has_table('public', 'referral_attributions', 'referral attributions exist');
select has_table('public', 'referral_commissions', 'referral commissions exist');
select has_table('public', 'feedback_items', 'feedback queue exists');

select ok(
  not has_table_privilege('anon', 'public.credit_ledger', 'select')
  and not has_table_privilege('authenticated', 'public.credit_ledger', 'select'),
  'credit ledger is server mediated'
);

select ok(
  not has_table_privilege('anon', 'public.feedback_items', 'select')
  and not has_table_privilege('authenticated', 'public.feedback_items', 'select'),
  'feedback queue is server mediated'
);

select ok(
  not has_function_privilege('anon', 'public.claim_referral(uuid,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_referral(uuid,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.claim_referral(uuid,text,bigint)', 'execute'),
  'referral claim is service-role only'
);

select * from finish();
rollback;
