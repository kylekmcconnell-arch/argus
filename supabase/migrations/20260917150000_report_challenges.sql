-- Verified report challenges: who is challenging a report (the subject's own
-- team vs a community member), the domain-bound email verification that
-- protects startups from impersonation, the correction itself, evidence file
-- attachments, and the separate "where did this go wrong?" note that feeds
-- ARGUS's system-level learning rather than just this one report.
--
-- Threat model: a "team" challenger is either setting the record straight or
-- trying to fool the system (a nefarious insider, or an outsider damaging the
-- brand). The gate is an email whose domain must match the subject's verified
-- official website, proven by a single-use, expiring verification link. A
-- team-verified correction carries a higher confirmation level downstream.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table if not exists public.challenge_verifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  subject_ref      text not null,
  email            text not null,
  email_domain     text not null,
  -- sha256 of the emailed token; the plaintext never touches the database.
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  verified_at      timestamptz,
  -- set when a submitted challenge spends the verification; single-use.
  consumed_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index if not exists challenge_verifications_org_subject_idx
  on public.challenge_verifications (organization_id, subject_ref, created_at desc);

create table if not exists public.report_challenges (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  subject_ref        text not null,
  report_version_id  uuid,
  -- what on the report was being challenged (score, a finding, coverage, a question)
  context            text,
  challenger_role    text not null check (challenger_role in ('team', 'community')),
  email              text,
  email_verified     boolean not null default false,
  verification_id    uuid references public.challenge_verifications(id),
  -- the correction for THIS report
  whats_wrong        text not null,
  -- how the system's LOGIC erred; routed to global methodology learning
  where_wrong        text,
  -- corroborating evidence attachments: [{name, type, dataUrl}]
  files              jsonb not null default '[]'::jsonb,
  status             text not null default 'new' check (status in ('new', 'reviewed', 'applied', 'dismissed')),
  created_by         uuid,
  created_by_label   text,
  created_at         timestamptz not null default now()
);

create index if not exists report_challenges_org_created_idx
  on public.report_challenges (organization_id, created_at desc);
create index if not exists report_challenges_org_subject_idx
  on public.report_challenges (organization_id, subject_ref, created_at desc);

alter table public.challenge_verifications enable row level security;
alter table public.report_challenges enable row level security;

revoke all on table public.challenge_verifications from public, anon, authenticated;
revoke all on table public.report_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.challenge_verifications to service_role;
grant select, insert, update, delete on table public.report_challenges to service_role;

commit;
