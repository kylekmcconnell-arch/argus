-- One-time flush of every server-side cache that could feed stale, pre-fix
-- data into new scans (Enigma, 2026-09-17). This week's fixes changed what a
-- scan is allowed to believe (namesake-token reciprocity #465, person routing
-- #456, backer-edge ownership #467), and two stores still hold answers
-- produced by the OLD pipeline:
--
--   provider_cache - the 24h read-through provider cache: a same-day rescan
--     reuses yesterday's provider answers instead of re-reading live sources.
--   entity_facts   - the cross-scan knowledge base: it recalls facts frozen by
--     earlier audits (roles, ventures, even a bound projectToken) into new
--     scans, so a pre-fix row can re-inject exactly the errors just fixed.
--
-- Truncating costs only re-discovery spend on the next scan of each subject;
-- no report, version, case, or graph row is touched. Saved reports remain
-- immutable history by doctrine - a hard rescan supersedes them.
--
-- provider_cache predates the recorded migration history (like entity_facts,
-- it exists in production without a version entry), so a fresh shadow database
-- does not have it: guard both by existence so CI's from-scratch apply passes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.provider_cache') is not null then
    execute 'truncate table public.provider_cache';
  end if;
  if to_regclass('public.entity_facts') is not null then
    execute 'truncate table public.entity_facts';
  end if;
end
$$;

commit;
