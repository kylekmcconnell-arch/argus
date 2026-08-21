-- Waitlist identities, public names, credit consumption, and waitlist signup
-- staging. Additive. Product membership stays server-owned.

alter table public.referral_profiles
  alter column organization_id drop not null;

alter table public.referral_profiles
  add column if not exists public_name text;

alter table public.referral_profiles
  add column if not exists status text;

update public.referral_profiles profile
set public_name = coalesce(
  nullif(btrim(member.display_name), ''),
  'Investigator'
)
from public.argus_members member
where member.user_id = profile.user_id
  and profile.public_name is null;

update public.referral_profiles
set public_name = 'Investigator'
where public_name is null or btrim(public_name) = '';

update public.referral_profiles
set status = 'admitted'
where status is null and organization_id is not null;

update public.referral_profiles
set status = 'waitlist'
where status is null;

alter table public.referral_profiles
  alter column public_name set not null;

alter table public.referral_profiles
  alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'referral_profiles_public_name_check'
      and conrelid = 'public.referral_profiles'::regclass
  ) then
    alter table public.referral_profiles
      add constraint referral_profiles_public_name_check
      check (char_length(btrim(public_name)) between 2 and 40);
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'referral_profiles_status_check'
      and conrelid = 'public.referral_profiles'::regclass
  ) then
    alter table public.referral_profiles
      add constraint referral_profiles_status_check
      check (status in ('waitlist', 'admitted', 'declined'));
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'referral_profiles_admitted_org_check'
      and conrelid = 'public.referral_profiles'::regclass
  ) then
    alter table public.referral_profiles
      add constraint referral_profiles_admitted_org_check
      check (
        (status = 'admitted' and organization_id is not null)
        or status in ('waitlist', 'declined')
      );
  end if;
end $$;

create table if not exists public.waitlist_signups (
  normalized_email text primary key
    check (
      normalized_email = lower(btrim(normalized_email))
      and char_length(normalized_email) between 3 and 320
      and normalized_email like '%@%'
    ),
  public_name text not null check (char_length(btrim(public_name)) between 2 and 40),
  referral_code text check (referral_code is null or referral_code ~ '^[A-Z0-9]{8,20}$'),
  created_at timestamptz not null default now()
);

alter table public.waitlist_signups enable row level security;
revoke all on table public.waitlist_signups from public, anon, authenticated;
grant all on table public.waitlist_signups to service_role;

create or replace function public.claim_referral(
  p_referred_user_id uuid,
  p_code text,
  p_bonus_millis bigint default 2000
)
returns table(referrer_user_id uuid, granted_millis bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_referrer uuid;
  v_org uuid;
  v_inserted uuid;
  v_bonus bigint := 0;
begin
  if p_bonus_millis < 0 or p_bonus_millis > 100000 then
    raise exception 'invalid referral bonus';
  end if;

  select rp.user_id, rp.organization_id
    into v_referrer, v_org
  from public.referral_profiles rp
  where rp.code = upper(trim(p_code))
    and rp.status in ('waitlist', 'admitted')
  limit 1;

  if v_referrer is null then
    return;
  end if;
  if v_referrer = p_referred_user_id then
    raise exception 'self referral is not allowed';
  end if;

  insert into public.referral_attributions (
    referred_user_id, referrer_user_id, referral_code
  ) values (
    p_referred_user_id, v_referrer, upper(trim(p_code))
  )
  on conflict (referred_user_id) do nothing
  returning referred_user_id into v_inserted;

  if v_inserted is null then
    return;
  end if;

  if p_bonus_millis > 0 and v_org is not null then
    insert into public.credit_ledger (
      organization_id, user_id, amount_millis, reason, idempotency_key, metadata
    ) values (
      v_org,
      v_referrer,
      p_bonus_millis,
      'referral_reward',
      'referral:' || p_referred_user_id::text,
      jsonb_build_object('referredUserId', p_referred_user_id)
    )
    on conflict (organization_id, idempotency_key) do nothing;
    v_bonus := p_bonus_millis;
  end if;

  return query select v_referrer, v_bonus;
end;
$$;

create or replace function public.consume_investigation_credit(
  p_organization_id uuid,
  p_user_id uuid,
  p_idempotency_key text,
  p_cost_millis bigint default 1000
)
returns table(allowed boolean, balance_millis bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_balance bigint;
  v_existing bigint;
begin
  if p_cost_millis < 1 or p_cost_millis > 100000 then
    raise exception 'invalid credit cost';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    raise exception 'invalid credit idempotency key';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_organization_id::text),
    hashtext(p_user_id::text)
  );

  select amount_millis
    into v_existing
  from public.credit_ledger
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key
  limit 1;

  if v_existing is not null then
    select coalesce(sum(amount_millis), 0)
      into v_balance
    from public.credit_ledger
    where organization_id = p_organization_id
      and user_id = p_user_id;
    return query select true, v_balance;
    return;
  end if;

  select coalesce(sum(amount_millis), 0)
    into v_balance
  from public.credit_ledger
  where organization_id = p_organization_id
    and user_id = p_user_id;

  if v_balance < p_cost_millis then
    return query select false, v_balance;
    return;
  end if;

  insert into public.credit_ledger (
    organization_id, user_id, amount_millis, reason, idempotency_key, metadata
  ) values (
    p_organization_id,
    p_user_id,
    -p_cost_millis,
    'investigation_debit',
    p_idempotency_key,
    jsonb_build_object('userId', p_user_id)
  );

  return query select true, v_balance - p_cost_millis;
end;
$$;

revoke all on function public.consume_investigation_credit(uuid, uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.consume_investigation_credit(uuid, uuid, text, bigint)
  to service_role;
