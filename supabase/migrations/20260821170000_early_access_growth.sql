-- Early-access growth, metered credits, referrals, and Claude feedback queue.
-- Additive only. Every table is server-mediated and locked away from the Data API.

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  amount_millis bigint not null check (amount_millis <> 0),
  reason text not null check (reason in (
    'beta_start', 'subscription_grant', 'credit_purchase', 'referral_reward',
    'investigation_debit', 'refund', 'manual_adjustment'
  )),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index credit_ledger_org_created_idx
  on public.credit_ledger (organization_id, created_at desc);
create index credit_ledger_user_created_idx
  on public.credit_ledger (user_id, created_at desc);

create table public.referral_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null unique check (code ~ '^[A-Z0-9]{8,20}$'),
  created_at timestamptz not null default now()
);
create index referral_profiles_org_idx on public.referral_profiles (organization_id);

create table public.referral_attributions (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete restrict,
  referral_code text not null,
  qualified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_user_id)
);
create index referral_attributions_referrer_idx
  on public.referral_attributions (referrer_user_id, qualified_at desc);

create table public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete restrict,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  source_invoice_id text not null unique,
  subscription_revenue_cents integer not null check (subscription_revenue_cents >= 0),
  commission_bps integer not null default 2000 check (commission_bps between 0 and 10000),
  commission_cents integer not null check (commission_cents >= 0),
  credit_cents integer not null check (credit_cents >= 0),
  cash_cents integer not null check (cash_cents >= 0),
  cash_status text not null default 'held' check (cash_status in ('held','eligible','paid','reversed')),
  created_at timestamptz not null default now(),
  check (credit_cents + cash_cents = commission_cents)
);
create index referral_commissions_referrer_idx
  on public.referral_commissions (referrer_user_id, created_at desc);

create table public.feedback_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  assigned_agent text not null default 'claude' check (assigned_agent in ('claude','human')),
  status text not null default 'todo' check (status in ('todo','planned','in_progress','done','wont_do')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  route text not null default '/',
  report_version_id uuid references public.report_versions(id) on delete set null,
  body text not null check (char_length(body) between 8 and 4000),
  context jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_items_org_status_idx
  on public.feedback_items (organization_id, status, created_at desc);

alter table public.credit_ledger enable row level security;
alter table public.referral_profiles enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.referral_commissions enable row level security;
alter table public.feedback_items enable row level security;

revoke all on table public.credit_ledger from public, anon, authenticated;
revoke all on table public.referral_profiles from public, anon, authenticated;
revoke all on table public.referral_attributions from public, anon, authenticated;
revoke all on table public.referral_commissions from public, anon, authenticated;
revoke all on table public.feedback_items from public, anon, authenticated;
grant all on table public.credit_ledger to service_role;
grant all on table public.referral_profiles to service_role;
grant all on table public.referral_attributions to service_role;
grant all on table public.referral_commissions to service_role;
grant all on table public.feedback_items to service_role;

create function public.claim_referral(
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
begin
  if p_bonus_millis < 0 or p_bonus_millis > 100000 then
    raise exception 'invalid referral bonus';
  end if;

  select rp.user_id, rp.organization_id
    into v_referrer, v_org
  from public.referral_profiles rp
  join public.argus_members m on m.user_id = rp.user_id
  where rp.code = upper(trim(p_code))
    and m.active
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

  if p_bonus_millis > 0 then
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
  end if;

  return query select v_referrer, p_bonus_millis;
end;
$$;

revoke all on function public.claim_referral(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.claim_referral(uuid, text, bigint)
  to service_role;
