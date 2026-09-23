-- One analyst must not be able to spend the whole workspace's day.
--
-- reserve_supplemental_budget counted only the ORGANIZATION's usage, so a
-- single session hammering /api/ask, /api/ocr-clue or any Arkham panel could
-- exhaust the shared daily allowance and lock every colleague out until UTC
-- midnight. The route is authenticated, so this is not anonymous abuse, but
-- an unbounded per-user share is still unbounded provider spend (#356).
--
-- The per-user cap is optional: passing null keeps the previous behaviour, so
-- a deployment that has not configured one is unchanged. The reason column
-- lets the caller tell an analyst who hit their own cap from a workspace that
-- is genuinely out of budget for the day.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop function if exists public.reserve_supplemental_budget(uuid, uuid, text, integer);

create function public.reserve_supplemental_budget(
  p_organization_id uuid, p_user_id uuid, p_route text, p_daily_limit integer,
  p_user_daily_limit integer default null
) returns table (allowed boolean, used integer, remaining integer, reason text)
language plpgsql security invoker set search_path = '' as $$
declare
  v_used integer;
  v_user_used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 100000 then raise exception 'invalid supplemental limit'; end if;
  if p_user_daily_limit is not null and (p_user_daily_limit < 1 or p_user_daily_limit > 100000) then
    raise exception 'invalid supplemental user limit';
  end if;
  if not exists (select 1 from public.argus_members where organization_id = p_organization_id and user_id = p_user_id and active = true and role in ('analyst', 'owner')) then
    raise exception 'active investigator membership required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('supplemental:' || p_organization_id::text || ':' || (now() at time zone 'UTC')::date::text, 0));
  select coalesce(sum(units), 0)::integer into v_used from public.usage_events
    where organization_id = p_organization_id and event_type = 'supplemental.request'
    and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  if v_used >= p_daily_limit then return query select false, v_used, 0, 'workspace_daily_limit'::text; return; end if;

  -- The analyst's own share of that same day, counted under the same lock so
  -- two concurrent requests cannot both pass the cap.
  if p_user_daily_limit is not null then
    select coalesce(sum(units), 0)::integer into v_user_used from public.usage_events
      where organization_id = p_organization_id and user_id = p_user_id
      and event_type = 'supplemental.request'
      and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
    if v_user_used >= p_user_daily_limit then
      return query select false, v_used, greatest(0, p_daily_limit - v_used), 'user_daily_limit'::text;
      return;
    end if;
  end if;

  insert into public.usage_events (organization_id, user_id, event_type, route, units, metadata)
    values (p_organization_id, p_user_id, 'supplemental.request', p_route, 1, '{}'::jsonb);
  return query select true, v_used + 1, greatest(0, p_daily_limit - v_used - 1), null::text;
end;
$$;

-- `drop function` discards grants; restore the service-role boundary in the
-- same transaction so the reservation RPC is never callable by anon or
-- authenticated.
revoke all on function public.reserve_supplemental_budget(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_supplemental_budget(uuid, uuid, text, integer, integer) to service_role;

comment on function public.reserve_supplemental_budget(uuid, uuid, text, integer, integer) is
  'Reserves one supplemental unit against the workspace day, and against the analyst''s own share when a per-user cap is configured.';

commit;
