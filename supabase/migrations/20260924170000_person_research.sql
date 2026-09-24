begin;
-- Supplemental receipts never overwrite the parent frozen report or mint graph edges.
create table public.person_research_runs (
  id uuid primary key,
  organization_id uuid not null,
  report_version_id uuid not null references public.report_versions(id),
  member_key text not null,
  identity_key text,
  status text not null check (status in ('running','complete','failed')),
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.person_research_runs enable row level security;
revoke all on public.person_research_runs from public, anon, authenticated;
grant select, insert, update on public.person_research_runs to service_role;
create index person_research_scope on public.person_research_runs (organization_id, report_version_id, member_key, created_at desc);
create index person_research_identity on public.person_research_runs (organization_id, identity_key, created_at desc) where identity_key is not null;
create function public.guard_person_research_run() returns trigger language plpgsql set search_path=public as $$
begin
  if TG_OP = 'INSERT' then
    if not exists (select 1 from public.report_versions r where r.id = new.report_version_id and r.organization_id = new.organization_id) then
      raise exception 'person research requires an exact report in the same organization';
    end if;
  elsif old.status <> 'running' or new.id <> old.id or new.organization_id <> old.organization_id
    or new.identity_key is distinct from old.identity_key or new.report_version_id <> old.report_version_id or new.member_key <> old.member_key or new.created_at <> old.created_at then
    raise exception 'person research completion is immutable';
  end if;
  return new;
end;
$$;
create trigger guard_person_research before insert or update on public.person_research_runs
for each row execute function public.guard_person_research_run();
commit;
