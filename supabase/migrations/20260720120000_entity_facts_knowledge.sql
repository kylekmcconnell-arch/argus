-- Entity knowledge base: a durable, per-organization store of the VERIFIED
-- facts an audit resolves about an entity (person/project/fund/token), keyed by
-- canonical_key (the same X-handle -> domain -> name key graph_contributions
-- uses). Every audit writes its verified facts here; a later audit of the same
-- or an overlapping entity reads them back instead of re-paying the expensive
-- discovery. The fact-level sibling of graph_contributions.
--
-- Only source-backed, artifact-verified facts belong here (never model leads),
-- and sanctions/legal screening is deliberately EXCLUDED: those must run live on
-- every audit because a subject can be newly sanctioned or charged.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.entity_facts (
  organization_id          uuid not null,
  canonical_key            text not null,
  entity_type              text,
  handle                   text,
  display_name             text,
  facts                    jsonb not null default '{}'::jsonb,
  audit_count              integer not null default 1,
  source_report_version_id uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (organization_id, canonical_key)
);

create index entity_facts_org_updated_idx
  on public.entity_facts (organization_id, updated_at desc);

drop trigger if exists entity_facts_touch on public.entity_facts;
create trigger entity_facts_touch
  before update on public.entity_facts
  for each row execute function public.touch_updated_at();

alter table public.entity_facts enable row level security;

revoke all on table public.entity_facts from public, anon, authenticated;
grant select, insert, update, delete on table public.entity_facts to service_role;

commit;
