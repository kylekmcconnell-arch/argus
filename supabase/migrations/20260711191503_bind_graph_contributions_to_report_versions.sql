-- Bind authoritative trust-graph rows to the exact immutable report that
-- produced them. Legacy/client rows remain useful for exploration, but only a
-- server-collected row with a qualified report version may govern a verdict.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.graph_contributions
  add column if not exists report_version_id uuid;

alter table public.graph_contributions
  add column if not exists provenance_state text not null default 'legacy';

-- The original bootstrap used workspace-global subject indexes before
-- organization scoping existed. Keeping either would make the same subject
-- collide across tenants even though both upserts use composite keys.
alter table public.graph_contributions
  drop constraint if exists graph_contributions_canonical_key_key;
drop index if exists public.graph_contributions_canonical_key_key;
alter table public.reports
  drop constraint if exists reports_ref_kind_uidx;
drop index if exists public.reports_ref_kind_uidx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'graph_contributions_provenance_state_check'
      and conrelid = 'public.graph_contributions'::regclass
  ) then
    alter table public.graph_contributions
      add constraint graph_contributions_provenance_state_check
      check (provenance_state in ('server_collected', 'client_submitted', 'legacy'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'graph_contributions_server_provenance_bound_check'
      and conrelid = 'public.graph_contributions'::regclass
  ) then
    alter table public.graph_contributions
      add constraint graph_contributions_server_provenance_bound_check
      check (provenance_state <> 'server_collected' or report_version_id is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'graph_contributions_organization_report_version_fkey'
      and conrelid = 'public.graph_contributions'::regclass
  ) then
    alter table public.graph_contributions
      add constraint graph_contributions_organization_report_version_fkey
      foreign key (organization_id, report_version_id)
      references public.report_versions (organization_id, id)
      on delete restrict
      not valid;
  end if;
end
$$;

alter table public.graph_contributions
  validate constraint graph_contributions_organization_report_version_fkey;

create index if not exists graph_contributions_org_report_version_idx
  on public.graph_contributions (organization_id, report_version_id)
  where report_version_id is not null;

create index if not exists graph_contributions_contributor_user_idx
  on public.graph_contributions (contributor_user_id)
  where contributor_user_id is not null;

create or replace function public.preserve_server_graph_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.provenance_state = 'server_collected'
     and new.provenance_state <> 'server_collected' then
    new.organization_id := old.organization_id;
    new.canonical_key := old.canonical_key;
    new.handle := old.handle;
    new.aliases := old.aliases;
    new.verdict := old.verdict;
    new.nodes := old.nodes;
    new.edges := old.edges;
    new.contributor := old.contributor;
    new.contributor_user_id := old.contributor_user_id;
    new.report_version_id := old.report_version_id;
    new.provenance_state := old.provenance_state;
  end if;
  return new;
end;
$$;

revoke all on function public.preserve_server_graph_provenance() from public, anon, authenticated;

drop trigger if exists graph_contributions_preserve_server_provenance
  on public.graph_contributions;
create trigger graph_contributions_preserve_server_provenance
  before update on public.graph_contributions
  for each row execute function public.preserve_server_graph_provenance();

comment on column public.graph_contributions.report_version_id is
  'Exact immutable report version that produced an authoritative graph contribution.';

comment on column public.graph_contributions.provenance_state is
  'server_collected rows may feed frozen verdict governance; client_submitted and legacy rows are overlay-only.';

-- Publish a complete server-collected person report and its graph contribution
-- in one database transaction. The graph is derived from the immutable payload,
-- not accepted as a second mutable client body. If either activation or graph
-- persistence fails, Postgres rolls both operations back.
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
  select
    rv.payload,
    rv.verdict,
    rv.contributor_label,
    rv.created_by,
    rv.attestation_state,
    rv.completeness_state,
    c.canonical_ref
  into
    v_payload,
    v_verdict,
    v_contributor,
    v_created_by,
    v_attestation,
    v_completeness,
    v_case_ref
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
     or v_edges is null then
    raise exception 'immutable report graph payload is missing or outside bounded limits';
  end if;
  if pg_catalog.jsonb_typeof(v_nodes) <> 'array'
     or pg_catalog.jsonb_typeof(v_edges) <> 'array' then
    raise exception 'immutable report graph payload is missing or outside bounded limits';
  end if;
  if pg_catalog.jsonb_array_length(v_nodes) = 0
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
     or pg_catalog.jsonb_typeof(
       (
         select node -> 'key'
         from pg_catalog.jsonb_array_elements(v_nodes) node
         where pg_catalog.jsonb_typeof(node) = 'object'
           and pg_catalog.jsonb_typeof(node -> 'subject') = 'boolean'
           and (node ->> 'subject')::boolean
         limit 1
       )
     ) <> 'string'
     or pg_catalog.btrim(coalesce(v_graph_subject, '')) = '' then
    raise exception 'immutable report graph must contain exactly one string-keyed subject node';
  end if;

  -- This RPC publishes person reports only. Bind the graph row to the case's
  -- canonical handle rather than trusting a second identity from JSON.
  if v_handle !~ '^@?[A-Za-z0-9_]{1,15}$'
     or v_graph_subject !~ '^@?[A-Za-z0-9_]{1,15}$' then
    raise exception 'immutable person report contains a malformed subject handle';
  end if;
  v_canonical_key := pg_catalog.lower(pg_catalog.ltrim(v_graph_subject, '@'));
  if v_canonical_key is distinct from v_case_ref
     or pg_catalog.lower(pg_catalog.ltrim(v_handle, '@')) is distinct from v_case_ref then
    raise exception 'immutable report graph subject does not match its case';
  end if;

  perform public.activate_report_version(p_organization_id, p_report_version_id);

  insert into public.graph_contributions (
    organization_id,
    canonical_key,
    handle,
    aliases,
    verdict,
    nodes,
    edges,
    contributor,
    contributor_user_id,
    report_version_id,
    provenance_state
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
end;
$$;

revoke all on function public.activate_report_version_with_graph(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_report_version_with_graph(uuid, uuid, uuid)
  to service_role;

commit;
