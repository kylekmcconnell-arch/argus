-- A role report may omit a canonical axis ONLY when the same immutable payload
-- declares the omission itself: score_coverage.missingAxes records axes the
-- analyst could not measure (partial scoring publishes PROVISIONAL, not
-- INCOMPLETE), and axis_applicability records an axis the methodology set aside
-- before scoring (a project with no applicable token omits P3_token_conduct).
-- An undeclared gap still fails closed. Before this rule, every honestly
-- partial PROJECT report (e.g. a tokenless protocol) failed persistence
-- deterministically ("PROJECT axis set is incomplete or non-canonical"), which
-- also kept those scans out of the case library. Mirrors api/_provenance.ts.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.enforce_axis_scoring_contract()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version public.report_versions%rowtype;
  v_catalog jsonb;
  v_role_reports jsonb;
  v_is_incomplete boolean;
  v_decision_bearing boolean;
  v_axis_manifest constant jsonb := '{
    "FOUNDER": {
      "F1_identity_verifiability": 12,
      "F2_track_record": 28,
      "F3_repeat_backing": 15,
      "F4_build_substance": 15,
      "F5_reputation_integrity": 18,
      "F6_network_quality": 12
    },
    "PROJECT": {
      "P1_team_and_identity": 16,
      "P2_product_substance": 24,
      "P3_token_conduct": 20,
      "P4_backing_and_partners": 14,
      "P5_traction_and_liveness": 14,
      "P6_transparency_integrity": 12
    },
    "KOL": {
      "K1_identity_roster": 12,
      "K2_call_performance": 30,
      "K3_disclosure_deletion": 18,
      "K4_onchain_conduct": 20,
      "K5_cabal_fud": 20
    },
    "INVESTOR": {
      "I1_identity_legitimacy": 15,
      "I2_portfolio_quality": 25,
      "I3_fund_scale_tier": 15,
      "I4_testimonial_corroboration": 20,
      "I5_reputation_fud": 25
    },
    "AGENCY": {
      "AG1_identity_legitimacy": 15,
      "AG2_client_outcomes": 25,
      "AG3_service_integrity": 25,
      "AG4_reputation_fud": 35
    },
    "ADVISOR": {
      "AD1_identity_verifiability": 12,
      "AD2_advised_outcomes": 28,
      "AD3_relationship_corroboration": 25,
      "AD4_advisory_conduct": 20,
      "AD5_reputation_fud": 15
    },
    "MEMBER": {
      "ME1_identity": 25,
      "ME2_role_authenticity": 35,
      "ME3_conduct_reputation": 40
    }
  }'::jsonb;
begin
  if new.report_version_id is null then
    return new;
  end if;

  select version_row.*
  into v_version
  from public.report_versions version_row
  where version_row.id = new.report_version_id
    and version_row.organization_id = new.organization_id
  limit 1;

  if v_version.id is null then
    return new;
  end if;

  v_decision_bearing := coalesce(v_version.verdict, '') not in ('', 'INCOMPLETE')
    or v_version.score is not null
    or coalesce(v_version.payload #>> '{report,composite_verdict}', '') not in ('', 'INCOMPLETE')
    or pg_catalog.jsonb_typeof(v_version.payload #> '{report,governing_score}') = 'number'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(v_version.payload #> '{report,role_reports}') = 'array'
          then v_version.payload #> '{report,role_reports}' else '[]'::jsonb end
      ) role_report(item)
      cross join lateral pg_catalog.jsonb_each(
        case when pg_catalog.jsonb_typeof(role_report.item -> 'axes') = 'object'
          then role_report.item -> 'axes' else '{}'::jsonb end
      ) axis(axis_id, item)
    );

  -- Keep historical and analyst-submitted compatibility, but never let a new
  -- server-collected person score bypass strict lineage by dropping the marker.
  if not (v_version.payload ? 'axisCitationVersion') then
    if new.kind = 'person'
       and v_version.attestation_state = 'server_collected'
       and v_version.created_at >= '2026-07-12T01:00:00Z'::timestamptz
       and v_decision_bearing then
      raise exception 'new server-collected scored person report requires strict axis lineage';
    end if;
    return new;
  end if;
  if pg_catalog.jsonb_typeof(v_version.payload -> 'axisCitationVersion') <> 'number'
     or v_version.payload ->> 'axisCitationVersion' <> '1' then
    raise exception 'unsupported axis citation version';
  end if;

  v_catalog := v_version.payload -> 'axisEvidenceCatalog';
  v_role_reports := v_version.payload #> '{report,role_reports}';
  v_is_incomplete := coalesce(
    v_version.payload #>> '{report,composite_verdict}' = 'INCOMPLETE'
      and pg_catalog.jsonb_typeof(v_version.payload #> '{report,governing_score}') = 'null',
    false
  );
  if pg_catalog.jsonb_typeof(v_catalog) <> 'array'
     or pg_catalog.jsonb_typeof(v_role_reports) <> 'array' then
    raise exception 'strict report scoring-contract inputs are malformed';
  end if;

  -- The primary lineage trigger sorts before this one and has already validated
  -- JSON shapes, artifact identities, eligibility, and verification values.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    where not (v_axis_manifest ? (role_report.item ->> 'role'))
  ) then
    raise exception 'strict report contains an unsupported scoring role';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(
      case when pg_catalog.jsonb_typeof(role_report.item -> 'axis_applicability') = 'object'
        then role_report.item -> 'axis_applicability' else '{}'::jsonb end
    ) applicability(axis_id, treatment)
    where not (v_axis_manifest -> (role_report.item ->> 'role') ? applicability.axis_id)
       or pg_catalog.jsonb_typeof(applicability.treatment -> 'axisTreatment') <> 'string'
       or pg_catalog.btrim(applicability.treatment ->> 'axisTreatment') = ''
  ) then
    raise exception 'strict report axis applicability is malformed or non-canonical';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_array_elements_text(
      case when pg_catalog.jsonb_typeof(role_report.item #> '{score_coverage,missingAxes}') = 'array'
        then role_report.item #> '{score_coverage,missingAxes}' else '[]'::jsonb end
    ) missing(axis_id)
    where not (v_axis_manifest -> (role_report.item ->> 'role') ? missing.axis_id)
  ) then
    raise exception 'strict report declares a non-canonical axis omission';
  end if;

  if not v_is_incomplete and exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral (
      select coalesce(array(
        select missing.axis_id
        from pg_catalog.jsonb_array_elements_text(
          case when pg_catalog.jsonb_typeof(role_report.item #> '{score_coverage,missingAxes}') = 'array'
            then role_report.item #> '{score_coverage,missingAxes}' else '[]'::jsonb end
        ) missing(axis_id)
      ), '{}'::text[])
      || coalesce(array(
        select applicability.axis_id
        from pg_catalog.jsonb_each(
          case when pg_catalog.jsonb_typeof(role_report.item -> 'axis_applicability') = 'object'
            then role_report.item -> 'axis_applicability' else '{}'::jsonb end
        ) applicability(axis_id, treatment)
        where coalesce(applicability.treatment ->> 'axisTreatment', '') <> 'assess'
      ), '{}'::text[]) as omitted
    ) declared
    where array(
      select axis_id.value
      from pg_catalog.jsonb_object_keys(role_report.item -> 'axes') axis_id(value)
      order by axis_id.value
    ) <> array(
      select axis_id.value
      from pg_catalog.jsonb_object_keys(v_axis_manifest -> (role_report.item ->> 'role')) axis_id(value)
      where not (axis_id.value = any (declared.omitted))
      order by axis_id.value
    )
  ) then
    raise exception 'strict report role axis set is incomplete or non-canonical';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    cross join lateral (
      select (v_axis_manifest -> (role_report.item ->> 'role') ->> axis.axis_id)::numeric as weight
    ) expected
    where axis.item - array[
      'score', 'weight', 'rationale', 'role',
      'evidenceRefs', 'counterEvidenceRefs', 'gaps'
    ]::text[] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(axis.item -> 'weight') <> 'number'
       or (axis.item ->> 'weight')::numeric <> expected.weight
       or pg_catalog.jsonb_typeof(axis.item -> 'role') <> 'string'
       or axis.item ->> 'role' <> role_report.item ->> 'role'
       or pg_catalog.jsonb_typeof(axis.item -> 'rationale') <> 'string'
       or pg_catalog.char_length(pg_catalog.btrim(axis.item ->> 'rationale')) not between 1 and 2000
       or (axis.item ->> 'score')::numeric <> pg_catalog.trunc((axis.item ->> 'score')::numeric)
       or (axis.item ->> 'score')::numeric < 0
       or (axis.item ->> 'score')::numeric > expected.weight
  ) then
    raise exception 'strict report axis violates the canonical scoring contract';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs') support(artifact_id)
      join pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
        on artifact.item ->> 'artifactId' = support.artifact_id
      where artifact.item ->> 'verification' not in ('unavailable', 'checked_empty')
    )
  ) then
    raise exception 'strict report axis lacks substantive support';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_enforce_axis_evidence_scoring_contract on public.reports;
create trigger reports_enforce_axis_evidence_scoring_contract
  before insert or update on public.reports
  for each row execute function public.enforce_axis_scoring_contract();

comment on function public.enforce_axis_scoring_contract() is
  'Fails closed unless every scored role carries its canonical axes minus only the omissions the payload itself declares (score_coverage.missingAxes / non-assess axis_applicability), with weights, integer scores, rationale, and substantive evidence.';

revoke all on function public.enforce_axis_scoring_contract()
  from public, anon, authenticated;

commit;
