-- Executable database contract for bounded gap-investigation proposals.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(1);

insert into public.organizations (id, slug, name)
values ('00000000-0000-4000-8000-000000000105', 'gap-proposal-test', 'Gap Proposal Test');
insert into auth.users (id, email)
values ('00000000-0000-4000-8000-000000000106', 'gap-proposal@argus.test');
insert into public.argus_members (user_id, organization_id, role, display_name)
values (
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000105',
  'analyst',
  'Gap Proposal Analyst'
);

create temporary table gap_proposal_ids (
  source_id uuid,
  authorization_id uuid,
  proposal_id uuid
);

insert into gap_proposal_ids (source_id)
select persisted.report_version_id
from public.persist_report_version(
  '00000000-0000-4000-8000-000000000105',
  'person',
  'alice_gap',
  '@alice_gap',
  '00000000-0000-4000-8000-000000000106',
  '{
    "handle":"@alice_gap",
    "researchPlan":{
      "schemaVersion":1,
      "tasks":[{
        "id":"portfolio",
        "capability":"portfolio_and_outcomes",
        "state":"unavailable",
        "blockedBy":[],
        "delegates":["portfolio-web"]
      }]
    },
    "intelligence":{
      "questions":[{
        "id":"gap.track-record",
        "prompt":"What is the verified track record?",
        "state":"unresolved"
      }]
    },
    "report":{
      "roles":["FOUNDER"],
      "role_reports":[{"role":"FOUNDER","axes":{"F1_identity_verifiability":{"score":10}}}],
      "composite_verdict":"INCOMPLETE",
      "governing_score":null
    }
  }'::jsonb,
  'gap-proposal-source',
  'analyst_submitted',
  'INCOMPLETE',
  null,
  'partial',
  null,
  '{}'::jsonb,
  '{}'::jsonb
) persisted;

select public.activate_report_version(
  '00000000-0000-4000-8000-000000000105',
  (select source_id from gap_proposal_ids)
);

update gap_proposal_ids
set authorization_id = public.authorize_gap_investigation(
  '00000000-0000-4000-8000-000000000105',
  source_id,
  'gap.track-record',
  'What is the verified track record?',
  array['portfolio'],
  array['portfolio'],
  array['portfolio_and_outcomes'],
  array['portfolio-web'],
  '00000000-0000-4000-8000-000000000106',
  now() + interval '10 minutes',
  300,
  3.00
);

select public.start_gap_investigation(
  '00000000-0000-4000-8000-000000000105',
  (select authorization_id from gap_proposal_ids),
  '00000000-0000-4000-8000-000000000106'
);

do $persist_gap_proposal$
declare
  v_source uuid;
  v_authorization uuid;
  v_proposal uuid;
begin
  select source_id, authorization_id into v_source, v_authorization from gap_proposal_ids;
  select persisted.report_version_id into v_proposal
  from public.persist_gap_investigation_proposal_bundle(
    v_authorization,
    '00000000-0000-4000-8000-000000000105',
    'person',
    'alice_gap',
    '@alice_gap',
    '00000000-0000-4000-8000-000000000106',
    pg_catalog.jsonb_build_object(
      'handle', '@alice_gap',
      'gapInvestigation', pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'publicationState', 'proposed',
        'authorizationId', v_authorization,
        'sourceReportVersionId', v_source,
        'gapId', 'gap.track-record'
      ),
      'report', pg_catalog.jsonb_build_object(
        'roles', pg_catalog.jsonb_build_array('FOUNDER'),
        'role_reports', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'role', 'FOUNDER',
            'axes', pg_catalog.jsonb_build_object(
              'F1_identity_verifiability', pg_catalog.jsonb_build_object('score', 11)
            )
          )
        ),
        'composite_verdict', 'INCOMPLETE',
        'governing_score', null
      )
    ),
    'gap-proposal-candidate',
    'analyst_submitted',
    'INCOMPLETE',
    null,
    'partial',
    null,
    '{}'::jsonb,
    '{"schemaVersion":1,"usd":1.2,"calls":[]}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[{"phase":"completion","state":"partial"}]'::jsonb
  ) persisted;
  update gap_proposal_ids set proposal_id = v_proposal;
end;
$persist_gap_proposal$;

do $gap_proposal_contract$
declare
  v_source uuid;
  v_authorization uuid;
  v_proposal uuid;
  v_active uuid;
  v_status text;
  v_direct_activation_blocked boolean := false;
begin
  select source_id, authorization_id, proposal_id
  into v_source, v_authorization, v_proposal
  from gap_proposal_ids;
  select report_version_id into v_active
  from public.reports
  where organization_id = '00000000-0000-4000-8000-000000000105'
    and kind = 'person' and ref = 'alice_gap';
  if v_active is distinct from v_source then
    raise exception 'proposal changed or removed the active source projection';
  end if;
  select status into v_status from public.gap_investigations where id = v_authorization;
  if v_status <> 'partial' then raise exception 'partial proposal status was not recorded'; end if;
  if not exists (
    select 1 from public.gap_investigations
    where id = v_authorization
      and proposed_report_version_id = v_proposal
      and observed_cost #>> '{usd}' = '1.2'
      and pg_catalog.jsonb_array_length(execution_receipts) = 1
  ) then raise exception 'proposal receipts or cost were not bound'; end if;

  begin
    perform public.activate_report_version(
      '00000000-0000-4000-8000-000000000105', v_proposal
    );
  exception when others then
    v_direct_activation_blocked := position('explicit analyst promotion' in sqlerrm) > 0;
  end;
  if not v_direct_activation_blocked then
    raise exception 'normal activation did not reject the proposal';
  end if;

  perform public.promote_gap_investigation_proposal(
    '00000000-0000-4000-8000-000000000105',
    v_authorization,
    '00000000-0000-4000-8000-000000000106'
  );
  select report_version_id into v_active
  from public.reports
  where organization_id = '00000000-0000-4000-8000-000000000105'
    and kind = 'person' and ref = 'alice_gap';
  select status into v_status from public.gap_investigations where id = v_authorization;
  if v_active is distinct from v_proposal or v_status <> 'promoted' then
    raise exception 'explicit promotion did not activate the proposal';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.activate_report_version_without_gap_proposal_guard(uuid,uuid)',
    'execute'
  ) then raise exception 'unguarded proposal activation is exposed'; end if;
end;
$gap_proposal_contract$;

select pass('gap investigations preserve the active source and require explicit guarded promotion');
select * from finish();
rollback;
