begin;
-- Imported provider observations are evidence, never verified beneficial ownership.
create table public.fomo_wallet_observations (
  organization_id uuid not null references public.organizations(id),
  chain text not null check (length(chain) between 1 and 40 and chain <> 'evm'),
  address text not null check (length(address) between 10 and 128),
  captured_at timestamptz not null,
  source_url text not null,
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('reported','unlabelled')),
  label text,
  twitter text,
  imported_at timestamptz not null default now(),
  primary key (organization_id, chain, address, captured_at, receipt_hash),
  check (state <> 'reported' or (label is not null and length(trim(label)) between 1 and 200)),
  check (captured_at <= imported_at)
);
alter table public.fomo_wallet_observations enable row level security;
revoke all on public.fomo_wallet_observations from public, anon, authenticated;
grant select, insert on public.fomo_wallet_observations to service_role;
create index fomo_wallet_scope on public.fomo_wallet_observations(organization_id, chain, address, captured_at desc);
create function public.reject_fomo_observation_change() returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Fomo observations are immutable; append a new dated receipt';
end;
$$;
create trigger immutable_fomo_observation before update or delete on public.fomo_wallet_observations
for each row execute function public.reject_fomo_observation_change();
commit;
