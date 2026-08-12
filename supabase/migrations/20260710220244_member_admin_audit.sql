-- Owner-managed workspace invitations, roles, and access history.

create table public.member_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  target_user_id    uuid references auth.users(id) on delete set null,
  target_email      text not null check (char_length(target_email) between 3 and 320),
  actor_user_id     uuid references auth.users(id) on delete set null,
  event_type        text not null check (event_type in (
                      'member.invited',
                      'member.access_granted',
                      'member.role_changed',
                      'member.access_disabled',
                      'member.access_enabled',
                      'member.profile_updated'
                    )),
  previous_state    jsonb not null default '{}'::jsonb,
  next_state        jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index member_events_org_created_idx
  on public.member_events (organization_id, created_at desc);

alter table public.member_events enable row level security;

create policy member_events_read_owner on public.member_events
  for select to authenticated
  using (organization_id in (
    select m.organization_id
    from public.argus_members m
    where m.user_id = (select auth.uid())
      and m.active
      and m.role = 'owner'
  ));

-- Keep membership mutation and its audit event in the same transaction. The
-- function is deliberately SECURITY INVOKER and executable only by the server
-- role; it still verifies that the supplied actor is an active owner.
create function public.manage_member_access(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_target_email text,
  p_role text,
  p_display_name text,
  p_active boolean,
  p_event_type text
)
returns public.argus_members
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous public.argus_members;
  v_next public.argus_members;
  v_actor_is_owner boolean;
begin
  if p_role not in ('owner', 'analyst', 'viewer') then
    raise exception 'invalid member role';
  end if;
  if p_event_type not in (
    'member.invited',
    'member.access_granted',
    'member.role_changed',
    'member.access_disabled',
    'member.access_enabled',
    'member.profile_updated'
  ) then
    raise exception 'invalid member event';
  end if;
  if char_length(trim(p_target_email)) not between 3 and 320 then
    raise exception 'invalid member email';
  end if;
  if char_length(trim(p_display_name)) not between 1 and 80 then
    raise exception 'invalid display name';
  end if;

  select exists (
    select 1
    from public.argus_members m
    where m.organization_id = p_organization_id
      and m.user_id = p_actor_user_id
      and m.active
      and m.role = 'owner'
  ) into v_actor_is_owner;
  if not v_actor_is_owner then
    raise exception 'active owner access required';
  end if;

  if p_target_user_id = p_actor_user_id
     and (not p_active or p_role <> 'owner') then
    raise exception 'owners cannot remove their own owner access';
  end if;

  select m.* into v_previous
  from public.argus_members m
  where m.organization_id = p_organization_id
    and m.user_id = p_target_user_id
  for update;

  insert into public.argus_members (
    user_id, organization_id, role, display_name, active
  ) values (
    p_target_user_id,
    p_organization_id,
    p_role,
    trim(p_display_name),
    p_active
  )
  on conflict (user_id) do update set
    role = excluded.role,
    display_name = excluded.display_name,
    active = excluded.active,
    updated_at = now()
  where public.argus_members.organization_id = excluded.organization_id
  returning * into v_next;

  if v_next.user_id is null then
    raise exception 'user already belongs to another organization';
  end if;

  insert into public.member_events (
    organization_id,
    target_user_id,
    target_email,
    actor_user_id,
    event_type,
    previous_state,
    next_state
  ) values (
    p_organization_id,
    p_target_user_id,
    lower(trim(p_target_email)),
    p_actor_user_id,
    p_event_type,
    case
      when v_previous.user_id is null then '{}'::jsonb
      else jsonb_build_object(
        'role', v_previous.role,
        'displayName', v_previous.display_name,
        'active', v_previous.active
      )
    end,
    jsonb_build_object(
      'role', v_next.role,
      'displayName', v_next.display_name,
      'active', v_next.active
    )
  );

  return v_next;
end;
$$;

revoke all on table public.member_events from anon, authenticated;
grant select on table public.member_events to authenticated;
grant all on table public.member_events to service_role;

revoke all on function public.manage_member_access(uuid, uuid, uuid, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.manage_member_access(uuid, uuid, uuid, text, text, text, boolean, text)
  to service_role;
