begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create index if not exists usage_events_supplemental_day_idx on public.usage_events (organization_id, created_at) where event_type = 'supplemental.request';
create or replace function public.reserve_supplemental_budget(
  p_organization_id uuid, p_user_id uuid, p_route text, p_daily_limit integer
) returns table (allowed boolean, used integer, remaining integer)
language plpgsql security invoker set search_path = '' as $$
declare v_used integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 100000 then raise exception 'invalid supplemental limit'; end if;
  if not exists (select 1 from public.argus_members where organization_id = p_organization_id and user_id = p_user_id and active = true and role in ('analyst', 'owner')) then
    raise exception 'active investigator membership required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('supplemental:' || p_organization_id::text || ':' || (now() at time zone 'UTC')::date::text, 0));
  select coalesce(sum(units), 0)::integer into v_used from public.usage_events
    where organization_id = p_organization_id and event_type = 'supplemental.request'
    and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  if v_used >= p_daily_limit then return query select false, v_used, 0; return; end if;
  insert into public.usage_events (organization_id, user_id, event_type, route, units, metadata)
    values (p_organization_id, p_user_id, 'supplemental.request', p_route, 1, '{}'::jsonb);
  return query select true, v_used + 1, greatest(0, p_daily_limit - v_used - 1);
end;
$$;
revoke all on function public.reserve_supplemental_budget(uuid,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.reserve_supplemental_budget(uuid,uuid,text,integer) to service_role;
commit;
