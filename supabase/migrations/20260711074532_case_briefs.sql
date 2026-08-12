-- Collaborative case briefs
--
-- Adds a mutable decision-brief head per exact case, immutable revision history,
-- and append-only analyst notes. All mutations are serialized with the same
-- per-case advisory lock used by report persistence and case lifecycle changes.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Brief content is intentionally structured so API clients cannot turn this
-- private decision surface into an unbounded arbitrary document store.
create or replace function public.is_valid_case_brief_content(p_content jsonb)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_key text;
  v_item jsonb;
  v_value text;
begin
  if pg_catalog.jsonb_typeof(p_content) <> 'object'
     or pg_catalog.octet_length(p_content::text) > 65536 then
    return false;
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_object_keys(p_content)
  ) <> 6
  or exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_content) as content_key(key_name)
    where content_key.key_name not in (
      'summary',
      'strongestEvidence',
      'highestRisks',
      'unresolvedQuestions',
      'changeConditions',
      'nextActions'
    )
  ) then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_content -> 'summary') <> 'string'
     or pg_catalog.char_length(p_content ->> 'summary') > 4000 then
    return false;
  end if;

  foreach v_key in array array[
    'strongestEvidence',
    'highestRisks',
    'unresolvedQuestions',
    'changeConditions',
    'nextActions'
  ]
  loop
    if pg_catalog.jsonb_typeof(p_content -> v_key) <> 'array'
       or pg_catalog.jsonb_array_length(p_content -> v_key) > 20 then
      return false;
    end if;

    for v_item in
      select element.value
      from pg_catalog.jsonb_array_elements(p_content -> v_key) as element(value)
    loop
      if pg_catalog.jsonb_typeof(v_item) <> 'string' then
        return false;
      end if;

      v_value := v_item #>> '{}';
      if v_value is null
         or v_value <> pg_catalog.btrim(v_value)
         or pg_catalog.char_length(v_value) < 1
         or pg_catalog.char_length(v_value) > 2000 then
        return false;
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

-- Tenant identity is enforced structurally, not only inside the RPCs. These
-- composite keys make it impossible for a service-role insert to pair a case
-- with another organization's row or anchor it to another case's version.
alter table public.cases
  add constraint cases_organization_id_id_key
  unique (organization_id, id);

alter table public.report_versions
  add constraint report_versions_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.cases (organization_id, id)
  on delete cascade;

alter table public.report_versions
  add constraint report_versions_organization_case_id_key
  unique (organization_id, case_id, id);

create table public.case_briefs (
  case_id                   uuid primary key,
  organization_id           uuid not null,
  anchor_report_version_id  uuid not null,
  revision                  integer not null check (revision > 0),
  recommendation            text not null
                            check (recommendation in ('undecided', 'advance', 'monitor', 'decline')),
  assignee_user_id           uuid references auth.users(id) on delete set null,
  assignee_label             text check (
                              (assignee_user_id is null or assignee_label is not null)
                              and (
                                assignee_label is null
                                or char_length(assignee_label) between 1 and 120
                              )
                            ),
  due_at                     timestamptz,
  content                    jsonb not null
                            check (public.is_valid_case_brief_content(content)),
  created_by                 uuid references auth.users(id) on delete set null,
  created_by_label           text not null
                            check (char_length(created_by_label) between 1 and 120),
  created_at                 timestamptz not null default now(),
  updated_by                 uuid references auth.users(id) on delete set null,
  updated_by_label           text not null
                            check (char_length(updated_by_label) between 1 and 120),
  updated_at                 timestamptz not null default now(),
  constraint case_briefs_case_fkey
    foreign key (organization_id, case_id)
    references public.cases (organization_id, id)
    on delete cascade,
  constraint case_briefs_anchor_fkey
    foreign key (organization_id, case_id, anchor_report_version_id)
    references public.report_versions (organization_id, case_id, id)
    on delete no action deferrable initially immediate
);

create table public.case_brief_revisions (
  id                        uuid primary key default gen_random_uuid(),
  case_id                   uuid not null,
  organization_id           uuid not null,
  anchor_report_version_id  uuid not null,
  revision                  integer not null check (revision > 0),
  recommendation            text not null
                            check (recommendation in ('undecided', 'advance', 'monitor', 'decline')),
  assignee_user_id          uuid references auth.users(id) on delete set null,
  assignee_label            text check (
                              (assignee_user_id is null or assignee_label is not null)
                              and (
                                assignee_label is null
                                or char_length(assignee_label) between 1 and 120
                              )
                            ),
  due_at                    timestamptz,
  content                   jsonb not null
                            check (public.is_valid_case_brief_content(content)),
  created_by                uuid references auth.users(id) on delete set null,
  created_by_label          text not null
                            check (char_length(created_by_label) between 1 and 120),
  created_at                timestamptz not null default now(),
  unique (case_id, revision),
  constraint case_brief_revisions_case_fkey
    foreign key (organization_id, case_id)
    references public.cases (organization_id, id)
    on delete cascade,
  constraint case_brief_revisions_anchor_fkey
    foreign key (organization_id, case_id, anchor_report_version_id)
    references public.report_versions (organization_id, case_id, id)
    on delete no action deferrable initially immediate
);

create table public.case_notes (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null,
  organization_id   uuid not null,
  client_id         uuid not null,
  body              text not null check (
                      body = btrim(body)
                      and char_length(body) between 1 and 10000
                      and octet_length(body) <= 10000
                    ),
  created_by        uuid references auth.users(id) on delete set null,
  created_by_label  text not null
                    check (char_length(created_by_label) between 1 and 120),
  created_at        timestamptz not null default now(),
  constraint case_notes_org_client_id_key unique (organization_id, client_id),
  constraint case_notes_case_fkey
    foreign key (organization_id, case_id)
    references public.cases (organization_id, id)
    on delete cascade
);

-- Every foreign key is backed by a leading-column index. The compound indexes
-- also cover the case drawer's head/history/timeline reads.
create index case_briefs_org_updated_idx
  on public.case_briefs (organization_id, updated_at desc);
create index case_briefs_org_case_anchor_idx
  on public.case_briefs (organization_id, case_id, anchor_report_version_id);
create index case_briefs_anchor_idx
  on public.case_briefs (anchor_report_version_id);
create index case_briefs_assignee_idx
  on public.case_briefs (assignee_user_id);
create index case_briefs_created_by_idx
  on public.case_briefs (created_by);
create index case_briefs_updated_by_idx
  on public.case_briefs (updated_by);

create index case_brief_revisions_org_case_created_idx
  on public.case_brief_revisions (organization_id, case_id, created_at desc);
create index case_brief_revisions_org_case_anchor_idx
  on public.case_brief_revisions (organization_id, case_id, anchor_report_version_id);
create index case_brief_revisions_anchor_idx
  on public.case_brief_revisions (anchor_report_version_id);
create index case_brief_revisions_assignee_idx
  on public.case_brief_revisions (assignee_user_id);
create index case_brief_revisions_created_by_idx
  on public.case_brief_revisions (created_by);

create index case_notes_case_created_idx
  on public.case_notes (case_id, created_at desc);
create index case_notes_org_case_created_idx
  on public.case_notes (organization_id, case_id, created_at desc, id desc);
create index case_notes_org_created_idx
  on public.case_notes (organization_id, created_at desc);
create index case_notes_created_by_idx
  on public.case_notes (created_by);

comment on table public.case_briefs is
  'Mutable current decision brief, exactly one per case.';
comment on table public.case_brief_revisions is
  'Immutable case-brief snapshots; application roles receive INSERT and SELECT only.';
comment on table public.case_notes is
  'Append-only analyst notes with organization-scoped client UUID idempotency.';

-- Save a complete brief snapshot. Expected revision 0 creates the first head;
-- all later writes compare against the current revision. A changed anchor is
-- accepted only with explicit confirmation and must be the current active
-- report projection. An unchanged stale anchor remains editable so analysts can
-- deliberately preserve their decision basis until they choose to reanchor.
create or replace function public.save_case_brief(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_expected_revision integer,
  p_anchor_report_version_id uuid,
  p_allow_reanchor boolean,
  p_recommendation text,
  p_assignee_user_id uuid,
  p_due_at timestamptz,
  p_content jsonb
)
returns table (
  case_id uuid,
  organization_id uuid,
  anchor_report_version_id uuid,
  revision integer,
  recommendation text,
  assignee_user_id uuid,
  assignee_label text,
  due_at timestamptz,
  content jsonb,
  created_by uuid,
  created_by_label text,
  created_at timestamptz,
  updated_by uuid,
  updated_by_label text,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_label text;
  v_assignee_label text;
  v_kind text;
  v_ref text;
  v_case public.cases%rowtype;
  v_brief public.case_briefs%rowtype;
  v_has_brief boolean;
  v_active_anchor uuid;
  v_next_revision integer;
  v_reanchored boolean;
  v_now timestamptz := now();
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using
      errcode = '22023',
      message = 'expected revision must be a non-negative integer';
  end if;
  if p_allow_reanchor is null then
    raise exception using errcode = '22023', message = 'reanchor flag is required';
  end if;
  if p_recommendation is null
     or p_recommendation not in ('undecided', 'advance', 'monitor', 'decline') then
    raise exception using errcode = '22023', message = 'invalid case brief recommendation';
  end if;
  if p_content is null or not public.is_valid_case_brief_content(p_content) then
    raise exception using errcode = '22023', message = 'invalid case brief content';
  end if;

  select pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(m.display_name), ''),
      m.role || ':' || pg_catalog.left(m.user_id::text, 8)
    ),
    120
  )
  into v_actor_label
  from public.argus_members m
  where m.user_id = p_actor_user_id
    and m.organization_id = p_organization_id
    and m.active
    and m.role in ('owner', 'analyst')
  limit 1;

  if v_actor_label is null then
    raise exception using
      errcode = '42501',
      message = 'active analyst or owner access required';
  end if;

  select c.kind, c.canonical_ref
  into v_kind, v_ref
  from public.cases c
  where c.id = p_case_id
    and c.organization_id = p_organization_id
  limit 1;

  if v_kind is null or v_ref is null then
    raise exception using errcode = '22023', message = 'case not found in organization';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_kind || ':' || v_ref,
      0
    )
  );

  -- Re-read and row-lock only after acquiring the canonical lifecycle lock.
  select c.*
  into v_case
  from public.cases c
  where c.id = p_case_id
    and c.organization_id = p_organization_id
    and c.kind = v_kind
    and c.canonical_ref = v_ref
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'case not found in organization';
  end if;

  if v_case.status = 'archived' then
    raise exception using errcode = '55000', message = 'archived case brief is read-only';
  end if;

  select r.report_version_id
  into v_active_anchor
  from public.reports r
  join public.report_versions rv
    on rv.id = r.report_version_id
   and rv.case_id = v_case.id
   and rv.organization_id = p_organization_id
  where r.organization_id = p_organization_id
    and r.kind = v_case.kind
    and r.ref = v_case.canonical_ref
  limit 1;

  if p_assignee_user_id is not null then
    select pg_catalog.left(
      coalesce(
        nullif(pg_catalog.btrim(assignee.display_name), ''),
        assignee.role || ':' || pg_catalog.left(assignee.user_id::text, 8)
      ),
      120
    )
    into v_assignee_label
    from public.argus_members assignee
    where assignee.user_id = p_assignee_user_id
      and assignee.organization_id = p_organization_id
      and assignee.active
      and assignee.role in ('owner', 'analyst')
    limit 1;

    if v_assignee_label is null then
      raise exception using
        errcode = '22023',
        message = 'case brief assignee must be an active organization analyst or owner';
    end if;
  end if;

  select brief.*
  into v_brief
  from public.case_briefs brief
  where brief.case_id = p_case_id
  for update;
  v_has_brief := found;

  if not v_has_brief then
    if p_expected_revision <> 0 then
      raise exception using
        errcode = '40001',
        message = 'case brief revision conflict',
        detail = 'expected revision does not match missing brief revision 0';
    end if;
    if p_anchor_report_version_id is null
       or v_active_anchor is null
       or p_anchor_report_version_id is distinct from v_active_anchor then
      raise exception using
        errcode = '22023',
        message = 'case brief anchor must be current active report version';
    end if;

    v_next_revision := 1;

    insert into public.case_briefs (
      case_id,
      organization_id,
      anchor_report_version_id,
      revision,
      recommendation,
      assignee_user_id,
      assignee_label,
      due_at,
      content,
      created_by,
      created_by_label,
      created_at,
      updated_by,
      updated_by_label,
      updated_at
    ) values (
      p_case_id,
      p_organization_id,
      p_anchor_report_version_id,
      v_next_revision,
      p_recommendation,
      p_assignee_user_id,
      v_assignee_label,
      p_due_at,
      p_content,
      p_actor_user_id,
      v_actor_label,
      v_now,
      p_actor_user_id,
      v_actor_label,
      v_now
    );

    insert into public.case_brief_revisions (
      case_id,
      organization_id,
      anchor_report_version_id,
      revision,
      recommendation,
      assignee_user_id,
      assignee_label,
      due_at,
      content,
      created_by,
      created_by_label,
      created_at
    ) values (
      p_case_id,
      p_organization_id,
      p_anchor_report_version_id,
      v_next_revision,
      p_recommendation,
      p_assignee_user_id,
      v_assignee_label,
      p_due_at,
      p_content,
      p_actor_user_id,
      v_actor_label,
      v_now
    );

    insert into public.case_events (
      organization_id,
      case_id,
      report_version_id,
      actor_user_id,
      event_type,
      metadata,
      created_at
    ) values (
      p_organization_id,
      p_case_id,
      p_anchor_report_version_id,
      p_actor_user_id,
      'case.brief.created',
      pg_catalog.jsonb_build_object('revision', v_next_revision, 'reanchored', false),
      v_now
    );
  else
    if p_expected_revision is distinct from v_brief.revision then
      raise exception using
        errcode = '40001',
        message = 'case brief revision conflict',
        detail = pg_catalog.format(
          'expected revision %s but current revision is %s',
          p_expected_revision,
          v_brief.revision
        );
    end if;

    v_reanchored := p_anchor_report_version_id is distinct from v_brief.anchor_report_version_id;
    if v_reanchored and not p_allow_reanchor then
      raise exception using
        errcode = '22023',
        message = 'case brief reanchor requires explicit confirmation';
    end if;
    if v_reanchored and (
      p_anchor_report_version_id is null
      or v_active_anchor is null
      or p_anchor_report_version_id is distinct from v_active_anchor
    ) then
      raise exception using
        errcode = '22023',
        message = 'case brief anchor must be current active report version';
    end if;

    -- JSONB has a canonical byte representation. Distinctness across every
    -- persisted field makes an identical retry a true no-op: no head timestamp,
    -- revision row, or case event changes.
    if p_anchor_report_version_id is not distinct from v_brief.anchor_report_version_id
       and p_recommendation is not distinct from v_brief.recommendation
       and p_assignee_user_id is not distinct from v_brief.assignee_user_id
       and v_assignee_label is not distinct from v_brief.assignee_label
       and p_due_at is not distinct from v_brief.due_at
       and p_content is not distinct from v_brief.content then
      return query
      select
        brief.case_id,
        brief.organization_id,
        brief.anchor_report_version_id,
        brief.revision,
        brief.recommendation,
        brief.assignee_user_id,
        brief.assignee_label,
        brief.due_at,
        brief.content,
        brief.created_by,
        brief.created_by_label,
        brief.created_at,
        brief.updated_by,
        brief.updated_by_label,
        brief.updated_at
      from public.case_briefs brief
      where brief.case_id = p_case_id;
      return;
    end if;

    if v_brief.revision = 2147483647 then
      raise exception using errcode = '22003', message = 'case brief revision limit reached';
    end if;
    v_next_revision := v_brief.revision + 1;

    update public.case_briefs brief
    set anchor_report_version_id = p_anchor_report_version_id,
        revision = v_next_revision,
        recommendation = p_recommendation,
        assignee_user_id = p_assignee_user_id,
        assignee_label = v_assignee_label,
        due_at = p_due_at,
        content = p_content,
        updated_by = p_actor_user_id,
        updated_by_label = v_actor_label,
        updated_at = v_now
    where brief.case_id = p_case_id;

    insert into public.case_brief_revisions (
      case_id,
      organization_id,
      anchor_report_version_id,
      revision,
      recommendation,
      assignee_user_id,
      assignee_label,
      due_at,
      content,
      created_by,
      created_by_label,
      created_at
    ) values (
      p_case_id,
      p_organization_id,
      p_anchor_report_version_id,
      v_next_revision,
      p_recommendation,
      p_assignee_user_id,
      v_assignee_label,
      p_due_at,
      p_content,
      p_actor_user_id,
      v_actor_label,
      v_now
    );

    insert into public.case_events (
      organization_id,
      case_id,
      report_version_id,
      actor_user_id,
      event_type,
      metadata,
      created_at
    ) values (
      p_organization_id,
      p_case_id,
      p_anchor_report_version_id,
      p_actor_user_id,
      case when v_reanchored then 'case.brief.reanchored' else 'case.brief.updated' end,
      pg_catalog.jsonb_build_object(
        'revision', v_next_revision,
        'reanchored', v_reanchored
      ),
      v_now
    );
  end if;

  return query
  select
    brief.case_id,
    brief.organization_id,
    brief.anchor_report_version_id,
    brief.revision,
    brief.recommendation,
    brief.assignee_user_id,
    brief.assignee_label,
    brief.due_at,
    brief.content,
    brief.created_by,
    brief.created_by_label,
    brief.created_at,
    brief.updated_by,
    brief.updated_by_label,
    brief.updated_at
  from public.case_briefs brief
  where brief.case_id = p_case_id;
end;
$$;

-- Append an immutable note. An exact retry with the same organization-scoped
-- client UUID returns the original row; reusing that UUID for different content
-- is rejected rather than silently accepting a partial replay.
create or replace function public.append_case_note(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_case_id uuid,
  p_client_id uuid,
  p_body text
)
returns table (
  id uuid,
  case_id uuid,
  organization_id uuid,
  client_id uuid,
  body text,
  created_by uuid,
  created_by_label text,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_label text;
  v_kind text;
  v_ref text;
  v_case public.cases%rowtype;
  v_note public.case_notes%rowtype;
  v_inserted boolean;
  v_active_anchor uuid;
  v_now timestamptz := now();
begin
  if p_client_id is null then
    raise exception using errcode = '22023', message = 'case note client id is required';
  end if;
  if p_body is null
     or p_body <> pg_catalog.btrim(p_body)
     or pg_catalog.char_length(p_body) < 1
     or pg_catalog.char_length(p_body) > 10000
     or pg_catalog.octet_length(p_body) > 10000 then
    raise exception using errcode = '22023', message = 'invalid case note body';
  end if;

  select pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(m.display_name), ''),
      m.role || ':' || pg_catalog.left(m.user_id::text, 8)
    ),
    120
  )
  into v_actor_label
  from public.argus_members m
  where m.user_id = p_actor_user_id
    and m.organization_id = p_organization_id
    and m.active
    and m.role in ('owner', 'analyst')
  limit 1;

  if v_actor_label is null then
    raise exception using
      errcode = '42501',
      message = 'active analyst or owner access required';
  end if;

  select c.kind, c.canonical_ref
  into v_kind, v_ref
  from public.cases c
  where c.id = p_case_id
    and c.organization_id = p_organization_id
  limit 1;

  if v_kind is null or v_ref is null then
    raise exception using errcode = '22023', message = 'case not found in organization';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || v_kind || ':' || v_ref,
      0
    )
  );

  select c.*
  into v_case
  from public.cases c
  where c.id = p_case_id
    and c.organization_id = p_organization_id
    and c.kind = v_kind
    and c.canonical_ref = v_ref
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'case not found in organization';
  end if;

  -- Idempotency precedes lifecycle rejection. A client that successfully wrote
  -- a note and lost the response must be able to recover that exact immutable
  -- row even if an owner archived the case before the retry arrived.
  select note.*
  into v_note
  from public.case_notes note
  where note.organization_id = p_organization_id
    and note.client_id = p_client_id;

  if found then
    if v_note.case_id is distinct from p_case_id
       or v_note.body is distinct from p_body
       or v_note.created_by is distinct from p_actor_user_id then
      raise exception using
        errcode = '23505',
        message = 'case note client id already exists with different immutable content';
    end if;

    return query
    select
      v_note.id,
      v_note.case_id,
      v_note.organization_id,
      v_note.client_id,
      v_note.body,
      v_note.created_by,
      v_note.created_by_label,
      v_note.created_at;
    return;
  end if;

  if v_case.status = 'archived' then
    raise exception using errcode = '55000', message = 'archived case brief is read-only';
  end if;

  insert into public.case_notes (
    case_id,
    organization_id,
    client_id,
    body,
    created_by,
    created_by_label,
    created_at
  ) values (
    p_case_id,
    p_organization_id,
    p_client_id,
    p_body,
    p_actor_user_id,
    v_actor_label,
    v_now
  )
  on conflict on constraint case_notes_org_client_id_key do nothing
  returning public.case_notes.* into v_note;
  v_inserted := found;

  if not v_inserted then
    select note.*
    into v_note
    from public.case_notes note
    where note.organization_id = p_organization_id
      and note.client_id = p_client_id;

    if v_note.id is null
       or v_note.case_id is distinct from p_case_id
       or v_note.body is distinct from p_body
       or v_note.created_by is distinct from p_actor_user_id then
      raise exception using
        errcode = '23505',
        message = 'case note client id already exists with different immutable content';
    end if;
  else
    select r.report_version_id
    into v_active_anchor
    from public.reports r
    join public.report_versions rv
      on rv.id = r.report_version_id
     and rv.case_id = v_case.id
     and rv.organization_id = p_organization_id
    where r.organization_id = p_organization_id
      and r.kind = v_case.kind
      and r.ref = v_case.canonical_ref
    limit 1;

    insert into public.case_events (
      organization_id,
      case_id,
      report_version_id,
      actor_user_id,
      event_type,
      metadata,
      created_at
    ) values (
      p_organization_id,
      p_case_id,
      v_active_anchor,
      p_actor_user_id,
      'case.note.added',
      pg_catalog.jsonb_build_object('noteId', v_note.id),
      v_now
    );
  end if;

  return query
  select
    v_note.id,
    v_note.case_id,
    v_note.organization_id,
    v_note.client_id,
    v_note.body,
    v_note.created_by,
    v_note.created_by_label,
    v_note.created_at;
end;
$$;

-- Read the complete viewer state in one STABLE database snapshot. This avoids
-- combining a head, history, note timeline, and active report version observed
-- at different moments across parallel REST requests.
create or replace function public.get_case_brief_snapshot(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_case_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_actor_role text;
  v_snapshot jsonb;
begin
  select member.role
  into v_actor_role
  from public.argus_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_user_id
    and member.active
  limit 1;

  if v_actor_role is null then
    raise exception using
      errcode = '42501',
      message = 'active organization member access required';
  end if;

  select pg_catalog.jsonb_build_object(
    'case', pg_catalog.jsonb_build_object(
      'id', case_row.id,
      'organization_id', case_row.organization_id,
      'kind', case_row.kind,
      'canonical_ref', case_row.canonical_ref,
      'display_query', case_row.display_query,
      'status', case_row.status,
      'updated_at', case_row.updated_at,
      'current_report_version_id', published.report_version_id
    ),
    'viewer', pg_catalog.jsonb_build_object(
      'user_id', p_actor_user_id,
      'role', v_actor_role,
      'can_edit', case_row.status = 'open' and v_actor_role in ('owner', 'analyst')
    ),
    'current_version', case
      when current_version.id is null then 'null'::jsonb
      else pg_catalog.jsonb_build_object(
        'id', current_version.id,
        'case_id', current_version.case_id,
        'organization_id', current_version.organization_id,
        'version', current_version.version,
        'verdict', current_version.verdict,
        'score', current_version.score,
        'completeness_state', current_version.completeness_state,
        'attestation_state', current_version.attestation_state,
        'methodology_version', current_version.methodology_version,
        'contributor_label', current_version.contributor_label,
        'created_at', current_version.created_at
      )
    end,
    'anchor_versions', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', anchor_version.id,
            'case_id', anchor_version.case_id,
            'organization_id', anchor_version.organization_id,
            'version', anchor_version.version,
            'verdict', anchor_version.verdict,
            'score', anchor_version.score,
            'completeness_state', anchor_version.completeness_state,
            'attestation_state', anchor_version.attestation_state,
            'methodology_version', anchor_version.methodology_version,
            'contributor_label', anchor_version.contributor_label,
            'created_at', anchor_version.created_at
          )
          order by anchor_version.version desc
        ),
        '[]'::jsonb
      )
      from public.report_versions anchor_version
      where anchor_version.organization_id = p_organization_id
        and anchor_version.case_id = p_case_id
        and anchor_version.id in (
          select brief.anchor_report_version_id
          from public.case_briefs brief
          where brief.organization_id = p_organization_id
            and brief.case_id = p_case_id
          union
          select loaded.anchor_report_version_id
          from (
            select revision.anchor_report_version_id
            from public.case_brief_revisions revision
            where revision.organization_id = p_organization_id
              and revision.case_id = p_case_id
            order by revision.revision desc
            limit 10
          ) loaded
          union
          select published.report_version_id
          where published.report_version_id is not null
        )
    ),
    'brief', (
      select pg_catalog.to_jsonb(brief)
      from public.case_briefs brief
      where brief.organization_id = p_organization_id
        and brief.case_id = p_case_id
    ),
    'revisions', (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(history) order by history.revision desc),
        '[]'::jsonb
      )
      from (
        select revision.*
        from public.case_brief_revisions revision
        where revision.organization_id = p_organization_id
          and revision.case_id = p_case_id
        order by revision.revision desc
        limit 10
      ) history
    ),
    'has_older_revisions', (
      select exists (
        select 1
        from public.case_brief_revisions older_revision
        where older_revision.organization_id = p_organization_id
          and older_revision.case_id = p_case_id
        order by older_revision.revision desc
        offset 10
        limit 1
      )
    ),
    'notes', (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(timeline) order by timeline.created_at desc, timeline.id desc),
        '[]'::jsonb
      )
      from (
        select note.*
        from public.case_notes note
        where note.organization_id = p_organization_id
          and note.case_id = p_case_id
        order by note.created_at desc, note.id desc
        limit 20
      ) timeline
    ),
    'has_older_notes', (
      select exists (
        select 1
        from public.case_notes older_note
        where older_note.organization_id = p_organization_id
          and older_note.case_id = p_case_id
        order by older_note.created_at desc, older_note.id desc
        offset 20
        limit 1
      )
    ),
    'assignees', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'user_id', safe_assignee.user_id,
            'display_name', safe_assignee.display_name,
            'role', safe_assignee.role
          )
          order by safe_assignee.display_name, safe_assignee.user_id
        ),
        '[]'::jsonb
      )
      from (
        select
          member.user_id,
          member.role,
          pg_catalog.left(
            coalesce(
              nullif(pg_catalog.btrim(member.display_name), ''),
              member.role || ':' || pg_catalog.left(member.user_id::text, 8)
            ),
            120
          ) as display_name
        from public.argus_members member
        where member.organization_id = p_organization_id
          and member.active
          and member.role in ('owner', 'analyst')
        order by display_name, member.user_id
        limit 100
      ) safe_assignee
    )
  )
  into v_snapshot
  from public.cases case_row
  left join lateral (
    select case
      when case_row.status = 'open' then (
        select projection.report_version_id
        from public.reports projection
        join public.report_versions version_row
          on version_row.id = projection.report_version_id
         and version_row.organization_id = case_row.organization_id
         and version_row.case_id = case_row.id
        where projection.organization_id = case_row.organization_id
          and projection.kind = case_row.kind
          and projection.ref = case_row.canonical_ref
        limit 1
      )
      else (
        select event.report_version_id
        from public.case_events event
        join public.report_versions version_row
          on version_row.id = event.report_version_id
         and version_row.organization_id = case_row.organization_id
         and version_row.case_id = case_row.id
        where event.organization_id = case_row.organization_id
          and event.case_id = case_row.id
          and event.event_type in (
            'report.version.activated',
            'report.version.backfilled',
            'case.restored'
          )
        order by event.created_at desc, event.id desc
        limit 1
      )
    end as report_version_id
  ) published on true
  left join public.report_versions current_version
    on current_version.id = published.report_version_id
   and current_version.organization_id = case_row.organization_id
   and current_version.case_id = case_row.id
  where case_row.organization_id = p_organization_id
    and case_row.id = p_case_id;

  if v_snapshot is null then
    raise exception using errcode = '22023', message = 'case not found in organization';
  end if;

  return v_snapshot;
end;
$$;

-- Direct browser reads are member-scoped; every browser write remains revoked.
alter table public.case_briefs enable row level security;
alter table public.case_brief_revisions enable row level security;
alter table public.case_notes enable row level security;

create policy case_briefs_read_member_org on public.case_briefs
  for select to authenticated
  using (organization_id in (
    select member.organization_id
    from public.argus_members member
    where member.user_id = (select auth.uid())
      and member.active
  ));

create policy case_brief_revisions_read_member_org on public.case_brief_revisions
  for select to authenticated
  using (organization_id in (
    select member.organization_id
    from public.argus_members member
    where member.user_id = (select auth.uid())
      and member.active
  ));

create policy case_notes_read_member_org on public.case_notes
  for select to authenticated
  using (organization_id in (
    select member.organization_id
    from public.argus_members member
    where member.user_id = (select auth.uid())
      and member.active
  ));

revoke all on table public.case_briefs,
  public.case_brief_revisions,
  public.case_notes
  from public, anon, authenticated;
revoke all on table public.case_briefs,
  public.case_brief_revisions,
  public.case_notes
  from service_role;

grant select on table public.case_briefs,
  public.case_brief_revisions,
  public.case_notes
  to authenticated;

-- The mutable head is changed only by save_case_brief. History tables are
-- immutable/append-only for the application because service_role receives no
-- UPDATE, DELETE, or TRUNCATE privilege on them.
grant select, insert, update on table public.case_briefs to service_role;
grant select, insert on table public.case_brief_revisions to service_role;
grant select, insert on table public.case_notes to service_role;

revoke all on function public.is_valid_case_brief_content(jsonb)
  from public, anon, authenticated;
revoke all on function public.save_case_brief(
  uuid, uuid, uuid, integer, uuid, boolean, text, uuid, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.append_case_note(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_case_brief_snapshot(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.is_valid_case_brief_content(jsonb)
  to service_role;
grant execute on function public.save_case_brief(
  uuid, uuid, uuid, integer, uuid, boolean, text, uuid, timestamptz, jsonb
) to service_role;
grant execute on function public.append_case_note(uuid, uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.get_case_brief_snapshot(uuid, uuid, uuid)
  to service_role;

commit;
