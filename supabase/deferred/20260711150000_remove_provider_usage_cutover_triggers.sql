-- Deferred cutover cleanup. Apply only after every deployment from before the
-- provider-usage release has drained and production usage totals have been
-- reconciled. The bridged legacy RPC may remain for rollback compatibility.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop trigger if exists report_cost_lines_capture_legacy_write
  on public.report_cost_lines;
drop trigger if exists report_cost_lines_bridge_legacy_update
  on public.report_cost_lines;

drop function if exists public.capture_legacy_report_cost_write();
drop function if exists public.bridge_legacy_report_cost_update();

commit;
