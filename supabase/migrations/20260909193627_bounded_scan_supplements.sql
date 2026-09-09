begin;
create table public.scan_supplement_claims (
  receipt_id uuid not null references public.scan_run_receipts(id) on delete cascade,
  route text not null check (route in ('/api/social-activity', '/api/x-authenticity')),
  claimed_at timestamptz not null default now(),
  primary key (receipt_id, route)
);
alter table public.scan_supplement_claims enable row level security;
revoke all on table public.scan_supplement_claims from public, anon, authenticated;
grant select, insert on table public.scan_supplement_claims to service_role;
-- A paid scan may admit each required token helper once. This is not a reusable
-- bearer capability: the authenticated user, workspace, subject and live run
-- must all match, and a row lock serializes concurrent attempts.
create function public.claim_scan_supplement(p_organization_id uuid, p_user_id uuid, p_run_key text, p_route text, p_subject text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare r public.scan_run_receipts; normalized text;
begin
  if p_route not in ('/api/social-activity', '/api/x-authenticity') then return false; end if;
  select * into r from public.scan_run_receipts
    where organization_id = p_organization_id and run_key = p_run_key and initiated_by = p_user_id
      and status = 'running' and kind in ('token', 'investigation') and credits_charged_millis > 0
      and created_at > now() - interval '10 minutes' for update;
  if not found then return false; end if;
  normalized := case when p_subject ~* '^0x[0-9a-f]{40}$' then lower(p_subject) else p_subject end;
  if normalized is null or normalized = '' or normalized <> (case when r.canonical_ref ~* '^0x[0-9a-f]{40}$' then lower(r.canonical_ref) else r.canonical_ref end) then return false; end if;
  insert into public.scan_supplement_claims(receipt_id, route) values (r.id, p_route) on conflict do nothing;
  return found;
end $$;
revoke all on function public.claim_scan_supplement(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_scan_supplement(uuid, uuid, text, text, text) to service_role;
commit;
