-- One indexed allowlist lookup and durable, atomic throttles for the public
-- approved-member sign-in request. Raw email addresses and IP addresses are
-- never written to the rate-limit ledger.

alter table public.argus_members
  add column if not exists normalized_email text;

update public.argus_members member
set normalized_email = lower(btrim(auth_user.email))
from auth.users auth_user
where auth_user.id = member.user_id
  and member.normalized_email is null;

do $$
begin
  if exists (
    select 1
    from public.argus_members
    where normalized_email is null
  ) then
    raise exception 'every ARGUS member must have an Auth email before enabling approved sign-in';
  end if;
end $$;

alter table public.argus_members
  alter column normalized_email set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'argus_members_normalized_email_check'
      and conrelid = 'public.argus_members'::regclass
  ) then
    alter table public.argus_members
      add constraint argus_members_normalized_email_check
      check (
        normalized_email = lower(btrim(normalized_email))
        and char_length(normalized_email) between 3 and 320
        and normalized_email like '%@%'
      );
  end if;
end $$;

create unique index if not exists argus_members_normalized_email_uidx
  on public.argus_members (normalized_email);

create or replace function public.sync_argus_member_normalized_email()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(btrim(auth_user.email))
  into v_email
  from auth.users auth_user
  where auth_user.id = new.user_id
    and auth_user.deleted_at is null;

  if v_email is null then
    raise exception 'active Auth email required for ARGUS membership';
  end if;
  new.normalized_email := v_email;
  return new;
end;
$$;

drop trigger if exists argus_members_sync_normalized_email on public.argus_members;
create trigger argus_members_sync_normalized_email
  before insert or update on public.argus_members
  for each row execute function public.sync_argus_member_normalized_email();

create table if not exists public.auth_request_limits (
  scope              text not null check (scope in ('signin_ip', 'signin_email')),
  key_hash           text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at  timestamptz not null,
  attempts           integer not null check (attempts > 0),
  updated_at         timestamptz not null,
  primary key (scope, key_hash)
);

create index if not exists auth_request_limits_updated_idx
  on public.auth_request_limits (updated_at);

alter table public.auth_request_limits enable row level security;

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

revoke all on table public.auth_request_limits from public, anon, authenticated;
grant select, insert, update on table public.auth_request_limits to service_role;

revoke all on function public.sync_argus_member_normalized_email()
  from public, anon, authenticated;
grant execute on function public.sync_argus_member_normalized_email()
  to service_role;

revoke all on function public.consume_auth_request_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_auth_request_limit(text, text, integer, integer)
  to service_role;
