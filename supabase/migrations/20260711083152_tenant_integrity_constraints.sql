-- Structural tenant integrity for every immutable-report child.
--
-- RLS controls who can read rows. These composite foreign keys separately
-- ensure that even service-role writes cannot pair one organization's ID with
-- another organization's case, version, evidence, share, projection, or cost.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Never guess how to repair a tenant mismatch. Abort before taking schema locks
-- so suspicious rows can be quarantined and adjudicated explicitly.
do $preflight$
declare
  v_violations jsonb;
begin
  with violations(check_name, row_id) as (
    select 'report_versions.case_org', rv.id
    from public.report_versions rv
    left join public.cases c on c.id = rv.case_id
    where c.id is null
       or rv.organization_id is distinct from c.organization_id

    union all
    select 'evidence_items.version_org', e.id
    from public.evidence_items e
    left join public.report_versions rv on rv.id = e.report_version_id
    where rv.id is null
       or e.organization_id is distinct from rv.organization_id

    union all
    select 'check_runs.version_org', cr.id
    from public.check_runs cr
    left join public.report_versions rv on rv.id = cr.report_version_id
    where rv.id is null
       or cr.organization_id is distinct from rv.organization_id

    union all
    select 'share_links.version_org', sl.id
    from public.share_links sl
    left join public.report_versions rv on rv.id = sl.report_version_id
    where rv.id is null
       or sl.organization_id is distinct from rv.organization_id

    union all
    select 'report_cost_lines.version_org', line.id
    from public.report_cost_lines line
    left join public.report_versions rv on rv.id = line.report_version_id
    where rv.id is null
       or line.organization_id is distinct from rv.organization_id

    union all
    select 'reports.version_org', report.id
    from public.reports report
    left join public.report_versions rv on rv.id = report.report_version_id
    where report.report_version_id is not null
      and (
        rv.id is null
        or report.organization_id is distinct from rv.organization_id
      )

    union all
    select 'case_events.case_org', event.id
    from public.case_events event
    left join public.cases c on c.id = event.case_id
    where c.id is null
       or event.organization_id is distinct from c.organization_id

    union all
    select 'case_events.version_case_org', event.id
    from public.case_events event
    left join public.report_versions rv on rv.id = event.report_version_id
    where event.report_version_id is not null
      and (
        rv.id is null
        or event.organization_id is distinct from rv.organization_id
        or event.case_id is distinct from rv.case_id
      )

    union all
    select 'usage_events.user_org', usage.id
    from public.usage_events usage
    left join public.argus_members member
      on member.organization_id = usage.organization_id
     and member.user_id = usage.user_id
    where usage.user_id is not null
      and member.user_id is null
  ), grouped as (
    select check_name, count(*)::integer as rows
    from violations
    group by check_name
  )
  select coalesce(pg_catalog.jsonb_object_agg(check_name, rows), '{}'::jsonb)
  into v_violations
  from grouped;

  if v_violations <> '{}'::jsonb then
    raise exception 'tenant integrity preflight failed: %', v_violations;
  end if;
end;
$preflight$;

-- The UUID is globally unique, but PostgreSQL needs this explicit composite key
-- as the target for tenant-aware downstream foreign keys.
alter table public.report_versions
  add constraint report_versions_organization_id_id_key
  unique (organization_id, id);

create index evidence_items_org_report_version_idx
  on public.evidence_items (organization_id, report_version_id);
create index check_runs_org_report_version_idx
  on public.check_runs (organization_id, report_version_id);
create index case_events_org_case_report_version_idx
  on public.case_events (organization_id, case_id, report_version_id);
create index share_links_org_report_version_idx
  on public.share_links (organization_id, report_version_id);
create index reports_org_report_version_idx
  on public.reports (organization_id, report_version_id);

-- NOT VALID still protects every new insert/update immediately. Historical rows
-- are scanned under the lighter validation lock in the next migration.
alter table public.evidence_items
  add constraint evidence_items_organization_report_version_fkey
  foreign key (organization_id, report_version_id)
  references public.report_versions (organization_id, id)
  on delete cascade
  not valid;

alter table public.check_runs
  add constraint check_runs_organization_report_version_fkey
  foreign key (organization_id, report_version_id)
  references public.report_versions (organization_id, id)
  on delete cascade
  not valid;

alter table public.case_events
  add constraint case_events_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.cases (organization_id, id)
  on delete cascade
  not valid;

alter table public.case_events
  add constraint case_events_organization_case_report_version_fkey
  foreign key (organization_id, case_id, report_version_id)
  references public.report_versions (organization_id, case_id, id)
  on delete set null (report_version_id)
  not valid;

alter table public.share_links
  add constraint share_links_organization_report_version_fkey
  foreign key (organization_id, report_version_id)
  references public.report_versions (organization_id, id)
  on delete cascade
  not valid;

alter table public.report_cost_lines
  add constraint report_cost_lines_organization_report_version_fkey
  foreign key (organization_id, report_version_id)
  references public.report_versions (organization_id, id)
  on delete cascade
  not valid;

alter table public.reports
  add constraint reports_organization_report_version_fkey
  foreign key (organization_id, report_version_id)
  references public.report_versions (organization_id, id)
  on delete set null (report_version_id)
  not valid;

alter table public.usage_events
  add constraint usage_events_organization_user_fkey
  foreign key (organization_id, user_id)
  references public.argus_members (organization_id, user_id)
  on delete set null (user_id)
  not valid;

commit;
