-- Typed, concurrency-safe analyst augmentations.
--
-- Legacy augmentations were whole JSON arrays stored in public.reports. Two
-- simultaneous submissions could overwrite one another, ticker-only keys could
-- mix unrelated tokens, and truncated text IDs could collide. Row-per-fact
-- storage plus atomic RPCs makes identity, authorship, and owner decisions
-- durable without trusting client-supplied names or query-string secrets.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

create table public.augmentation_items (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  subject_kind          text not null
                        check (subject_kind in ('person', 'token', 'investigation', 'site', 'legacy')),
  canonical_ref         text not null check (char_length(canonical_ref) between 1 and 500),
  subject_label         text not null check (char_length(subject_label) between 1 and 500),
  subject_graph_key     text check (subject_graph_key is null or char_length(subject_graph_key) <= 500),
  item_type             text not null
                        check (item_type in ('github', 'website', 'x', 'contract', 'wallet', 'link')),
  target_kind           text not null default ''
                        check (target_kind in ('', 'github', 'website', 'x', 'contract', 'wallet')),
  relationship          text not null default ''
                        check (relationship in ('', 'same_operator', 'associate', 'runs', 'team', 'advisor', 'other')),
  target_canonical_ref  text not null check (char_length(target_canonical_ref) between 1 and 1200),
  value                 text not null check (char_length(value) between 1 and 500),
  label                 text not null check (char_length(label) between 1 and 500),
  url                   text check (url is null or char_length(url) <= 2000),
  detail                text check (detail is null or char_length(detail) <= 1000),
  graph_key             text check (graph_key is null or char_length(graph_key) <= 500),
  verification_reason   text check (verification_reason is null or char_length(verification_reason) <= 1000),
  status                text not null check (status in ('pending', 'live', 'denied')),
  decision_source       text not null check (decision_source in (
                          'awaiting_owner',
                          'auto_corroborated',
                          'owner_approved',
                          'owner_denied',
                          'legacy_unattested'
                        )),
  submitted_by          uuid,
  submitted_by_label    text not null check (char_length(submitted_by_label) between 1 and 120),
  submitted_at          timestamptz not null default now(),
  last_submitted_at     timestamptz not null default now(),
  submission_count      integer not null default 1 check (submission_count > 0),
  reviewed_by           uuid,
  reviewed_by_label     text check (reviewed_by_label is null or char_length(reviewed_by_label) <= 120),
  reviewed_at           timestamptz,
  review_note           text check (review_note is null or char_length(review_note) <= 1000),
  published_at          timestamptz,
  denied_at             timestamptz,
  legacy_item_id        text check (legacy_item_id is null or char_length(legacy_item_id) <= 500),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint augmentation_items_link_shape check (
    (item_type = 'link' and target_kind <> '' and relationship <> '')
    or (item_type <> 'link' and target_kind = '' and relationship = '')
  ),
  constraint augmentation_items_org_id_key unique (organization_id, id),
  constraint augmentation_items_identity_key unique (
    organization_id,
    subject_kind,
    canonical_ref,
    item_type,
    target_kind,
    relationship,
    target_canonical_ref
  ),
  constraint augmentation_items_submitted_member_fkey
    foreign key (organization_id, submitted_by)
    references public.argus_members (organization_id, user_id)
    on delete set null (submitted_by),
  constraint augmentation_items_reviewed_member_fkey
    foreign key (organization_id, reviewed_by)
    references public.argus_members (organization_id, user_id)
    on delete set null (reviewed_by)
);

create index augmentation_items_subject_status_idx
  on public.augmentation_items (
    organization_id,
    subject_kind,
    canonical_ref,
    status,
    submitted_at desc
  );
create index augmentation_items_pending_idx
  on public.augmentation_items (organization_id, submitted_at desc)
  where status = 'pending';
create index augmentation_items_submitted_member_idx
  on public.augmentation_items (organization_id, submitted_by)
  where submitted_by is not null;
create index augmentation_items_reviewed_member_idx
  on public.augmentation_items (organization_id, reviewed_by)
  where reviewed_by is not null;

drop trigger if exists augmentation_items_touch on public.augmentation_items;
create trigger augmentation_items_touch
  before update on public.augmentation_items
  for each row execute function public.touch_updated_at();

create table public.augmentation_events (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  item_id              uuid not null,
  actor_user_id        uuid,
  actor_display_name   text check (actor_display_name is null or char_length(actor_display_name) <= 120),
  actor_role           text check (actor_role is null or actor_role in ('owner', 'analyst', 'viewer')),
  event_type           text not null check (event_type in (
                        'augmentation.migrated',
                        'augmentation.submitted',
                        'augmentation.auto_published',
                        'augmentation.approved',
                        'augmentation.denied',
                        'augmentation.diagnosed'
                      )),
  from_status          text check (from_status is null or from_status in ('pending', 'live', 'denied')),
  to_status            text check (to_status is null or to_status in ('pending', 'live', 'denied')),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  constraint augmentation_events_item_fkey
    foreign key (organization_id, item_id)
    references public.augmentation_items (organization_id, id)
    on delete restrict,
  constraint augmentation_events_actor_member_fkey
    foreign key (organization_id, actor_user_id)
    references public.argus_members (organization_id, user_id)
    on delete set null (actor_user_id)
);

create index augmentation_events_item_created_idx
  on public.augmentation_events (organization_id, item_id, created_at desc);
create index augmentation_events_org_type_created_idx
  on public.augmentation_events (organization_id, event_type, created_at desc);
create index augmentation_events_actor_member_idx
  on public.augmentation_events (organization_id, actor_user_id)
  where actor_user_id is not null;

-- Preserve every legacy item without guessing a durable subject type. Existing
-- production rows are ticker/display keyed and cannot be safely attached to a
-- contract case. Deterministically safe person/site fallback happens in the API;
-- ambiguous token rows remain visible only in the owner reconciliation queue.
with legacy_items as (
  select
    report.organization_id,
    pg_catalog.substr(report.ref, 5) as canonical_ref,
    coalesce(nullif(report.query, ''), report.ref) as subject_label,
    report.contributor,
    report.ts,
    item.value as item,
    item.ordinality
  from public.reports report
  cross join lateral pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(report.payload -> 'items') = 'array'
        then report.payload -> 'items'
      else '[]'::jsonb
    end
  ) with ordinality as item(value, ordinality)
  where report.kind = 'augmentation'
), inserted_legacy as (
  insert into public.augmentation_items (
    organization_id,
    subject_kind,
    canonical_ref,
    subject_label,
    subject_graph_key,
    item_type,
    target_kind,
    relationship,
    target_canonical_ref,
    value,
    label,
    url,
    detail,
    graph_key,
    verification_reason,
    status,
    decision_source,
    submitted_by,
    submitted_by_label,
    submitted_at,
    last_submitted_at,
    published_at,
    legacy_item_id
  )
  select
    legacy.organization_id,
    'legacy',
    pg_catalog.left(legacy.canonical_ref, 500),
    pg_catalog.left(legacy.subject_label, 500),
    null,
    legacy.item ->> 'type',
    case when legacy.item ->> 'type' = 'link' then legacy.item ->> 'kind' else '' end,
    case when legacy.item ->> 'type' = 'link'
      then case
        when legacy.item ->> 'rel' in ('same_operator', 'associate', 'runs', 'team', 'advisor', 'other')
          then legacy.item ->> 'rel'
        else 'other'
      end
      else ''
    end,
    -- A legacy value may be 500 Unicode characters (up to 2,000 UTF-8
    -- bytes), so hex-encoding the full value can exceed the 1,200-character
    -- canonical-ref constraint. A full SHA-256 digest is deterministic,
    -- bounded, and preserves a collision-resistant identity without truncation.
    'legacy-sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(coalesce(legacy.item ->> 'value', ''), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    pg_catalog.left(legacy.item ->> 'value', 500),
    pg_catalog.left(coalesce(legacy.item ->> 'label', legacy.item ->> 'value'), 500),
    pg_catalog.left(nullif(legacy.item ->> 'url', ''), 2000),
    pg_catalog.left(nullif(legacy.item ->> 'detail', ''), 1000),
    pg_catalog.left(nullif(legacy.item ->> 'graphKey', ''), 500),
    pg_catalog.left(nullif(legacy.item ->> 'why', ''), 1000),
    case when legacy.item ->> 'status' = 'pending' then 'pending' else 'live' end,
    'legacy_unattested',
    null,
    pg_catalog.left(
      coalesce(
        nullif(legacy.item ->> 'by', ''),
        nullif(legacy.contributor, ''),
        'legacy analyst'
      ),
      120
    ),
    case
      when legacy.item ->> 'at' ~ '^[0-9]{13}$'
        then pg_catalog.to_timestamp((legacy.item ->> 'at')::numeric / 1000)
      else legacy.ts
    end,
    case
      when legacy.item ->> 'at' ~ '^[0-9]{13}$'
        then pg_catalog.to_timestamp((legacy.item ->> 'at')::numeric / 1000)
      else legacy.ts
    end,
    case when legacy.item ->> 'status' = 'pending' then null else legacy.ts end,
    pg_catalog.left(
      coalesce(
        nullif(legacy.item ->> 'id', ''),
        legacy.canonical_ref || ':' || legacy.ordinality::text
      ),
      500
    )
  from legacy_items legacy
  where legacy.item ->> 'type' in ('github', 'website', 'x', 'contract', 'wallet', 'link')
    and coalesce(legacy.item ->> 'value', '') <> ''
    and (
      legacy.item ->> 'type' <> 'link'
      or legacy.item ->> 'kind' in ('github', 'website', 'x', 'contract', 'wallet')
    )
  on conflict on constraint augmentation_items_identity_key do nothing
  returning *
)
insert into public.augmentation_events (
  organization_id,
  item_id,
  event_type,
  from_status,
  to_status,
  metadata,
  created_at
)
select
  item.organization_id,
  item.id,
  'augmentation.migrated',
  null,
  item.status,
  pg_catalog.jsonb_build_object(
    'legacyItemId', item.legacy_item_id,
    'decisionSource', item.decision_source
  ),
  item.created_at
from inserted_legacy item;

create or replace function public.submit_augmentation_item(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_subject_kind text,
  p_canonical_ref text,
  p_subject_label text,
  p_subject_graph_key text,
  p_item_type text,
  p_target_kind text,
  p_relationship text,
  p_target_canonical_ref text,
  p_value text,
  p_label text,
  p_url text,
  p_detail text,
  p_graph_key text,
  p_auto_publish boolean,
  p_verification_reason text
)
returns public.augmentation_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.argus_members;
  v_existing public.augmentation_items;
  v_item public.augmentation_items;
  v_now timestamptz := pg_catalog.now();
  v_next_status text := case when p_auto_publish then 'live' else 'pending' end;
begin
  select member.* into v_actor
  from public.argus_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_user_id
    and member.active
    and member.role in ('owner', 'analyst')
  limit 1;
  if v_actor.user_id is null then
    raise exception using errcode = '42501', message = 'active analyst access required';
  end if;

  if p_subject_kind not in ('person', 'token', 'investigation', 'site')
     or char_length(pg_catalog.btrim(p_canonical_ref)) not between 1 and 500
     or char_length(pg_catalog.btrim(p_subject_label)) not between 1 and 500
     or (p_subject_graph_key is not null and char_length(p_subject_graph_key) > 500)
     or p_item_type not in ('github', 'website', 'x', 'contract', 'wallet', 'link')
     or char_length(pg_catalog.btrim(p_target_canonical_ref)) not between 1 and 1200
     or char_length(pg_catalog.btrim(p_value)) not between 1 and 500
     or char_length(pg_catalog.btrim(p_label)) not between 1 and 500
     or (p_item_type = 'link' and (
       p_target_kind not in ('github', 'website', 'x', 'contract', 'wallet')
       or p_relationship not in ('same_operator', 'associate', 'runs', 'team', 'advisor', 'other')
     ))
     or (p_item_type <> 'link' and (
       coalesce(p_target_kind, '') <> ''
       or coalesce(p_relationship, '') <> ''
     )) then
    raise exception using errcode = '22023', message = 'invalid augmentation input';
  end if;

  -- SELECT ... FOR UPDATE cannot lock a row that does not exist yet. Serialize
  -- the complete natural key first so concurrent first submissions cannot race
  -- through the absent-row path or produce incorrect event transitions.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        p_organization_id,
        p_subject_kind,
        pg_catalog.btrim(p_canonical_ref),
        p_item_type,
        coalesce(p_target_kind, ''),
        coalesce(p_relationship, ''),
        pg_catalog.btrim(p_target_canonical_ref)
      )::text,
      0
    )
  );

  select item.* into v_existing
  from public.augmentation_items item
  where item.organization_id = p_organization_id
    and item.subject_kind = p_subject_kind
    and item.canonical_ref = pg_catalog.btrim(p_canonical_ref)
    and item.item_type = p_item_type
    and item.target_kind = coalesce(p_target_kind, '')
    and item.relationship = coalesce(p_relationship, '')
    and item.target_canonical_ref = pg_catalog.btrim(p_target_canonical_ref)
  for update;

  insert into public.augmentation_items as current_item (
    organization_id,
    subject_kind,
    canonical_ref,
    subject_label,
    subject_graph_key,
    item_type,
    target_kind,
    relationship,
    target_canonical_ref,
    value,
    label,
    url,
    detail,
    graph_key,
    verification_reason,
    status,
    decision_source,
    submitted_by,
    submitted_by_label,
    submitted_at,
    last_submitted_at,
    published_at
  ) values (
    p_organization_id,
    p_subject_kind,
    pg_catalog.btrim(p_canonical_ref),
    pg_catalog.btrim(p_subject_label),
    nullif(pg_catalog.btrim(p_subject_graph_key), ''),
    p_item_type,
    coalesce(p_target_kind, ''),
    coalesce(p_relationship, ''),
    pg_catalog.btrim(p_target_canonical_ref),
    pg_catalog.btrim(p_value),
    pg_catalog.btrim(p_label),
    nullif(pg_catalog.btrim(p_url), ''),
    nullif(pg_catalog.btrim(p_detail), ''),
    nullif(pg_catalog.btrim(p_graph_key), ''),
    nullif(pg_catalog.btrim(p_verification_reason), ''),
    v_next_status,
    case when p_auto_publish then 'auto_corroborated' else 'awaiting_owner' end,
    p_actor_user_id,
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_actor.display_name), ''), v_actor.role), 120),
    v_now,
    v_now,
    case when p_auto_publish then v_now else null end
  )
  on conflict on constraint augmentation_items_identity_key do update set
    subject_label = excluded.subject_label,
    subject_graph_key = excluded.subject_graph_key,
    value = excluded.value,
    label = excluded.label,
    url = excluded.url,
    detail = excluded.detail,
    graph_key = excluded.graph_key,
    verification_reason = excluded.verification_reason,
    last_submitted_at = v_now,
    submission_count = current_item.submission_count + 1,
    status = case
      when current_item.status = 'pending' and excluded.status = 'live' then 'live'
      else current_item.status
    end,
    decision_source = case
      when current_item.status = 'pending' and excluded.status = 'live' then 'auto_corroborated'
      else current_item.decision_source
    end,
    published_at = case
      when current_item.status = 'pending' and excluded.status = 'live' then v_now
      else current_item.published_at
    end,
    updated_at = v_now
  returning * into v_item;

  insert into public.augmentation_events (
    organization_id,
    item_id,
    actor_user_id,
    actor_display_name,
    actor_role,
    event_type,
    from_status,
    to_status,
    metadata,
    created_at
  ) values (
    p_organization_id,
    v_item.id,
    p_actor_user_id,
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_actor.display_name), ''), v_actor.role), 120),
    v_actor.role,
    case
      when v_item.status = 'live'
       and (v_existing.id is null or v_existing.status = 'pending')
        then 'augmentation.auto_published'
      else 'augmentation.submitted'
    end,
    case when v_existing.id is null then null else v_existing.status end,
    v_item.status,
    pg_catalog.jsonb_build_object('submissionCount', v_item.submission_count),
    v_now
  );

  return v_item;
end;
$$;

create or replace function public.review_augmentation_item(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_item_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.augmentation_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.argus_members;
  v_item public.augmentation_items;
  v_status text;
  v_now timestamptz := pg_catalog.now();
begin
  select member.* into v_actor
  from public.argus_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_user_id
    and member.active
    and member.role = 'owner'
  limit 1;
  if v_actor.user_id is null then
    raise exception using errcode = '42501', message = 'active owner access required';
  end if;
  if p_decision not in ('approve', 'deny')
     or (p_review_note is not null and char_length(p_review_note) > 1000) then
    raise exception using errcode = '22023', message = 'invalid augmentation decision';
  end if;

  select item.* into v_item
  from public.augmentation_items item
  where item.organization_id = p_organization_id
    and item.id = p_item_id
  for update;
  if v_item.id is null then
    raise exception using errcode = 'P0002', message = 'augmentation item not found';
  end if;
  v_status := case when p_decision = 'approve' then 'live' else 'denied' end;

  if v_item.status <> 'pending' then
    if v_item.status = v_status
       and v_item.reviewed_by = p_actor_user_id then
      return v_item;
    end if;
    raise exception using errcode = '40001', message = 'augmentation decision conflict';
  end if;

  update public.augmentation_items item set
    status = v_status,
    decision_source = case when p_decision = 'approve' then 'owner_approved' else 'owner_denied' end,
    reviewed_by = p_actor_user_id,
    reviewed_by_label = pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_actor.display_name), ''), v_actor.role), 120),
    reviewed_at = v_now,
    review_note = nullif(pg_catalog.btrim(p_review_note), ''),
    published_at = case when p_decision = 'approve' then v_now else item.published_at end,
    denied_at = case when p_decision = 'deny' then v_now else null end,
    updated_at = v_now
  where item.organization_id = p_organization_id
    and item.id = p_item_id
  returning * into v_item;

  insert into public.augmentation_events (
    organization_id,
    item_id,
    actor_user_id,
    actor_display_name,
    actor_role,
    event_type,
    from_status,
    to_status,
    metadata,
    created_at
  ) values (
    p_organization_id,
    v_item.id,
    p_actor_user_id,
    v_item.reviewed_by_label,
    v_actor.role,
    case when p_decision = 'approve' then 'augmentation.approved' else 'augmentation.denied' end,
    'pending',
    v_item.status,
    pg_catalog.jsonb_build_object('reviewNote', v_item.review_note),
    v_now
  );

  return v_item;
end;
$$;

create or replace function public.record_augmentation_diagnosis(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_item_id uuid,
  p_reason text,
  p_fix text
)
returns public.augmentation_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.argus_members;
  v_item public.augmentation_items;
  v_event public.augmentation_events;
begin
  select member.* into v_actor
  from public.argus_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_user_id
    and member.active
    and member.role = 'owner'
  limit 1;
  if v_actor.user_id is null then
    raise exception using errcode = '42501', message = 'active owner access required';
  end if;
  if char_length(pg_catalog.btrim(p_reason)) not between 1 and 400
     or char_length(pg_catalog.btrim(p_fix)) not between 1 and 400 then
    raise exception using errcode = '22023', message = 'invalid augmentation diagnosis';
  end if;

  select item.* into v_item
  from public.augmentation_items item
  where item.organization_id = p_organization_id
    and item.id = p_item_id
    and item.status = 'live'
  limit 1;
  if v_item.id is null then
    raise exception using errcode = 'P0002', message = 'live augmentation item not found';
  end if;

  insert into public.augmentation_events (
    organization_id,
    item_id,
    actor_user_id,
    actor_display_name,
    actor_role,
    event_type,
    from_status,
    to_status,
    metadata
  ) values (
    p_organization_id,
    v_item.id,
    p_actor_user_id,
    pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_actor.display_name), ''), v_actor.role), 120),
    v_actor.role,
    'augmentation.diagnosed',
    v_item.status,
    v_item.status,
    pg_catalog.jsonb_build_object(
      'subject', v_item.subject_label,
      'subjectKind', v_item.subject_kind,
      'canonicalRef', v_item.canonical_ref,
      'subjectGraphKey', v_item.subject_graph_key,
      'label', v_item.label,
      'kind', case when v_item.item_type = 'link' then 'link:' || v_item.relationship else v_item.item_type end,
      'reason', pg_catalog.btrim(p_reason),
      'fix', pg_catalog.btrim(p_fix)
    )
  )
  returning * into v_event;

  return v_event;
end;
$$;

alter table public.augmentation_items enable row level security;
alter table public.augmentation_events enable row level security;

create policy augmentation_items_read_member_org on public.augmentation_items
  for select to authenticated
  using (organization_id in (
    select member.organization_id
    from public.argus_members member
    where member.user_id = (select auth.uid())
      and member.active
  ));

create policy augmentation_events_read_owner_org on public.augmentation_events
  for select to authenticated
  using (organization_id in (
    select member.organization_id
    from public.argus_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role = 'owner'
  ));

revoke all on table public.augmentation_items from anon, authenticated;
revoke all on table public.augmentation_events from anon, authenticated;
grant select on table public.augmentation_items to authenticated;
grant select on table public.augmentation_events to authenticated;
-- The API reads rows directly, while every mutation goes through the RPCs
-- below. Keep the event log append-only even for the service role and withhold
-- destructive privileges from both tables.
revoke all on table public.augmentation_items from service_role;
revoke all on table public.augmentation_events from service_role;
grant select, insert, update on table public.augmentation_items to service_role;
grant select, insert on table public.augmentation_events to service_role;

revoke all on function public.submit_augmentation_item(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.review_augmentation_item(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.record_augmentation_diagnosis(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.submit_augmentation_item(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) to service_role;
grant execute on function public.review_augmentation_item(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.record_augmentation_diagnosis(uuid, uuid, uuid, text, text)
  to service_role;

commit;
