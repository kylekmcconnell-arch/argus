-- Keep the immutable SQL publication boundary synchronized with the API's
-- optional counter-evidence eligibility contract. Historical strict reports
-- without counterEligibleAxes remain valid; when present, the field is a
-- non-empty unique verified-only subset of eligibleAxes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create or replace function public.enforce_axis_evidence_lineage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version public.report_versions%rowtype;
  v_catalog jsonb;
  v_role_reports jsonb;
  v_catalog_count integer;
  v_scored_axis_count integer;
  v_link_count integer;
  v_is_incomplete boolean;
  v_captured_at_text text;
  v_captured_at timestamptz;
  v_source_url text;
  v_port_text text;
  v_certification_hash text;
  v_existing public.report_lineage_certifications%rowtype;
begin
  if new.report_version_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('axis-lineage:' || new.report_version_id::text, 0)
  );

  select version_row.*
  into v_version
  from public.report_versions version_row
  where version_row.id = new.report_version_id
    and version_row.organization_id = new.organization_id
  limit 1;

  if v_version.id is null then
    return new;
  end if;
  if not (v_version.payload ? 'axisCitationVersion') then
    return new; -- preserved legacy activation path
  end if;
  if pg_catalog.jsonb_typeof(v_version.payload -> 'axisCitationVersion') <> 'number'
     or v_version.payload ->> 'axisCitationVersion' <> '1' then
    raise exception 'unsupported axis citation version';
  end if;

  v_catalog := v_version.payload -> 'axisEvidenceCatalog';
  v_role_reports := v_version.payload #> '{report,role_reports}';
  v_is_incomplete := coalesce(
    v_version.payload #>> '{report,composite_verdict}' = 'INCOMPLETE'
      and pg_catalog.jsonb_typeof(v_version.payload #> '{report,governing_score}') = 'null'
      and v_version.verdict = 'INCOMPLETE'
      and new.verdict = 'INCOMPLETE'
      and v_version.score is null
      and new.score is null,
    false
  );
  if pg_catalog.jsonb_typeof(v_catalog) <> 'array'
     or pg_catalog.jsonb_array_length(v_catalog) not between 1 and 400 then
    raise exception 'strict report requires a bounded axis evidence catalog';
  end if;
  if pg_catalog.jsonb_typeof(v_role_reports) <> 'array'
     or pg_catalog.jsonb_array_length(v_role_reports) not between 1 and 16 then
    raise exception 'strict report requires bounded role reports';
  end if;
  v_catalog_count := pg_catalog.jsonb_array_length(v_catalog);

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
    where pg_catalog.jsonb_typeof(artifact.item) <> 'object'
       or artifact.item - array[
         'artifactId', 'kind', 'provider', 'operation', 'section', 'title',
         'excerpt', 'sourceUrl', 'capturedAt', 'contentHash', 'eligibleAxes',
         'counterEligibleAxes', 'verification', 'scope'
       ]::text[] <> '{}'::jsonb
       or coalesce(artifact.item ->> 'artifactId', '') !~ '^art_v1_[a-f0-9]{64}$'
       or coalesce(artifact.item ->> 'contentHash', '') !~ '^[a-f0-9]{64}$'
       or artifact.item ->> 'contentHash' <> pg_catalog.right(artifact.item ->> 'artifactId', 64)
       or coalesce(artifact.item ->> 'kind', '') <> 'axis_evidence'
       or pg_catalog.jsonb_typeof(artifact.item -> 'provider') <> 'string'
       or pg_catalog.jsonb_typeof(artifact.item -> 'operation') <> 'string'
       or pg_catalog.jsonb_typeof(artifact.item -> 'section') <> 'string'
       or pg_catalog.jsonb_typeof(artifact.item -> 'title') <> 'string'
       or pg_catalog.char_length(pg_catalog.btrim(coalesce(artifact.item ->> 'provider', ''))) not between 1 and 100
       or pg_catalog.char_length(pg_catalog.btrim(coalesce(artifact.item ->> 'operation', ''))) not between 1 and 160
       or pg_catalog.char_length(pg_catalog.btrim(coalesce(artifact.item ->> 'section', ''))) not between 1 and 100
       or pg_catalog.char_length(pg_catalog.btrim(coalesce(artifact.item ->> 'title', ''))) not between 1 and 500
       or artifact.item ->> 'provider' <> pg_catalog.btrim(artifact.item ->> 'provider')
       or artifact.item ->> 'operation' <> pg_catalog.btrim(artifact.item ->> 'operation')
       or artifact.item ->> 'section' <> pg_catalog.btrim(artifact.item ->> 'section')
       or artifact.item ->> 'title' <> pg_catalog.btrim(artifact.item ->> 'title')
       or coalesce(artifact.item ->> 'verification', '') not in ('verified', 'reported', 'observed', 'checked_empty', 'unavailable')
       or coalesce(artifact.item ->> 'scope', '') not in ('direct_subject', 'subject_context')
       or pg_catalog.jsonb_typeof(artifact.item -> 'eligibleAxes') <> 'array'
       or (
         artifact.item ? 'counterEligibleAxes'
         and pg_catalog.jsonb_typeof(artifact.item -> 'counterEligibleAxes') <> 'array'
       )
  ) then
    raise exception 'axis evidence catalog contains a malformed artifact';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
    where pg_catalog.jsonb_array_length(artifact.item -> 'eligibleAxes') not between 1 and 80
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(artifact.item -> 'eligibleAxes') eligible(item)
         where pg_catalog.jsonb_typeof(eligible.item) <> 'string'
            or eligible.item #>> '{}' !~ '^[A-Za-z0-9_.:-]{1,160}$'
       )
       or (
         select pg_catalog.count(*)
         from pg_catalog.jsonb_array_elements_text(artifact.item -> 'eligibleAxes') eligible(item)
       ) <> (
         select pg_catalog.count(distinct eligible.item)
         from pg_catalog.jsonb_array_elements_text(artifact.item -> 'eligibleAxes') eligible(item)
       )
       or (
         artifact.item ? 'counterEligibleAxes'
         and (
           pg_catalog.jsonb_array_length(artifact.item -> 'counterEligibleAxes') not between 1 and 80
           or exists (
             select 1
             from pg_catalog.jsonb_array_elements(artifact.item -> 'counterEligibleAxes') counter_axis(item)
             where pg_catalog.jsonb_typeof(counter_axis.item) <> 'string'
                or counter_axis.item #>> '{}' !~ '^[A-Za-z0-9_.:-]{1,160}$'
           )
           or (
             select pg_catalog.count(*)
             from pg_catalog.jsonb_array_elements_text(artifact.item -> 'counterEligibleAxes') counter_axis(item)
           ) <> (
             select pg_catalog.count(distinct counter_axis.item)
             from pg_catalog.jsonb_array_elements_text(artifact.item -> 'counterEligibleAxes') counter_axis(item)
           )
           or exists (
             select 1
             from pg_catalog.jsonb_array_elements_text(artifact.item -> 'counterEligibleAxes') counter_axis(item)
             where not (artifact.item -> 'eligibleAxes' ? counter_axis.item)
           )
           or artifact.item ->> 'verification' <> 'verified'
         )
       )
       or (
         artifact.item ? 'excerpt'
         and (
           pg_catalog.jsonb_typeof(artifact.item -> 'excerpt') <> 'string'
           or pg_catalog.char_length(artifact.item ->> 'excerpt') not between 1 and 2000
           or artifact.item ->> 'excerpt' <> pg_catalog.btrim(artifact.item ->> 'excerpt')
         )
       )
       or (
         artifact.item ? 'sourceUrl'
         and (
           pg_catalog.jsonb_typeof(artifact.item -> 'sourceUrl') <> 'string'
           or pg_catalog.char_length(artifact.item ->> 'sourceUrl') not between 1 and 2000
           or artifact.item ->> 'sourceUrl'
             !~ '^https?://(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:[0-9]{1,5})?([/?]|$)'
           or artifact.item ->> 'sourceUrl' ~* '^https?://[^/?#]*@'
           or artifact.item ->> 'sourceUrl' ~ '[[:space:]]'
           or artifact.item ->> 'sourceUrl' ~ '#'
           or pg_catalog.strpos(artifact.item ->> 'sourceUrl', pg_catalog.chr(92)) > 0
           or exists (
             select 1
             from pg_catalog.regexp_split_to_table(
               pg_catalog.split_part(
                 pg_catalog.split_part(artifact.item ->> 'sourceUrl', '?', 2),
                 '#',
                 1
               ),
               '&'
             ) query_parameter(item)
             where pg_catalog.split_part(query_parameter.item, '=', 1) ~ '%'
                or pg_catalog.lower(pg_catalog.split_part(query_parameter.item, '=', 1))
                  ~ '^((x[-_]?(amz|goog)|x[-_](oss|cos))[-_].+|x[-_]ms[-_](signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$'
           )
         )
       )
       or (
         artifact.item ? 'capturedAt'
         and (
           pg_catalog.jsonb_typeof(artifact.item -> 'capturedAt') <> 'string'
           or pg_catalog.char_length(artifact.item ->> 'capturedAt') not between 1 and 80
         )
       )
  ) then
    raise exception 'axis evidence catalog exceeds bounded field limits';
  end if;
  for v_captured_at_text in
    select artifact.item ->> 'capturedAt'
    from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
    where artifact.item ? 'capturedAt'
  loop
    begin
      v_captured_at := v_captured_at_text::timestamptz;
      if not pg_catalog.isfinite(v_captured_at) then
        raise exception 'non-finite timestamp';
      end if;
    exception when others then
      raise exception 'axis evidence catalog contains an invalid capturedAt timestamp';
    end;
  end loop;
  for v_source_url in
    select artifact.item ->> 'sourceUrl'
    from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
    where artifact.item ? 'sourceUrl'
  loop
    v_port_text := coalesce(
      substring(v_source_url from '^https?://\[[0-9a-f:.]+\]:([0-9]{1,5})([/?]|$)'),
      substring(v_source_url from '^https?://[a-z0-9][a-z0-9.-]*:([0-9]{1,5})([/?]|$)')
    );
    if v_port_text is not null and (
      v_port_text <> (v_port_text::integer)::text
      or v_port_text::integer > 65535
      or (v_source_url like 'http://%' and v_port_text::integer = 80)
      or (v_source_url like 'https://%' and v_port_text::integer = 443)
    ) then
      raise exception 'axis evidence catalog contains a non-canonical or invalid sourceUrl port';
    end if;
  end loop;
  if (
    select pg_catalog.count(*)
    from (
      select distinct artifact.item ->> 'artifactId'
      from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
    ) unique_artifacts
  ) <> v_catalog_count then
    raise exception 'axis evidence catalog contains duplicate artifact ids';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    where pg_catalog.jsonb_typeof(role_report.item) <> 'object'
       or coalesce(role_report.item ->> 'role', '') !~ '^[A-Z][A-Z0-9_]{0,79}$'
       or pg_catalog.jsonb_typeof(role_report.item -> 'axes') <> 'object'
  ) then
    raise exception 'strict report contains a malformed role report';
  end if;
  if (
    select pg_catalog.count(*)
    from (
      select distinct role_report.item ->> 'role'
      from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    ) unique_roles
  ) <> pg_catalog.jsonb_array_length(v_role_reports) then
    raise exception 'strict report contains duplicate roles';
  end if;
  if v_is_incomplete then
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
      where (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_each(role_report.item -> 'axes') axis_count
      ) <> 0
    ) then
      raise exception 'incomplete strict report must not contain scored axes';
    end if;
  elsif exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    where (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_each(role_report.item -> 'axes') axis_count
    ) not between 1 and 80
  ) then
    raise exception 'strict report axis count is outside bounded limits';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    where axis.axis_id !~ '^[A-Za-z0-9_.:-]{1,160}$'
       or pg_catalog.jsonb_typeof(axis.item) <> 'object'
       or pg_catalog.jsonb_typeof(axis.item -> 'score') <> 'number'
       or pg_catalog.jsonb_typeof(axis.item -> 'evidenceRefs') <> 'array'
       or pg_catalog.jsonb_typeof(axis.item -> 'counterEvidenceRefs') <> 'array'
       or pg_catalog.jsonb_typeof(axis.item -> 'gaps') <> 'array'
  ) then
    raise exception 'strict report contains a malformed scored axis';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    where pg_catalog.jsonb_array_length(axis.item -> 'evidenceRefs') not between 1 and 12
       or pg_catalog.jsonb_array_length(axis.item -> 'counterEvidenceRefs') not between 0 and 12
       or pg_catalog.jsonb_array_length(axis.item -> 'gaps') not between 0 and 6
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(axis.item -> 'evidenceRefs') ref(item)
         where pg_catalog.jsonb_typeof(ref.item) <> 'string'
            or ref.item #>> '{}' !~ '^art_v1_[a-f0-9]{64}$'
       )
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(axis.item -> 'counterEvidenceRefs') ref(item)
         where pg_catalog.jsonb_typeof(ref.item) <> 'string'
            or ref.item #>> '{}' !~ '^art_v1_[a-f0-9]{64}$'
       )
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(axis.item -> 'gaps') gap(item)
         where pg_catalog.jsonb_typeof(gap.item) <> 'string'
            or pg_catalog.char_length(pg_catalog.btrim(gap.item #>> '{}')) not between 1 and 400
       )
  ) then
    raise exception 'strict report axis references exceed bounded limits';
  end if;

  select pg_catalog.count(*)
  into v_scored_axis_count
  from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
  cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item);
  if (v_is_incomplete and v_scored_axis_count <> 0)
     or (not v_is_incomplete and v_scored_axis_count not between 1 and 1280) then
    raise exception 'strict report scored axis count is outside bounded limits';
  end if;

  -- Each relation is an ordered set; no artifact may simultaneously support
  -- and counter the same axis.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    where (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs') ref
    ) <> (
      select pg_catalog.count(distinct ref)
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs') ref
    )
       or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs') ref
    ) <> (
      select pg_catalog.count(distinct ref)
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs') ref
    )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs') support(artifact_id)
         join pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs') counter(artifact_id)
           using (artifact_id)
       )
  ) then
    raise exception 'strict report axis references are duplicated or contradictory';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    cross join lateral (
      select support.artifact_id
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs') support(artifact_id)
      union all
      select counter.artifact_id
      from pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs') counter(artifact_id)
    ) reference
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
      where artifact.item ->> 'artifactId' = reference.artifact_id
        and artifact.item -> 'eligibleAxes' ? axis.axis_id
    )
  ) then
    raise exception 'strict report references an absent or ineligible artifact';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    cross join lateral pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs') support(artifact_id)
    join lateral (
      select artifact.item
      from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
      where artifact.item ->> 'artifactId' = support.artifact_id
      limit 1
    ) catalog_artifact on true
    where catalog_artifact.item ->> 'verification' in ('unavailable', 'checked_empty')
      and pg_catalog.jsonb_array_length(axis.item -> 'gaps') = 0
  ) then
    raise exception 'absence support requires an explicit axis gap';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    cross join lateral pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs') counter(artifact_id)
    join lateral (
      select artifact.item
      from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
      where artifact.item ->> 'artifactId' = counter.artifact_id
      limit 1
    ) catalog_artifact on true
    where catalog_artifact.item ->> 'verification' in ('unavailable', 'checked_empty')
  ) then
    raise exception 'absence evidence cannot be used as counter-evidence';
  end if;

  -- The normalized evidence set must be exactly the payload catalog. The
  -- catalogArtifact copy is rebuilt canonically (including UTC capturedAt) so
  -- metadata can never retain a raw credential URL or an unparsed timestamp.
  if (
    select pg_catalog.count(*)
    from public.evidence_items evidence
    where evidence.organization_id = new.organization_id
      and evidence.report_version_id = new.report_version_id
  ) <> v_catalog_count
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
       cross join lateral (
         select
           pg_catalog.jsonb_build_object(
             'artifactId', artifact.item ->> 'artifactId',
             'kind', 'axis_evidence',
             'provider', artifact.item ->> 'provider',
             'operation', artifact.item ->> 'operation',
             'section', artifact.item ->> 'section',
             'title', artifact.item ->> 'title',
             'contentHash', artifact.item ->> 'contentHash',
             'eligibleAxes', artifact.item -> 'eligibleAxes',
             'verification', artifact.item ->> 'verification',
             'scope', artifact.item ->> 'scope'
           )
           || case when artifact.item ? 'counterEligibleAxes'
             then pg_catalog.jsonb_build_object(
               'counterEligibleAxes', artifact.item -> 'counterEligibleAxes'
             )
             else '{}'::jsonb
           end
           || case when artifact.item ? 'excerpt'
             then pg_catalog.jsonb_build_object('excerpt', artifact.item ->> 'excerpt')
             else '{}'::jsonb
           end
           || case when artifact.item ? 'sourceUrl'
             then pg_catalog.jsonb_build_object('sourceUrl', artifact.item ->> 'sourceUrl')
             else '{}'::jsonb
           end
           || case when artifact.item ? 'capturedAt'
             then pg_catalog.jsonb_build_object(
               'capturedAt',
               pg_catalog.to_char(
                 (artifact.item ->> 'capturedAt')::timestamptz at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               )
             )
             else '{}'::jsonb
           end as catalog_artifact
       ) normalized
       where not exists (
         select 1
         from public.evidence_items evidence
         where evidence.organization_id = new.organization_id
           and evidence.report_version_id = new.report_version_id
           and evidence.evidence_key = artifact.item ->> 'artifactId'
           and evidence.content_hash = artifact.item ->> 'contentHash'
           and evidence.provider = artifact.item ->> 'provider'
           and evidence.source_type = artifact.item ->> 'section'
           and evidence.title = artifact.item ->> 'title'
           and evidence.excerpt is not distinct from artifact.item ->> 'excerpt'
           and evidence.source_url is not distinct from artifact.item ->> 'sourceUrl'
           and (
             not (artifact.item ? 'capturedAt')
             or evidence.captured_at = (artifact.item ->> 'capturedAt')::timestamptz
           )
           and evidence.published_at is null
           and evidence.confidence is null
           and evidence.attestation_state = v_version.attestation_state
           and evidence.metadata = (
             pg_catalog.jsonb_build_object(
               'strictLineage', true,
               'axisCitationVersion', 1,
               'artifactId', artifact.item ->> 'artifactId',
               'kind', 'axis_evidence',
               'operation', artifact.item ->> 'operation',
               'section', artifact.item ->> 'section',
               'eligibleAxes', artifact.item -> 'eligibleAxes',
               'verification', artifact.item ->> 'verification',
               'scope', artifact.item ->> 'scope'
             )
             || case when artifact.item ? 'counterEligibleAxes'
               then pg_catalog.jsonb_build_object(
                 'counterEligibleAxes', artifact.item -> 'counterEligibleAxes'
               )
               else '{}'::jsonb
             end
             || pg_catalog.jsonb_build_object(
               'catalogArtifact', normalized.catalog_artifact
             )
           )
       )
     )
     or exists (
       select 1
       from public.evidence_items evidence
       where evidence.organization_id = new.organization_id
         and evidence.report_version_id = new.report_version_id
         and not exists (
           select 1
           from pg_catalog.jsonb_array_elements(v_catalog) artifact(item)
           where artifact.item ->> 'artifactId' = evidence.evidence_key
         )
     ) then
    raise exception 'persisted evidence does not exactly match the strict catalog';
  end if;

  with expected_links as (
    select
      role_report.item ->> 'role' as role,
      axis.axis_id,
      support.artifact_id,
      'support'::text as relation,
      (support.ordinality - 1)::integer as ordinal
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    cross join lateral pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs')
      with ordinality support(artifact_id, ordinality)
    union all
    select
      role_report.item ->> 'role',
      axis.axis_id,
      counter.artifact_id,
      'counter'::text,
      (counter.ordinality - 1)::integer
    from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
    cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
    cross join lateral pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs')
      with ordinality counter(artifact_id, ordinality)
  )
  select pg_catalog.count(*) into v_link_count from expected_links;

  if (v_is_incomplete and v_link_count <> 0)
     or (not v_is_incomplete and (v_link_count < v_scored_axis_count or v_link_count > 1024)) then
    raise exception 'strict report link count is outside bounded limits';
  end if;

  if (
    select pg_catalog.count(*)
    from public.report_axis_evidence link
    where link.organization_id = new.organization_id
      and link.report_version_id = new.report_version_id
  ) <> v_link_count then
    raise exception 'persisted axis link count does not match the strict report';
  end if;

  if exists (
    with expected_links as (
      select role_report.item ->> 'role' as role, axis.axis_id,
             support.artifact_id, 'support'::text as relation,
             (support.ordinality - 1)::integer as ordinal
      from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
      cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
      cross join lateral pg_catalog.jsonb_array_elements_text(axis.item -> 'evidenceRefs')
        with ordinality support(artifact_id, ordinality)
      union all
      select role_report.item ->> 'role', axis.axis_id,
             counter.artifact_id, 'counter'::text,
             (counter.ordinality - 1)::integer
      from pg_catalog.jsonb_array_elements(v_role_reports) role_report(item)
      cross join lateral pg_catalog.jsonb_each(role_report.item -> 'axes') axis(axis_id, item)
      cross join lateral pg_catalog.jsonb_array_elements_text(axis.item -> 'counterEvidenceRefs')
        with ordinality counter(artifact_id, ordinality)
    )
    select 1
    from expected_links expected
    full join public.report_axis_evidence actual
      on actual.organization_id = new.organization_id
     and actual.report_version_id = new.report_version_id
     and actual.role = expected.role
     and actual.axis_id = expected.axis_id
     and actual.artifact_id = expected.artifact_id
     and actual.relation = expected.relation
     and actual.ordinal = expected.ordinal
    where (expected.role is null or actual.report_version_id is null)
      and (actual.report_version_id is null or actual.report_version_id = new.report_version_id)
  ) then
    raise exception 'persisted axis links do not exactly match the strict report';
  end if;

  if new.kind = 'person'
     and v_version.attestation_state = 'server_collected'
     and v_version.completeness_state = 'complete'
     and (
       (
         select pg_catalog.count(*)
         from public.graph_contributions graph
         where graph.organization_id = new.organization_id
           and graph.report_version_id = new.report_version_id
           and graph.provenance_state = 'server_collected'
       ) <> 1
       or not exists (
         select 1
         from public.graph_contributions graph
         where graph.organization_id = new.organization_id
           and graph.report_version_id = new.report_version_id
           and graph.provenance_state = 'server_collected'
           and graph.canonical_key = new.ref
           and graph.handle = pg_catalog.btrim(v_version.payload ->> 'handle')
           and graph.aliases = pg_catalog.jsonb_build_array(
             pg_catalog.ltrim(pg_catalog.btrim(v_version.payload ->> 'handle'), '@')
           )
           and graph.verdict is not distinct from v_version.verdict
           and graph.nodes = v_version.payload #> '{graph,nodes}'
           and graph.edges = v_version.payload #> '{graph,edges}'
           and graph.contributor = pg_catalog.left(coalesce(v_version.contributor_label, 'anonymous'), 80)
           and graph.contributor_user_id is not distinct from v_version.created_by
       )
     ) then
    raise exception 'complete strict person report requires its exact authoritative graph';
  end if;

  with catalog_artifacts as (
    select
      evidence.evidence_key as artifact_id,
      evidence.metadata -> 'catalogArtifact' as catalog_artifact
    from public.evidence_items evidence
    where evidence.organization_id = new.organization_id
      and evidence.report_version_id = new.report_version_id
  ), ordered_links as (
    select link.role, link.axis_id, link.relation, link.ordinal, link.artifact_id
    from public.report_axis_evidence link
    where link.organization_id = new.organization_id
      and link.report_version_id = new.report_version_id
  ), graph_material as (
    select
      graph.canonical_key,
      pg_catalog.to_jsonb(graph) - array['id', 'created_at', 'updated_at']::text[] as material
    from public.graph_contributions graph
    where graph.organization_id = new.organization_id
      and graph.report_version_id = new.report_version_id
      and graph.provenance_state = 'server_collected'
  )
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.to_jsonb(v_version)::text
        || E'\n--active-projection--\n'
        || pg_catalog.jsonb_build_object(
          'organizationId', new.organization_id,
          'reportVersionId', new.report_version_id,
          'ref', new.ref,
          'kind', new.kind,
          'query', new.query,
          'contributor', new.contributor,
          'createdBy', new.created_by,
          'attestationState', new.attestation_state,
          'payload', new.payload,
          'verdict', new.verdict,
          'score', new.score,
          'timestamp', new.ts
        )::text
        || E'\n--normalized-catalog--\n'
        || coalesce((
          select pg_catalog.string_agg(catalog_artifact::text, E'\n' order by artifact_id)
          from catalog_artifacts
        ), '')
        || E'\n--axis-links--\n'
        || coalesce((
          select pg_catalog.string_agg(
            role || E'\t' || axis_id || E'\t' || relation || E'\t' || ordinal::text || E'\t' || artifact_id,
            E'\n' order by role, axis_id, relation, ordinal
          )
          from ordered_links
        ), '')
        || E'\n--authoritative-graph--\n'
        || coalesce((
          select pg_catalog.string_agg(material::text, E'\n' order by canonical_key)
          from graph_material
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) into v_certification_hash;

  insert into public.report_lineage_certifications (
    report_version_id, organization_id, axis_citation_version,
    catalog_count, scored_axis_count, link_count, certification_hash
  ) values (
    new.report_version_id, new.organization_id, 1,
    v_catalog_count, v_scored_axis_count, v_link_count, v_certification_hash
  ) on conflict (report_version_id) do nothing;

  select certification.*
  into v_existing
  from public.report_lineage_certifications certification
  where certification.report_version_id = new.report_version_id
    and certification.organization_id = new.organization_id;
  if v_existing.report_version_id is null
     or v_existing.axis_citation_version <> 1
     or v_existing.catalog_count <> v_catalog_count
     or v_existing.scored_axis_count <> v_scored_axis_count
     or v_existing.link_count <> v_link_count
     or v_existing.certification_hash <> v_certification_hash then
    raise exception 'existing report lineage certification does not match';
  end if;

  return new;
end;
$$;

comment on function public.enforce_axis_evidence_lineage() is
  'Certifies strict immutable report lineage, including verified counter-evidence eligibility metadata.';

commit;
