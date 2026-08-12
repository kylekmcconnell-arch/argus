-- Make consume_usage_quota lockless.
--
-- The prior definition took a per-(org, user, event_type, day) advisory
-- transaction lock so a concurrent check-then-insert could never overshoot the
-- daily limit. But a single scan (and a report view's intelligence panels) fire
-- many concurrent "api.budget" checks that all serialize on that ONE lock,
-- turning provider latency into queued waits. These are soft daily rate limits,
-- so a tiny boundary overshoot under high concurrency (a handful of extra units
-- when several calls race at exactly the limit) is acceptable, and removing the
-- lock lets the checks run in parallel. The application layer additionally fails
-- open when the RPC is unreachable, so approximate-but-available beats
-- exact-but-serialized here.
--
-- The daily aggregation is unchanged and still served by usage_events_daily_idx
-- (organization_id, user_id, event_type, created_at desc).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.consume_usage_quota(
  p_organization_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_route text,
  p_daily_limit integer,
  p_metadata jsonb default '{}'::jsonb,
  p_units numeric default 1
)
returns table (allowed boolean, used integer, remaining integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_daily_limit < 1 or p_units <= 0 then
    raise exception 'daily limit must be positive';
  end if;

  select coalesce(ceil(sum(ue.units)), 0)::integer
  into v_used
  from public.usage_events ue
  where ue.organization_id = p_organization_id
    and ue.user_id = p_user_id
    and ue.event_type = p_event_type
    and ue.created_at >= date_trunc('day', now());

  if v_used + ceil(p_units)::integer > p_daily_limit then
    return query select false, v_used, 0;
    return;
  end if;

  insert into public.usage_events (
    organization_id, user_id, event_type, route, units, metadata
  ) values (
    p_organization_id, p_user_id, p_event_type, p_route, p_units, coalesce(p_metadata, '{}'::jsonb)
  );

  v_used := v_used + ceil(p_units)::integer;
  return query select true, v_used, greatest(p_daily_limit - v_used, 0);
end;
$$;

commit;
