-- Axis-to-evidence lineage for immutable reports.
--
-- Legacy reports remain publishable. A report that explicitly opts into
-- axisCitationVersion=1, however, is published only when its exact catalog,
-- normalized evidence rows, ordered axis references, and (for complete
-- server-collected person reports) authoritative graph row agree in the same
-- transaction. The certification written by the projection trigger freezes
-- those provenance rows from that point forward.

-- This tenant-qualified key is the FK target for axis citations. Existing
-- report_version_id/evidence_key uniqueness guarantees the scan is duplicate
-- free; organization_id makes cross-tenant references structurally impossible.
-- Build the only potentially heavyweight index online, outside the schema
-- transaction. If later DDL fails, a retry reuses this valid index and attaches
-- the constraint with only a short catalog lock.
set lock_timeout = '5s';
set statement_timeout = '120s';

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_class index_relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = index_relation.relnamespace
    join pg_catalog.pg_index index_state
      on index_state.indexrelid = index_relation.oid
    where namespace.nspname = 'public'
      and index_relation.relname = 'evidence_items_org_report_key_uidx'
      and not index_state.indisvalid
  ) then
    execute 'drop index public.evidence_items_org_report_key_uidx';
  end if;
end;
$$;

create unique index concurrently if not exists evidence_items_org_report_key_uidx
  on public.evidence_items (organization_id, report_version_id, evidence_key);

reset lock_timeout;
reset statement_timeout;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.evidence_items
  add constraint evidence_items_org_report_key_unique
  unique using index evidence_items_org_report_key_uidx;

create table public.report_axis_evidence (
  organization_id   uuid not null,
  report_version_id uuid not null,
  role               text not null
                     check (role ~ '^[A-Z][A-Z0-9_]{0,79}$'),
  axis_id            text not null
                     check (axis_id ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  artifact_id        text not null
                     check (artifact_id ~ '^art_v1_[a-f0-9]{64}$'),
  relation           text not null
                     check (relation in ('support', 'counter')),
  ordinal            integer not null
                     check (ordinal between 0 and 11),
  created_at         timestamptz not null default now(),
  primary key (report_version_id, role, axis_id, relation, ordinal),
  unique (report_version_id, role, axis_id, relation, artifact_id),
  constraint report_axis_evidence_version_fkey
    foreign key (organization_id, report_version_id)
    references public.report_versions (organization_id, id)
    on delete cascade,
  constraint report_axis_evidence_artifact_fkey
    foreign key (organization_id, report_version_id, artifact_id)
    references public.evidence_items (organization_id, report_version_id, evidence_key)
    on delete cascade
);

create index report_axis_evidence_org_version_idx
  on public.report_axis_evidence (organization_id, report_version_id);
create index report_axis_evidence_org_artifact_idx
  on public.report_axis_evidence (organization_id, report_version_id, artifact_id);

create table public.report_lineage_certifications (
  report_version_id      uuid primary key,
  organization_id       uuid not null,
  axis_citation_version  smallint not null check (axis_citation_version = 1),
  catalog_count          integer not null check (catalog_count between 1 and 400),
  scored_axis_count      integer not null check (scored_axis_count between 0 and 1280),
  link_count             integer not null check (
                           (scored_axis_count = 0 and link_count = 0)
                           or (scored_axis_count > 0 and link_count between scored_axis_count and 1024)
                         ),
  certification_hash     text not null check (certification_hash ~ '^[a-f0-9]{64}$'),
  certified_at           timestamptz not null default now(),
  constraint report_lineage_certifications_version_fkey
    foreign key (organization_id, report_version_id)
    references public.report_versions (organization_id, id)
    on delete cascade
);

create unique index report_lineage_certifications_org_version_uidx
  on public.report_lineage_certifications (organization_id, report_version_id);

alter table public.report_axis_evidence enable row level security;
alter table public.report_lineage_certifications enable row level security;

create policy report_axis_evidence_read_member_org
  on public.report_axis_evidence
  for select to authenticated
  using (organization_id in (
    select membership.organization_id
    from public.argus_members membership
    where membership.user_id = (select auth.uid())
      and membership.active
  ));

create policy report_lineage_certifications_read_member_org
  on public.report_lineage_certifications
  for select to authenticated
  using (organization_id in (
    select membership.organization_id
    from public.argus_members membership
    where membership.user_id = (select auth.uid())
      and membership.active
  ));

-- Once a report is certified, its normalized catalog and ordered citations are
-- immutable. This includes later inserts: adding evidence after publication is
-- as unsafe as rewriting an existing row.
create or replace function public.prevent_certified_lineage_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report_version_id uuid;
begin
  v_report_version_id := case when tg_op = 'DELETE'
    then old.report_version_id
    else new.report_version_id
  end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('axis-lineage:' || v_report_version_id::text, 0)
  );
  if exists (
    select 1
    from public.report_lineage_certifications certification
    where certification.report_version_id = v_report_version_id
  ) then
    -- PostgREST retries may reach the BEFORE INSERT trigger before ON CONFLICT
    -- resolution. Only a byte-for-byte material retry may proceed to that
    -- conflict; a reused key with changed content fails closed.
    if tg_op = 'INSERT' then
      if tg_table_name = 'evidence_items' and exists (
        select 1
        from public.evidence_items evidence
        where evidence.organization_id = new.organization_id
          and evidence.report_version_id = new.report_version_id
          and evidence.evidence_key = pg_catalog.to_jsonb(new) ->> 'evidence_key'
          and (pg_catalog.to_jsonb(evidence) - 'id' - 'captured_at')
            = (pg_catalog.to_jsonb(new) - 'id' - 'captured_at')
          and (
            not coalesce(
              (pg_catalog.to_jsonb(new) #> '{metadata,catalogArtifact}') ? 'capturedAt',
              false
            )
            or evidence.captured_at = (pg_catalog.to_jsonb(new) ->> 'captured_at')::timestamptz
          )
      ) then
        return new;
      end if;
      if tg_table_name = 'report_axis_evidence' and exists (
        select 1
        from public.report_axis_evidence link
        where link.organization_id = new.organization_id
          and link.report_version_id = new.report_version_id
          and link.role = pg_catalog.to_jsonb(new) ->> 'role'
          and link.axis_id = pg_catalog.to_jsonb(new) ->> 'axis_id'
          and link.relation = pg_catalog.to_jsonb(new) ->> 'relation'
          and link.ordinal = (pg_catalog.to_jsonb(new) ->> 'ordinal')::integer
          and (pg_catalog.to_jsonb(link) - 'created_at')
            = (pg_catalog.to_jsonb(new) - 'created_at')
      ) then
        return new;
      end if;
      raise exception 'certified lineage retry payload does not match the existing row';
    end if;
    raise exception 'certified report lineage is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger evidence_items_freeze_after_lineage_certification
  before insert or update or delete on public.evidence_items
  for each row execute function public.prevent_certified_lineage_mutation();

create trigger report_axis_evidence_freeze_after_certification
  before insert or update or delete on public.report_axis_evidence
  for each row execute function public.prevent_certified_lineage_mutation();

create or replace function public.prevent_lineage_certification_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report lineage certification is immutable';
end;
$$;

create trigger report_lineage_certifications_are_immutable
  before update or delete on public.report_lineage_certifications
  for each row execute function public.prevent_lineage_certification_mutation();

-- The certification hashes the immutable report-version row. Freeze that source
-- row after publication so changing a rationale, score, verdict, status, graph,
-- or any other decision-bearing payload field cannot outlive its certification.
create or replace function public.prevent_certified_report_version_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('axis-lineage:' || old.id::text, 0)
  );
  if exists (
    select 1
    from public.report_lineage_certifications certification
    where certification.report_version_id = old.id
  ) then
    if tg_op = 'UPDATE' and pg_catalog.to_jsonb(new) = pg_catalog.to_jsonb(old) then
      return new;
    end if;
    raise exception 'certified report version decision payload is immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger report_versions_freeze_certified_decision
  before update or delete on public.report_versions
  for each row execute function public.prevent_certified_report_version_mutation();

-- A certified graph may be replayed exactly. Moving the one subject graph to a
-- newer immutable version is allowed only inside the graph-first activation RPC
-- and only when every graph field exactly matches that newer version payload.
create or replace function public.prevent_certified_graph_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.report_version_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('axis-lineage:' || old.report_version_id::text, 0)
  );
  if not exists (
    select 1
    from public.report_lineage_certifications certification
    where certification.report_version_id = old.report_version_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and (pg_catalog.to_jsonb(new) - 'updated_at')
       = (pg_catalog.to_jsonb(old) - 'updated_at') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and pg_catalog.current_setting('argus.activating_graph_report_version', true)
       = new.report_version_id::text
     and exists (
       select 1
       from public.report_versions version_row
       join public.cases case_row
         on case_row.id = version_row.case_id
        and case_row.organization_id = version_row.organization_id
       where version_row.id = new.report_version_id
         and version_row.organization_id = new.organization_id
         and version_row.attestation_state = 'server_collected'
         and version_row.completeness_state = 'complete'
         and case_row.kind = 'person'
         and case_row.status = 'open'
         and case_row.canonical_ref = new.canonical_key
         and pg_catalog.lower(pg_catalog.ltrim(pg_catalog.btrim(version_row.payload ->> 'handle'), '@'))
           = case_row.canonical_ref
         and new.handle = pg_catalog.btrim(version_row.payload ->> 'handle')
         and new.aliases = pg_catalog.jsonb_build_array(
           pg_catalog.ltrim(pg_catalog.btrim(version_row.payload ->> 'handle'), '@')
         )
         and new.verdict is not distinct from version_row.verdict
         and new.nodes = version_row.payload #> '{graph,nodes}'
         and new.edges = version_row.payload #> '{graph,edges}'
         and new.contributor = pg_catalog.left(coalesce(version_row.contributor_label, 'anonymous'), 80)
         and new.contributor_user_id is not distinct from version_row.created_by
         and new.provenance_state = 'server_collected'
         and not exists (
           select 1
           from public.report_versions newer
           where newer.case_id = version_row.case_id
             and newer.version > version_row.version
         )
     ) then
    return new;
  end if;
  raise exception 'certified authoritative graph is immutable outside exact graph activation';
end;
$$;

create trigger graph_contributions_block_certified_mutation
  before update or delete on public.graph_contributions
  for each row execute function public.prevent_certified_graph_mutation();

-- Protect the active projection as well as its source version. Exact no-ops are
-- harmless; a pointer transition is allowed only to the latest, already
-- certified immutable version whose projection fields match exactly.
create or replace function public.prevent_certified_report_projection_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.report_version_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('axis-lineage:' || old.report_version_id::text, 0)
  );
  if not exists (
    select 1
    from public.report_lineage_certifications certification
    where certification.report_version_id = old.report_version_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and pg_catalog.to_jsonb(new) = pg_catalog.to_jsonb(old) then
    return new;
  end if;
  if tg_op = 'DELETE'
     and pg_catalog.current_setting('argus.lifecycle_action', true) = 'archive'
     and pg_catalog.current_setting('argus.lifecycle_organization_id', true) = old.organization_id::text
     and exists (
       select 1
       from public.argus_members membership
       where membership.organization_id = old.organization_id
         and membership.user_id::text = pg_catalog.current_setting('argus.lifecycle_actor_user_id', true)
         and membership.active
         and membership.role = 'owner'
     )
     and exists (
       select 1
       from pg_catalog.jsonb_array_elements(
         coalesce(
           nullif(pg_catalog.current_setting('argus.lifecycle_subjects', true), ''),
           '[]'
         )::jsonb
       ) subject(item)
       where subject.item ->> 'kind' = old.kind
         and subject.item ->> 'ref' = old.ref
     )
     and exists (
       select 1
       from public.report_versions version_row
       join public.cases case_row
         on case_row.id = version_row.case_id
        and case_row.organization_id = version_row.organization_id
       where version_row.id = old.report_version_id
         and version_row.organization_id = old.organization_id
         and case_row.status = 'archived'
         and case_row.kind = old.kind
         and case_row.canonical_ref = old.ref
         and case_row.display_query = old.query
         and version_row.payload = old.payload
         and version_row.verdict is not distinct from old.verdict
         and version_row.score is not distinct from old.score
         and version_row.attestation_state = old.attestation_state
         and version_row.contributor_label = old.contributor
         and version_row.created_by is not distinct from old.created_by
         and version_row.created_at = old.ts
     ) then
    return old;
  end if;
  -- The existing persistence RPC intentionally removes a now-stale projection
  -- after inserting a newer immutable version and before provenance activation.
  -- Permit only that bounded transition; the certified old version itself stays
  -- frozen and the UI cannot continue serving stale decision data.
  if tg_op = 'DELETE' and exists (
    select 1
    from public.report_versions old_version
    join public.report_versions newer
      on newer.case_id = old_version.case_id
     and newer.organization_id = old_version.organization_id
     and newer.version > old_version.version
    join public.cases case_row
      on case_row.id = old_version.case_id
     and case_row.organization_id = old_version.organization_id
    where old_version.id = old.report_version_id
      and old_version.organization_id = old.organization_id
      and case_row.kind = old.kind
      and case_row.canonical_ref = old.ref
      and not exists (
        select 1
        from public.report_versions latest
        where latest.case_id = old_version.case_id
          and latest.version > newer.version
      )
  ) then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and new.report_version_id is distinct from old.report_version_id
     and exists (
       select 1
       from public.report_versions version_row
       join public.cases case_row
         on case_row.id = version_row.case_id
        and case_row.organization_id = version_row.organization_id
       join public.report_lineage_certifications certification
         on certification.report_version_id = version_row.id
        and certification.organization_id = version_row.organization_id
       where version_row.id = new.report_version_id
         and version_row.organization_id = new.organization_id
         and case_row.status = 'open'
         and case_row.kind = new.kind
         and case_row.canonical_ref = new.ref
         and case_row.display_query = new.query
         and version_row.payload = new.payload
         and version_row.verdict is not distinct from new.verdict
         and version_row.score is not distinct from new.score
         and version_row.attestation_state = new.attestation_state
         and version_row.contributor_label = new.contributor
         and version_row.created_by is not distinct from new.created_by
         and version_row.created_at = new.ts
         and not exists (
           select 1
           from public.report_versions newer
           where newer.case_id = version_row.case_id
             and newer.version > version_row.version
         )
     ) then
    return new;
  end if;
  raise exception 'certified active report projection is immutable';
end;
$$;

-- Validate and certify strict lineage immediately before a report projection is
-- inserted or replaced. Because this is a BEFORE trigger, any failure in the
-- projection statement or surrounding graph-activation transaction rolls the
-- certification back with the publication.
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
         'verification', 'scope'
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
           and evidence.metadata = pg_catalog.jsonb_build_object(
             'strictLineage', true,
             'axisCitationVersion', 1,
             'artifactId', artifact.item ->> 'artifactId',
             'kind', 'axis_evidence',
             'operation', artifact.item ->> 'operation',
             'section', artifact.item ->> 'section',
             'eligibleAxes', artifact.item -> 'eligibleAxes',
             'verification', artifact.item ->> 'verification',
             'scope', artifact.item ->> 'scope',
             'catalogArtifact', normalized.catalog_artifact
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

drop trigger if exists reports_enforce_axis_evidence_lineage on public.reports;
create trigger reports_enforce_axis_evidence_lineage
  before insert or update on public.reports
  for each row execute function public.enforce_axis_evidence_lineage();

-- Trigger names are ordered alphabetically by PostgreSQL: the lineage gate
-- certifies the incoming version before this projection freeze evaluates a
-- legitimate latest-version transition.
create trigger reports_freeze_certified_decision
  before update or delete on public.reports
  for each row execute function public.prevent_certified_report_projection_mutation();

-- Preserve the owner-only archive/restore RPC while marking its archive delete
-- as a narrow transaction-local lifecycle transition. The projection trigger
-- independently revalidates the owner, tenant, exact subject, archived case,
-- immutable version, and projection before honoring this marker.
alter function public.manage_case_lifecycle(uuid, uuid, text, jsonb)
  rename to manage_case_lifecycle_without_lineage_marker;

create function public.manage_case_lifecycle(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_subjects jsonb
)
returns table (
  subject_kind text,
  subject_ref text,
  case_status text,
  changed boolean,
  revoked_share_links integer,
  latest_report_version_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'argus.lifecycle_action',
    pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, ''))),
    true
  );
  perform pg_catalog.set_config(
    'argus.lifecycle_organization_id',
    coalesce(p_organization_id::text, ''),
    true
  );
  perform pg_catalog.set_config(
    'argus.lifecycle_actor_user_id',
    coalesce(p_actor_user_id::text, ''),
    true
  );
  perform pg_catalog.set_config(
    'argus.lifecycle_subjects',
    coalesce(p_subjects, '[]'::jsonb)::text,
    true
  );

  return query
  select lifecycle.*
  from public.manage_case_lifecycle_without_lineage_marker(
    p_organization_id,
    p_actor_user_id,
    p_action,
    p_subjects
  ) lifecycle;

  perform pg_catalog.set_config('argus.lifecycle_action', '', true);
  perform pg_catalog.set_config('argus.lifecycle_organization_id', '', true);
  perform pg_catalog.set_config('argus.lifecycle_actor_user_id', '', true);
  perform pg_catalog.set_config('argus.lifecycle_subjects', '[]', true);
end;
$$;

revoke all on function public.manage_case_lifecycle_without_lineage_marker(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.manage_case_lifecycle(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.manage_case_lifecycle(uuid, uuid, text, jsonb)
  to service_role;

-- Reorder complete-person publication so the authoritative graph exists before
-- the base activation inserts public.reports and fires the strict lineage gate.
-- All work remains inside this one RPC transaction; a gate or projection failure
-- rolls the graph upsert back to its prior version.
create or replace function public.activate_report_version_with_graph(
  p_organization_id uuid,
  p_report_version_id uuid,
  p_actor_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_nodes jsonb;
  v_edges jsonb;
  v_handle text;
  v_case_ref text;
  v_graph_subject text;
  v_subject_count integer;
  v_canonical_key text;
  v_verdict text;
  v_contributor text;
  v_created_by uuid;
  v_attestation text;
  v_completeness text;
begin
  select rv.payload, rv.verdict, rv.contributor_label, rv.created_by,
         rv.attestation_state, rv.completeness_state, c.canonical_ref
  into v_payload, v_verdict, v_contributor, v_created_by,
       v_attestation, v_completeness, v_case_ref
  from public.report_versions rv
  join public.cases c
    on c.id = rv.case_id
   and c.organization_id = rv.organization_id
  where rv.organization_id = p_organization_id
    and rv.id = p_report_version_id
    and c.kind = 'person'
  limit 1;

  if v_payload is null
     or v_created_by is distinct from p_actor_user_id
     or v_attestation <> 'server_collected'
     or v_completeness <> 'complete' then
    raise exception 'authoritative graph requires an exact complete server-collected person report';
  end if;

  v_handle := pg_catalog.btrim(coalesce(v_payload ->> 'handle', ''));
  v_nodes := v_payload #> '{graph,nodes}';
  v_edges := v_payload #> '{graph,edges}';
  if v_handle = ''
     or pg_catalog.length(v_handle) > 500
     or v_nodes is null
     or v_edges is null
     or pg_catalog.jsonb_typeof(v_nodes) <> 'array'
     or pg_catalog.jsonb_typeof(v_edges) <> 'array'
     or pg_catalog.jsonb_array_length(v_nodes) = 0
     or pg_catalog.jsonb_array_length(v_nodes) > 4000
     or pg_catalog.jsonb_array_length(v_edges) > 4000
     or pg_catalog.octet_length(v_nodes::text) + pg_catalog.octet_length(v_edges::text) > 1500000 then
    raise exception 'immutable report graph payload is missing or outside bounded limits';
  end if;

  select pg_catalog.count(*), pg_catalog.min(node ->> 'key')
  into v_subject_count, v_graph_subject
  from pg_catalog.jsonb_array_elements(v_nodes) node
  where pg_catalog.jsonb_typeof(node) = 'object'
    and pg_catalog.jsonb_typeof(node -> 'subject') = 'boolean'
    and (node ->> 'subject')::boolean;

  if v_subject_count <> 1
     or pg_catalog.jsonb_typeof((
       select node -> 'key'
       from pg_catalog.jsonb_array_elements(v_nodes) node
       where pg_catalog.jsonb_typeof(node) = 'object'
         and pg_catalog.jsonb_typeof(node -> 'subject') = 'boolean'
         and (node ->> 'subject')::boolean
       limit 1
     )) <> 'string'
     or pg_catalog.btrim(coalesce(v_graph_subject, '')) = '' then
    raise exception 'immutable report graph must contain exactly one string-keyed subject node';
  end if;

  if v_handle !~ '^@?[A-Za-z0-9_]{1,15}$'
     or v_graph_subject !~ '^@?[A-Za-z0-9_]{1,15}$' then
    raise exception 'immutable person report contains a malformed subject handle';
  end if;
  v_canonical_key := pg_catalog.lower(pg_catalog.ltrim(v_graph_subject, '@'));
  if v_canonical_key is distinct from v_case_ref
     or pg_catalog.lower(pg_catalog.ltrim(v_handle, '@')) is distinct from v_case_ref then
    raise exception 'immutable report graph subject does not match its case';
  end if;

  -- Preserve the case-lock ordering used by base activation while still
  -- materializing the graph before the projection fires the lineage gate.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':person:' || v_case_ref,
      0
    )
  );

  perform pg_catalog.set_config(
    'argus.activating_graph_report_version',
    p_report_version_id::text,
    true
  );

  insert into public.graph_contributions (
    organization_id, canonical_key, handle, aliases, verdict, nodes, edges,
    contributor, contributor_user_id, report_version_id, provenance_state
  ) values (
    p_organization_id,
    v_canonical_key,
    v_handle,
    pg_catalog.jsonb_build_array(pg_catalog.ltrim(v_handle, '@')),
    v_verdict,
    v_nodes,
    v_edges,
    pg_catalog.left(coalesce(v_contributor, 'anonymous'), 80),
    p_actor_user_id,
    p_report_version_id,
    'server_collected'
  )
  on conflict (organization_id, canonical_key)
  do update set
    handle = excluded.handle,
    aliases = excluded.aliases,
    verdict = excluded.verdict,
    nodes = excluded.nodes,
    edges = excluded.edges,
    contributor = excluded.contributor,
    contributor_user_id = excluded.contributor_user_id,
    report_version_id = excluded.report_version_id,
    provenance_state = excluded.provenance_state;

  perform public.activate_report_version(p_organization_id, p_report_version_id);
end;
$$;

comment on table public.report_axis_evidence is
  'Ordered, report-version-scoped artifact citations for each scored role axis.';
comment on table public.report_lineage_certifications is
  'Immutable certification created atomically when a strict axis-cited report is published.';
comment on function public.enforce_axis_evidence_lineage() is
  'Fails closed for axisCitationVersion=1 unless catalog evidence, ordered links, eligibility, and graph provenance agree exactly.';

revoke all on table public.report_axis_evidence, public.report_lineage_certifications
  from public, anon, authenticated;
grant select on table public.report_axis_evidence, public.report_lineage_certifications
  to authenticated;
grant all on table public.report_axis_evidence, public.report_lineage_certifications
  to service_role;

revoke all on function public.prevent_certified_lineage_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_lineage_certification_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_certified_report_version_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_certified_graph_mutation()
  from public, anon, authenticated;
revoke all on function public.prevent_certified_report_projection_mutation()
  from public, anon, authenticated;
revoke all on function public.enforce_axis_evidence_lineage()
  from public, anon, authenticated;
revoke all on function public.activate_report_version_with_graph(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_report_version_with_graph(uuid, uuid, uuid)
  to service_role;

commit;
