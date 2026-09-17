-- Cross-scan investor observations (#454 follow-up): one row per
-- (investor x backed subject x funding round) that a saved scan's frozen
-- funding snapshots stated. The VC ranking is a DERIVED read over these rows,
-- never a stored counter: a rescan of the same subject overwrites the same
-- primary key instead of crediting a fund twice, and a lost concurrent write
-- cannot skew a count that is recomputed from rows every read.
--
-- Doctrine: aggregator attributions, kept in the aggregators' own words
-- (display_name verbatim, provider list attached). This store ranks investor
-- SOURCES as a research surface; it never feeds any subject's verdict.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.investor_records (
  organization_id          uuid not null,
  -- canonicalEntityKey({ name }) of the backer as the index named it.
  investor_key             text not null,
  -- The backed subject as its reports row keys it (handle or host).
  subject_ref              text not null,
  subject_kind             text not null default 'person',
  -- fundraising roundKey: "YYYY-MM|log-amount-bucket", idempotent per round.
  round_key                text not null,
  -- The backer's name exactly as the index stated it.
  display_name             text not null,
  backer_type              text,
  is_lead                  boolean not null default false,
  round_label              text,
  round_date               text,
  amount_usd               numeric,
  valuation_usd            numeric,
  instrument               text not null default 'unstated',
  providers                text[] not null default '{}',
  source_report_version_id uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  primary key (organization_id, investor_key, subject_ref, round_key)
);

create index if not exists investor_records_org_investor_idx
  on public.investor_records (organization_id, investor_key);

create index if not exists investor_records_org_updated_idx
  on public.investor_records (organization_id, updated_at desc);

drop trigger if exists investor_records_touch on public.investor_records;
create trigger investor_records_touch
  before update on public.investor_records
  for each row execute function public.touch_updated_at();

alter table public.investor_records enable row level security;

revoke all on table public.investor_records from public, anon, authenticated;
grant select, insert, update, delete on table public.investor_records to service_role;

commit;
