-- Complete the provider-cache cutover and remove the legacy global report key.
-- Apply this migration only after the application release that writes provider
-- cache entries to public.provider_cache. The organization-scoped unique index
-- remains the canonical report conflict target.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop index if exists public.reports_ref_kind_uidx;

-- These rollback-compatibility rows are no longer read after the cache cutover.
delete from public.reports
where kind = 'grokcache';

commit;
