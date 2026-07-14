-- The service_role API can mutate argus_members but intentionally cannot read
-- auth.users directly. Keep the row-bound email sync in a private,
-- SECURITY DEFINER trigger so membership writes work without broadening the
-- service role's Auth schema privileges.

drop trigger if exists argus_members_sync_normalized_email on public.argus_members;
drop function if exists public.sync_argus_member_normalized_email();

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.sync_argus_member_normalized_email()
returns trigger
language plpgsql
security definer
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

revoke all on function private.sync_argus_member_normalized_email()
  from public, anon, authenticated;
grant execute on function private.sync_argus_member_normalized_email()
  to service_role;

create trigger argus_members_sync_normalized_email
  before insert or update on public.argus_members
  for each row execute function private.sync_argus_member_normalized_email();
