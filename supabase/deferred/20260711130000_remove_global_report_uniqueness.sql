-- Deferred post-release cleanup. Keep this file outside supabase/migrations so
-- routine migration pushes cannot remove the rollback-compatible report cache
-- until the authenticated production smoke test has passed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop index if exists public.reports_ref_kind_uidx;

-- These rollback-compatibility rows are no longer read after the cache cutover.
delete from public.reports
where kind = 'grokcache';

commit;
