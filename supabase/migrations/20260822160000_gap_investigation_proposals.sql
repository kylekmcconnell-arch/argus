-- Bounded evidence-gap investigations. A proposed report version is immutable
-- and queryable by exact id, but it cannot replace the current report until an
-- active analyst explicitly promotes it through the guarded RPC below.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.gap_investigations (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations(id) on delete restrict,
  case_id                     uuid not null references public.cases(id) on delete cascade,
  source_report_version_id    uuid not null references public.report_versions(id) on delete restrict,
  proposed_report_version_id  uuid references public.report_versions(id) on delete restrict,
  gap_id                      text not null check (char_length(gap_id) between 1 and 180),
  gap_prompt                  text not null check (char_length(gap_prompt) between 1 and 800),
  requested_task_ids          text[] not null check (cardinality(requested_task_ids) between 1 and 8),
  task_ids                    text[] not null check (cardinality(task_ids) between 1 and 16),
  capabilities                text[] not null check (cardinality(capabilities) between 1 and 16),
  delegates                   text[] not null check (cardinality(delegates) between 1 and 40),
  actor_user_id               uuid not null references auth.users(id) on delete restrict,
  expires_at                  timestamptz not null,
  time_budget_seconds         integer not null check (time_budget_seconds between 180 and 540),
  estimated_cost_ceiling_usd  numeric(10, 4) not null check (estimated_cost_ceiling_usd >= 0 and estimated_cost_ceiling_usd <= 50),
  observed_cost               jsonb not null default '{}'::jsonb,
  execution_receipts          jsonb not null default '[]'::jsonb,
  status                      text not null default 'authorized'
                              check (status in (
                                'authorized', 'running', 'proposed', 'partial', 'failed',
                                'expired', 'promotion_authorized', 'promoted', 'rolled_back'
                              )),
  failure_code                text,
  created_at                  timestamptz not null default now(),
  started_at                  timestamptz,
  completed_at                timestamptz,
  promoted_at                 timestamptz,
  rolled_back_at              timestamptz,
  unique (proposed_report_version_id),
  check (expires_at > created_at),
  check (pg_catalog.jsonb_typeof(observed_cost) = 'object'),
  check (pg_catalog.jsonb_typeof(execution_receipts) = 'array')
);

create index if not exists gap_investigations_org_created_idx
  on public.gap_investigations (organization_id, created_at desc);
create index if not exists gap_investigations_source_idx
  on public.gap_investigations (source_report_version_id, status);

alter table public.gap_investigations enable row level security;

drop policy if exists gap_investigations_read_member_org on public.gap_investigations;
create policy gap_investigations_read_member_org on public.gap_investigations
  for select to authenticated
  using (organization_id in (
    select member.organization_id
    from public.argus_members member
    where member.user_id = (select auth.uid()) and member.active
  ));

create or replace function public.authorize_gap_investigation(
  p_organization_id uuid,
  p_source_report_version_id uuid,
  p_gap_id text,
  p_gap_prompt text,
  p_requested_task_ids text[],
  p_task_ids text[],
  p_capabilities text[],
  p_delegates text[],
  p_actor_user_id uuid,
  p_expires_at timestamptz,
  p_time_budget_seconds integer,
  p_estimated_cost_ceiling_usd numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_case_id uuid;
  v_payload jsonb;
  v_id uuid;
  v_questions jsonb;
  v_plan jsonb;
begin
  select version.case_id, version.payload
  into v_case_id, v_payload
  from public.report_versions version
  join public.reports active
    on active.organization_id = version.organization_id
   and active.report_version_id = version.id
  join public.cases case_row
    on case_row.id = version.case_id
   and case_row.organization_id = version.organization_id
   and case_row.status = 'open'
  where version.id = p_source_report_version_id
    and version.organization_id = p_organization_id
  limit 1;

  if v_case_id is null then
    raise exception 'gap investigation source must be the active immutable report version';
  end if;
  if not exists (
    select 1 from public.argus_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
      and member.active
      and member.role in ('analyst', 'owner')
  ) then
    raise exception 'active analyst membership required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 minutes' then
    raise exception 'authorization expiry must be within 30 minutes';
  end if;
  if p_time_budget_seconds not between 180 and 540 then
    raise exception 'invalid gap investigation time budget';
  end if;
  if p_estimated_cost_ceiling_usd < 0 or p_estimated_cost_ceiling_usd > 50 then
    raise exception 'invalid gap investigation cost ceiling';
  end if;

  v_questions := coalesce(
    v_payload #> '{intelligence,questions}',
    v_payload #> '{projectAccount,intelligence,questions}',
    v_payload #> '{token,intelligence,questions}',
    '[]'::jsonb
  );
  if pg_catalog.jsonb_typeof(v_questions) <> 'array' or not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_questions) question(value)
    where question.value ->> 'id' = p_gap_id
      and question.value ->> 'state' in ('reported', 'partial', 'unresolved', 'unavailable', 'not_collected')
      and question.value ->> 'prompt' = p_gap_prompt
  ) then
    raise exception 'requested gap is not open in the active source report';
  end if;

  v_plan := coalesce(v_payload -> 'researchPlan', v_payload #> '{projectAccount,researchPlan}', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(v_plan -> 'tasks') <> 'array'
     or exists (
       select 1 from pg_catalog.unnest(p_task_ids) selected(task_id)
       where not exists (
         select 1 from pg_catalog.jsonb_array_elements(v_plan -> 'tasks') task(value)
         where task.value ->> 'id' = selected.task_id
           and task.value ->> 'state' <> 'skipped'
       )
     ) then
    raise exception 'one or more authorized tasks are absent from the frozen research plan';
  end if;

  insert into public.gap_investigations (
    organization_id, case_id, source_report_version_id, gap_id, gap_prompt,
    requested_task_ids, task_ids, capabilities, delegates, actor_user_id,
    expires_at, time_budget_seconds, estimated_cost_ceiling_usd
  ) values (
    p_organization_id, v_case_id, p_source_report_version_id,
    pg_catalog.btrim(p_gap_id), pg_catalog.btrim(p_gap_prompt),
    p_requested_task_ids, p_task_ids, p_capabilities, p_delegates,
    p_actor_user_id, p_expires_at, p_time_budget_seconds,
    p_estimated_cost_ceiling_usd
  ) returning id into v_id;

  insert into public.case_events (
    organization_id, case_id, report_version_id, actor_user_id, event_type, metadata
  ) values (
    p_organization_id, v_case_id, p_source_report_version_id, p_actor_user_id,
    'report.gap_investigation.authorized',
    pg_catalog.jsonb_build_object(
      'authorizationId', v_id,
      'gapId', p_gap_id,
      'taskIds', p_task_ids,
      'expiresAt', p_expires_at,
      'timeBudgetSeconds', p_time_budget_seconds,
      'estimatedCostCeilingUsd', p_estimated_cost_ceiling_usd
    )
  );
  return v_id;
end;
$$;

create or replace function public.start_gap_investigation(
  p_organization_id uuid,
  p_authorization_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.gap_investigations investigation
  set status = case when investigation.expires_at > now() then 'running' else 'expired' end,
      started_at = case when investigation.expires_at > now() then now() else investigation.started_at end
  where investigation.id = p_authorization_id
    and investigation.organization_id = p_organization_id
    and investigation.actor_user_id = p_actor_user_id
    and investigation.status = 'authorized';
  if not found then raise exception 'gap investigation authorization is unavailable'; end if;
  if exists (
    select 1 from public.gap_investigations investigation
    where investigation.id = p_authorization_id and investigation.status = 'expired'
  ) then raise exception 'gap investigation authorization expired'; end if;
end;
$$;

create or replace function public.persist_gap_investigation_proposal_bundle(
  p_authorization_id uuid,
  p_organization_id uuid,
  p_kind text,
  p_canonical_ref text,
  p_query text,
  p_created_by uuid,
  p_payload jsonb,
  p_run_id text,
  p_attestation_state text,
  p_verdict text,
  p_score numeric,
  p_completeness_state text,
  p_methodology_version text,
  p_provider_snapshot jsonb,
  p_cost jsonb,
  p_evidence_items jsonb,
  p_check_runs jsonb,
  p_axis_evidence jsonb,
  p_execution_receipts jsonb
)
returns table (
  case_id uuid,
  report_version_id uuid,
  version integer,
  evidence_count integer,
  check_count integer,
  axis_evidence_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_authorization public.gap_investigations%rowtype;
  v_source public.report_versions%rowtype;
  v_case public.cases%rowtype;
  v_result record;
begin
  select * into v_authorization
  from public.gap_investigations investigation
  where investigation.id = p_authorization_id
    and investigation.organization_id = p_organization_id
    and investigation.actor_user_id = p_created_by
  for update;
  if v_authorization.id is null or v_authorization.status <> 'running' then
    raise exception 'gap investigation is not running';
  end if;
  if v_authorization.expires_at <= now() then
    update public.gap_investigations set status = 'expired', failure_code = 'authorization_expired'
    where id = p_authorization_id;
    raise exception 'gap investigation authorization expired';
  end if;
  if pg_catalog.jsonb_typeof(p_execution_receipts) <> 'array'
     or pg_catalog.jsonb_array_length(p_execution_receipts) > 200 then
    raise exception 'invalid gap investigation execution receipts';
  end if;
  if p_payload #>> '{gapInvestigation,publicationState}' <> 'proposed'
     or p_payload #>> '{gapInvestigation,authorizationId}' <> p_authorization_id::text
     or p_payload #>> '{gapInvestigation,sourceReportVersionId}' <> v_authorization.source_report_version_id::text
     or p_payload #>> '{gapInvestigation,gapId}' <> v_authorization.gap_id then
    raise exception 'proposed report payload is not bound to its authorization';
  end if;

  select * into v_source from public.report_versions
  where id = v_authorization.source_report_version_id
    and organization_id = p_organization_id;
  select * into v_case from public.cases
  where id = v_authorization.case_id and organization_id = p_organization_id;
  if v_source.id is null or v_case.id is null
     or v_case.kind <> p_kind or v_case.canonical_ref <> p_canonical_ref
     or not exists (
       select 1 from public.reports active
       where active.organization_id = p_organization_id
         and active.report_version_id = v_source.id
     ) then
    raise exception 'active source report changed before proposal persistence';
  end if;

  select * into v_result
  from public.persist_report_version_bundle(
    p_organization_id, p_kind, p_canonical_ref, p_query, p_created_by,
    p_payload, p_run_id, p_attestation_state, p_verdict, p_score,
    p_completeness_state, p_methodology_version, p_provider_snapshot, p_cost,
    p_evidence_items, p_check_runs, p_axis_evidence
  );
  if v_result.case_id <> v_case.id then
    raise exception 'proposal was persisted to a different case';
  end if;

  -- persist_report_version_bundle deliberately clears the active projection.
  -- Restore the exact source inside this same transaction so a proposal never
  -- becomes current and never makes the current report disappear.
  insert into public.reports (
    organization_id, ref, kind, query, contributor, created_by,
    report_version_id, attestation_state, payload, verdict, score, ts
  ) values (
    p_organization_id, v_case.canonical_ref, v_case.kind, v_case.display_query,
    v_source.contributor_label, v_source.created_by, v_source.id,
    v_source.attestation_state, v_source.payload, v_source.verdict,
    v_source.score, v_source.created_at
  )
  on conflict (organization_id, ref, kind) do update set
    query = excluded.query,
    contributor = excluded.contributor,
    created_by = excluded.created_by,
    report_version_id = excluded.report_version_id,
    attestation_state = excluded.attestation_state,
    payload = excluded.payload,
    verdict = excluded.verdict,
    score = excluded.score,
    ts = excluded.ts;

  update public.gap_investigations
  set proposed_report_version_id = v_result.report_version_id,
      observed_cost = coalesce(p_cost, '{}'::jsonb),
      execution_receipts = p_execution_receipts,
      status = case when p_completeness_state = 'complete' then 'proposed' else 'partial' end,
      completed_at = now()
  where id = p_authorization_id;

  insert into public.case_events (
    organization_id, case_id, report_version_id, actor_user_id, event_type, metadata
  ) values (
    p_organization_id, v_case.id, v_result.report_version_id, p_created_by,
    'report.version.proposed',
    pg_catalog.jsonb_build_object(
      'authorizationId', p_authorization_id,
      'sourceReportVersionId', v_source.id,
      'gapId', v_authorization.gap_id,
      'completeness', p_completeness_state,
      'cost', coalesce(p_cost, '{}'::jsonb)
    )
  );

  return query select
    v_result.case_id, v_result.report_version_id, v_result.version,
    v_result.evidence_count, v_result.check_count, v_result.axis_evidence_count;
end;
$$;

-- Put the proposal check in front of every existing activation path. The
-- underlying quality and graph guards remain unchanged and still run during
-- an explicit promotion.
alter function public.activate_report_version(uuid, uuid)
  rename to activate_report_version_without_gap_proposal_guard;

create or replace function public.activate_report_version(
  p_organization_id uuid,
  p_report_version_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.report_versions version
    where version.id = p_report_version_id
      and version.organization_id = p_organization_id
      and version.payload #>> '{gapInvestigation,publicationState}' = 'proposed'
      and not exists (
        select 1 from public.gap_investigations investigation
        where investigation.proposed_report_version_id = version.id
          and investigation.organization_id = p_organization_id
          and investigation.status in ('promotion_authorized', 'promoted')
      )
  ) then
    raise exception 'proposed gap investigation requires explicit analyst promotion';
  end if;
  perform public.activate_report_version_without_gap_proposal_guard(
    p_organization_id, p_report_version_id
  );
end;
$$;

create or replace function public.promote_gap_investigation_proposal(
  p_organization_id uuid,
  p_authorization_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_investigation public.gap_investigations%rowtype;
  v_kind text;
  v_attestation text;
  v_completeness text;
begin
  select * into v_investigation
  from public.gap_investigations investigation
  where investigation.id = p_authorization_id
    and investigation.organization_id = p_organization_id
  for update;
  if v_investigation.id is null or v_investigation.status not in ('proposed', 'partial') then
    raise exception 'gap investigation proposal is not available for promotion';
  end if;
  if not exists (
    select 1 from public.argus_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_user_id
      and member.active
      and member.role in ('analyst', 'owner')
  ) then raise exception 'active analyst membership required'; end if;

  update public.gap_investigations
  set status = 'promotion_authorized'
  where id = p_authorization_id;
  select case_row.kind, version.attestation_state, version.completeness_state
  into v_kind, v_attestation, v_completeness
  from public.report_versions version
  join public.cases case_row on case_row.id = version.case_id
  where version.id = v_investigation.proposed_report_version_id
    and version.organization_id = p_organization_id;
  if v_kind = 'person' and v_attestation = 'server_collected' and v_completeness = 'complete' then
    perform public.activate_report_version_with_graph(
      p_organization_id,
      v_investigation.proposed_report_version_id,
      p_actor_user_id
    );
  else
    perform public.activate_report_version(p_organization_id, v_investigation.proposed_report_version_id);
  end if;
  if not exists (
    select 1 from public.reports active
    where active.organization_id = p_organization_id
      and active.report_version_id = v_investigation.proposed_report_version_id
  ) then raise exception 'proposal did not pass the guarded activation path'; end if;
  update public.gap_investigations
  set status = 'promoted', promoted_at = now()
  where id = p_authorization_id;
  return v_investigation.proposed_report_version_id;
end;
$$;

create or replace function public.rollback_gap_investigation_proposal(
  p_organization_id uuid,
  p_authorization_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.gap_investigations investigation
  set status = 'rolled_back', rolled_back_at = now()
  where investigation.id = p_authorization_id
    and investigation.organization_id = p_organization_id
    and investigation.status in ('authorized', 'running', 'proposed', 'partial', 'failed')
    and exists (
      select 1 from public.argus_members member
      where member.organization_id = p_organization_id
        and member.user_id = p_actor_user_id
        and member.active
        and member.role in ('analyst', 'owner')
    );
  if not found then raise exception 'gap investigation cannot be rolled back'; end if;
end;
$$;

revoke all on table public.gap_investigations from public, anon, authenticated;
grant select on table public.gap_investigations to authenticated;
grant all on table public.gap_investigations to service_role;

revoke all on function public.authorize_gap_investigation(uuid, uuid, text, text, text[], text[], text[], text[], uuid, timestamptz, integer, numeric) from public, anon, authenticated;
revoke all on function public.start_gap_investigation(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.persist_gap_investigation_proposal_bundle(uuid, uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.activate_report_version_without_gap_proposal_guard(uuid, uuid) from public, anon, authenticated;
revoke all on function public.activate_report_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.promote_gap_investigation_proposal(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rollback_gap_investigation_proposal(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.authorize_gap_investigation(uuid, uuid, text, text, text[], text[], text[], text[], uuid, timestamptz, integer, numeric) to service_role;
grant execute on function public.start_gap_investigation(uuid, uuid, uuid) to service_role;
grant execute on function public.persist_gap_investigation_proposal_bundle(uuid, uuid, text, text, text, uuid, jsonb, text, text, text, numeric, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.activate_report_version_without_gap_proposal_guard(uuid, uuid) to service_role;
grant execute on function public.activate_report_version(uuid, uuid) to service_role;
grant execute on function public.promote_gap_investigation_proposal(uuid, uuid, uuid) to service_role;
grant execute on function public.rollback_gap_investigation_proposal(uuid, uuid, uuid) to service_role;

commit;
