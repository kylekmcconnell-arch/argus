-- Keep the indexed member allowlist synchronized when an already-approved
-- Auth user changes email, and bound the durable limiter ledger over time.

create or replace function private.sync_argus_members_after_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null or new.email is null then
    return new;
  end if;

  update public.argus_members
  set normalized_email = lower(btrim(new.email))
  where user_id = new.id
    and normalized_email is distinct from lower(btrim(new.email));

  return new;
end;
$$;

revoke all on function private.sync_argus_members_after_auth_email_change()
  from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.sync_argus_members_after_auth_email_change()
  to supabase_auth_admin;

drop trigger if exists argus_members_sync_auth_email on auth.users;
create trigger argus_members_sync_auth_email
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email and new.deleted_at is null)
  execute function private.sync_argus_members_after_auth_email_change();

create or replace function public.consume_auth_request_limit(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer,
  p_limit integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval;
  v_attempts integer;
  v_window_started_at timestamptz;
begin
  if p_scope not in ('signin_ip', 'signin_email') then
    raise exception 'invalid auth request limit scope';
  end if;
  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid auth request limit key';
  end if;
  if p_window_seconds not between 30 and 3600 then
    raise exception 'auth request limit window must be between 30 and 3600 seconds';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'auth request limit must be between 1 and 100';
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.auth_request_limits as request_limit (
    scope,
    key_hash,
    window_started_at,
    attempts,
    updated_at
  ) values (
    p_scope,
    p_key_hash,
    v_now,
    1,
    v_now
  )
  on conflict (scope, key_hash) do update set
    window_started_at = case
      when request_limit.window_started_at <= v_now - v_window then v_now
      else request_limit.window_started_at
    end,
    attempts = case
      when request_limit.window_started_at <= v_now - v_window then 1
      else request_limit.attempts + 1
    end,
    updated_at = v_now
  returning attempts, window_started_at
  into v_attempts, v_window_started_at;

  -- Each request removes a bounded batch. The index on updated_at makes this
  -- predictable while a 24-hour retention period exceeds the longest window.
  with stale as (
    select request_limit.scope, request_limit.key_hash
    from public.auth_request_limits request_limit
    where request_limit.updated_at < v_now - interval '24 hours'
    order by request_limit.updated_at
    limit 100
    for update skip locked
  )
  delete from public.auth_request_limits request_limit
  using stale
  where request_limit.scope = stale.scope
    and request_limit.key_hash = stale.key_hash;

  allowed := v_attempts <= p_limit;
  remaining := greatest(p_limit - v_attempts, 0);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (v_window_started_at + v_window - v_now)))::integer
    )
  end;
  return next;
end;
$$;

grant delete on table public.auth_request_limits to service_role;

revoke all on function public.consume_auth_request_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_auth_request_limit(text, text, integer, integer)
  to service_role;
