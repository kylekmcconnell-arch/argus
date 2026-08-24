-- Resolve the actionable production database-advisor findings without opening
-- any browser-visible data path. These tables remain server-only: anon and
-- authenticated have no table grants, and the policies below explicitly deny
-- either browser role if a grant is accidentally added later.

create policy auth_request_limits_deny_browser_roles
  on public.auth_request_limits for all to anon, authenticated
  using (false) with check (false);

create policy credit_ledger_deny_browser_roles
  on public.credit_ledger for all to anon, authenticated
  using (false) with check (false);

create policy entity_facts_deny_browser_roles
  on public.entity_facts for all to anon, authenticated
  using (false) with check (false);

create policy feedback_items_deny_browser_roles
  on public.feedback_items for all to anon, authenticated
  using (false) with check (false);

create policy provider_cache_deny_browser_roles
  on public.provider_cache for all to anon, authenticated
  using (false) with check (false);

create policy referral_attributions_deny_browser_roles
  on public.referral_attributions for all to anon, authenticated
  using (false) with check (false);

create policy referral_commissions_deny_browser_roles
  on public.referral_commissions for all to anon, authenticated
  using (false) with check (false);

create policy referral_profiles_deny_browser_roles
  on public.referral_profiles for all to anon, authenticated
  using (false) with check (false);

create policy waitlist_signups_deny_browser_roles
  on public.waitlist_signups for all to anon, authenticated
  using (false) with check (false);

-- Foreign-key support indexes protect parent-row updates/deletes from full
-- child-table scans and cover direct audit lookups by actor or creator.
create index if not exists audit_log_contributor_user_id_idx
  on public.audit_log (contributor_user_id);
create index if not exists case_events_actor_user_id_idx
  on public.case_events (actor_user_id);
create index if not exists case_events_report_version_id_idx
  on public.case_events (report_version_id);
create index if not exists cases_created_by_idx
  on public.cases (created_by);
create index if not exists member_events_actor_user_id_idx
  on public.member_events (actor_user_id);
create index if not exists member_events_target_user_id_idx
  on public.member_events (target_user_id);
create index if not exists report_versions_created_by_idx
  on public.report_versions (created_by);
create index if not exists reports_created_by_idx
  on public.reports (created_by);
create index if not exists reports_report_version_id_idx
  on public.reports (report_version_id);
create index if not exists share_links_created_by_idx
  on public.share_links (created_by);
create index if not exists usage_events_user_id_idx
  on public.usage_events (user_id);
