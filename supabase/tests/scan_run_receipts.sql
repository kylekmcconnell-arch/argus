-- Executable database contract for the owner scan operations ledger.
-- Structure and privileges keep the table server-mediated; the behavioural
-- assertions below prove the append-only guarantees the ledger is built on,
-- because an audit trail that can be rewritten after the fact is not evidence.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(13);
select has_table('public', 'scan_run_receipts', 'scan receipt ledger exists');
select ok(not has_table_privilege('anon', 'public.scan_run_receipts', 'select') and not has_table_privilege('authenticated', 'public.scan_run_receipts', 'select'), 'scan receipts are server mediated');
select ok(has_table_privilege('service_role', 'public.scan_run_receipts', 'select') and has_table_privilege('service_role', 'public.scan_run_receipts', 'insert') and has_table_privilege('service_role', 'public.scan_run_receipts', 'update') and not has_table_privilege('service_role', 'public.scan_run_receipts', 'delete'), 'service role can append and finish receipts but cannot delete them');
select has_trigger('public', 'scan_run_receipts', 'scan_run_receipts_transition_guard', 'terminal transition guard exists');
select ok(not has_function_privilege('anon', 'public.enforce_scan_run_receipt_transition()', 'execute') and not has_function_privilege('authenticated', 'public.enforce_scan_run_receipt_transition()', 'execute'), 'transition guard is not callable by browser roles');
select col_is_fk('public', 'scan_run_receipts', array['organization_id', 'report_version_id'], 'receipts bind to immutable reports in the same workspace');

insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-000000000201', 'scan-receipt-test', 'Scan Receipt Test');
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000202', 'scan-receipt@argus.test');
insert into public.argus_members (user_id, organization_id, role, display_name)
values (
  '00000000-0000-4000-8000-000000000202',
  '00000000-0000-4000-8000-000000000201',
  'owner',
  'Scan Receipt Owner'
);

insert into public.scan_run_receipts (
  id, organization_id, run_key, initiated_by, route, kind,
  canonical_ref, display_query, status, started_at
)
values (
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000201',
  'scan-receipt-test-001',
  '00000000-0000-4000-8000-000000000202',
  '/api/audit',
  'person',
  'alice_receipt',
  '@alice_receipt',
  'running',
  now()
);

-- Identity is frozen from the moment the run is reserved, so a receipt can
-- never be re-pointed at a different subject after the credit is charged.
select throws_ok(
  $$update public.scan_run_receipts
      set canonical_ref = 'someone_else', status = 'complete',
          finished_at = now(), duration_ms = 1000
    where id = '00000000-0000-4000-8000-000000000203'$$,
  'P0001'::char(5),
  'scan receipt identity is immutable',
  'a running receipt cannot be re-pointed at another subject'
);

-- A running receipt may only be finished, never quietly edited in place.
select throws_ok(
  $$update public.scan_run_receipts
      set failure_detail = 'still going'
    where id = '00000000-0000-4000-8000-000000000203'$$,
  'P0001'::char(5),
  'scan receipt may only transition to a terminal state',
  'a running receipt cannot be updated without terminalising it'
);

-- The displayed label is identity too: an owner reading the ledger must see
-- the subject as it was reserved, not one relabelled after the charge.
select throws_ok(
  $$update public.scan_run_receipts
      set display_query = '$RELABELLED', status = 'complete',
          finished_at = now(), duration_ms = 1000
    where id = '00000000-0000-4000-8000-000000000203'$$,
  'P0001'::char(5),
  'scan receipt identity is immutable',
  'a receipt cannot be relabelled while being finished'
);

select lives_ok(
  $$update public.scan_run_receipts
      set status = 'degraded', finished_at = now(), duration_ms = 4200,
          failure_code = 'provider_quota', failure_detail = 'Grok reported exhausted quota.',
          provider_cost_usd = 0.42, cost_basis = 'estimated'
    where id = '00000000-0000-4000-8000-000000000203'$$,
  'a running receipt can be finished exactly once'
);

-- The whole point of the ledger: once terminal, the record is evidence.
select throws_ok(
  $$update public.scan_run_receipts
      set failure_detail = 'rewritten after the fact'
    where id = '00000000-0000-4000-8000-000000000203'$$,
  'P0001'::char(5),
  'terminal scan receipt is immutable',
  'a finished receipt cannot be rewritten'
);

-- A terminal row without timing data would let a failed scan masquerade as
-- an in-flight one, so the shape constraint refuses it outright.
select throws_ok(
  $$insert into public.scan_run_receipts (
      organization_id, run_key, initiated_by, route, kind,
      canonical_ref, display_query, status, started_at
    ) values (
      '00000000-0000-4000-8000-000000000201', 'scan-receipt-test-002',
      '00000000-0000-4000-8000-000000000202', '/api/audit', 'person',
      'bob_receipt', '@bob_receipt', 'complete', now()
    )$$,
  '23514'::char(5),
  null,
  'a terminal receipt must carry finished_at and duration_ms'
);

-- A claimed cost basis without a cost is an unsupported number.
select throws_ok(
  $$insert into public.scan_run_receipts (
      organization_id, run_key, initiated_by, route, kind,
      canonical_ref, display_query, status, started_at, cost_basis
    ) values (
      '00000000-0000-4000-8000-000000000201', 'scan-receipt-test-003',
      '00000000-0000-4000-8000-000000000202', '/api/audit', 'person',
      'carol_receipt', '@carol_receipt', 'running', now(), 'exact'
    )$$,
  '23514'::char(5),
  null,
  'an exact cost basis cannot be recorded without a cost'
);

select * from finish();
rollback;
