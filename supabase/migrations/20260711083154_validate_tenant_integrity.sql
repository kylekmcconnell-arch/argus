-- Validate historical rows separately from constraint installation so the
-- stronger ADD CONSTRAINT locks are not retained during the table scans.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.evidence_items
  validate constraint evidence_items_organization_report_version_fkey;
alter table public.check_runs
  validate constraint check_runs_organization_report_version_fkey;
alter table public.case_events
  validate constraint case_events_organization_case_fkey;
alter table public.case_events
  validate constraint case_events_organization_case_report_version_fkey;
alter table public.share_links
  validate constraint share_links_organization_report_version_fkey;
alter table public.report_cost_lines
  validate constraint report_cost_lines_organization_report_version_fkey;
alter table public.reports
  validate constraint reports_organization_report_version_fkey;
alter table public.usage_events
  validate constraint usage_events_organization_user_fkey;

commit;
