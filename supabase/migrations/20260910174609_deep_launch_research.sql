begin;
create table public.deep_launch_runs (
 run_id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 report_version_id uuid not null,
 initiated_by uuid references auth.users(id) on delete set null,
 tool_version text not null,
 state text not null default 'running' check(state in ('running','completed','failed')),
 result jsonb check(result is null or octet_length(result::text) <= 1000000),
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 foreign key (organization_id,report_version_id) references public.report_versions(organization_id,id),
 check((state='running' and finished_at is null) or (state<>'running' and finished_at is not null))
);
create index deep_launch_runs_version_idx on public.deep_launch_runs(organization_id,report_version_id,started_at desc);
create unique index deep_launch_runs_one_active on public.deep_launch_runs(organization_id,report_version_id,tool_version) where state='running';
alter table public.deep_launch_runs enable row level security;
revoke all on public.deep_launch_runs from public,anon,authenticated;
grant select,insert,update on public.deep_launch_runs to service_role;

create function public.claim_deep_launch(p_org uuid,p_version uuid,p_user uuid,p_tool text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare claimed uuid;
begin
 if not exists(select 1 from public.argus_members where organization_id=p_org and user_id=p_user and active and role in ('analyst','owner')) then
   raise exception 'active investigator membership required';
 end if;
 if not exists(select 1 from public.report_versions v join public.cases c on c.id=v.case_id and c.organization_id=v.organization_id
   where v.id=p_version and v.organization_id=p_org and c.status='open' and c.kind in ('token','investigation')
   and public.argus_token_identity(c.kind,v.payload) like 'robinhood:0x%') then
   raise exception 'active Robinhood report required';
 end if;
 if p_tool <> 'robinhood-launch-v1' then raise exception 'unsupported research version'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||p_version::text||p_tool,0));
 if exists(select 1 from public.deep_launch_runs where organization_id=p_org and report_version_id=p_version and tool_version=p_tool and
   (state='completed' or (state='running' and started_at > now()-interval '2 minutes'))) then return null; end if;
 update public.deep_launch_runs set state='failed',finished_at=now() where organization_id=p_org and report_version_id=p_version and tool_version=p_tool and state='running';
 insert into public.deep_launch_runs(organization_id,report_version_id,initiated_by,tool_version) values(p_org,p_version,p_user,p_tool) returning run_id into claimed;
 return claimed;
end $$;
revoke all on function public.claim_deep_launch(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_deep_launch(uuid,uuid,uuid,text) to service_role;
commit;
