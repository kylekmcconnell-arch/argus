-- No-op production-deploy marker. The GitHub integration applies files in
-- supabase/migrations/ when they merge to main. This file exists so the
-- already-merged waitlist/credit migration is included in that first deploy.
-- Additive. Does not enable billing.

select 1;
