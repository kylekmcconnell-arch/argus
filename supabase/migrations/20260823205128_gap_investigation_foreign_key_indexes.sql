-- Cover the remaining gap-investigation foreign keys used by case cleanup and
-- analyst audit lookups. The source-version and proposal-version keys are
-- already covered by the source/status and unique proposal indexes.

create index if not exists gap_investigations_case_idx
  on public.gap_investigations (case_id);

create index if not exists gap_investigations_actor_idx
  on public.gap_investigations (actor_user_id);
