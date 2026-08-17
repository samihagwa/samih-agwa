-- Approved brand knowledge is versioned, tenant-scoped, and linked to content
-- briefs without allowing browser-side writes or silent edits to approved rules.

create type public.brand_article_status as enum (
  'draft',
  'approved',
  'archived'
);

create type public.brand_category as enum (
  'foundation',
  'visual_identity',
  'editing',
  'copy_voice',
  'publishing',
  'compliance',
  'offer_product',
  'workflow'
);

create type public.brand_audience as enum (
  'all',
  'management',
  'design',
  'editing',
  'copy',
  'publishing',
  'sales'
);

create or replace function private.valid_brand_rule_list(values_to_check text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    cardinality(coalesce(values_to_check, '{}'::text[])) <= 20
    and not exists (
      select 1
      from unnest(coalesce(values_to_check, '{}'::text[])) item
      where char_length(trim(item)) not between 2 and 500
    );
$$;

create or replace function private.valid_brand_reference_urls(values_to_check text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    cardinality(coalesce(values_to_check, '{}'::text[])) <= 10
    and not exists (
      select 1
      from unnest(coalesce(values_to_check, '{}'::text[])) item
      where char_length(trim(item)) not between 8 and 2000
        or trim(item) !~* '^https?://[^[:space:]]+$'
    );
$$;

revoke all on function private.valid_brand_rule_list(text[]) from public, anon, authenticated;
revoke all on function private.valid_brand_reference_urls(text[]) from public, anon, authenticated;

create table public.brand_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  topic_id uuid not null default gen_random_uuid(),
  version integer not null default 1,
  edit_version bigint not null default 1,
  status public.brand_article_status not null default 'draft',
  category public.brand_category not null,
  audiences public.brand_audience[] not null default array['all']::public.brand_audience[],
  title text not null,
  summary text not null,
  guidelines text not null,
  do_list text[] not null default '{}'::text[],
  dont_list text[] not null default '{}'::text[],
  examples text,
  reference_urls text[] not null default '{}'::text[],
  change_note text not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  archived_by uuid references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, topic_id, version),
  constraint brand_articles_version_positive check (version > 0 and edit_version > 0),
  constraint brand_articles_title_length check (char_length(trim(title)) between 3 and 180),
  constraint brand_articles_summary_length check (char_length(trim(summary)) between 10 and 800),
  constraint brand_articles_guidelines_length check (char_length(trim(guidelines)) between 20 and 12000),
  constraint brand_articles_examples_length check (examples is null or char_length(examples) <= 5000),
  constraint brand_articles_change_note_length check (char_length(trim(change_note)) between 3 and 500),
  constraint brand_articles_audiences_present check (cardinality(audiences) between 1 and 7),
  constraint brand_articles_do_list_valid check (private.valid_brand_rule_list(do_list)),
  constraint brand_articles_dont_list_valid check (private.valid_brand_rule_list(dont_list)),
  constraint brand_articles_reference_urls_valid check (private.valid_brand_reference_urls(reference_urls)),
  constraint brand_articles_approval_consistent check (
    (status = 'draft' and approved_by is null and approved_at is null and archived_by is null and archived_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null and archived_by is null and archived_at is null)
    or (status = 'archived' and archived_by is not null and archived_at is not null)
  )
);

create unique index brand_articles_one_draft_per_topic_idx
  on public.brand_articles (organization_id, topic_id)
  where status = 'draft';

create unique index brand_articles_one_approved_per_topic_idx
  on public.brand_articles (organization_id, topic_id)
  where status = 'approved';

create index brand_articles_org_status_category_idx
  on public.brand_articles (organization_id, status, category, updated_at desc, id);

create index brand_articles_creator_idx on public.brand_articles (created_by);
create index brand_articles_approver_idx on public.brand_articles (approved_by) where approved_by is not null;
create index brand_articles_archiver_idx on public.brand_articles (archived_by) where archived_by is not null;

create table public.content_brand_references (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  brand_article_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (content_item_id, brand_article_id),
  constraint content_brand_references_content_org_fkey
    foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id)
    on delete cascade,
  constraint content_brand_references_article_org_fkey
    foreign key (brand_article_id, organization_id)
    references public.brand_articles (id, organization_id)
    on delete restrict
);

create index content_brand_references_article_org_idx
  on public.content_brand_references (brand_article_id, organization_id, content_item_id);

create index content_brand_references_org_content_idx
  on public.content_brand_references (organization_id, content_item_id, brand_article_id);

create index content_brand_references_creator_idx
  on public.content_brand_references (created_by);

create or replace function private.can_read_brand_article(
  target_article_id uuid,
  target_organization_id uuid,
  target_status public.brand_article_status
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and (
        membership.role in ('owner', 'admin', 'manager')
        or target_status = 'approved'
        or exists (
          select 1
          from public.content_brand_references reference
          where reference.organization_id = target_organization_id
            and reference.brand_article_id = target_article_id
        )
      )
  );
$$;

revoke all on function private.can_read_brand_article(uuid, uuid, public.brand_article_status)
from public, anon;
grant execute on function private.can_read_brand_article(uuid, uuid, public.brand_article_status)
to authenticated;

alter table public.brand_articles enable row level security;
alter table public.content_brand_references enable row level security;

create policy "brand_articles_select_visible_versions"
on public.brand_articles
for select
to authenticated
using ((select private.can_read_brand_article(id, organization_id, status)));

create policy "content_brand_references_select_organization_members"
on public.content_brand_references
for select
to authenticated
using ((select private.is_org_member(organization_id)));

revoke all on table public.brand_articles from anon, authenticated;
revoke all on table public.content_brand_references from anon, authenticated;
grant select on table public.brand_articles to authenticated;
grant select on table public.content_brand_references to authenticated;

create or replace function private.assert_brand_article_fields(
  target_title text,
  target_category public.brand_category,
  target_audiences public.brand_audience[],
  target_summary text,
  target_guidelines text,
  target_do_list text[],
  target_dont_list text[],
  target_examples text,
  target_reference_urls text[],
  target_change_note text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if target_category is null
    or char_length(trim(target_title)) not between 3 and 180
    or char_length(trim(target_summary)) not between 10 and 800
    or char_length(trim(target_guidelines)) not between 20 and 12000
    or (target_examples is not null and char_length(target_examples) > 5000)
    or char_length(trim(target_change_note)) not between 3 and 500 then
    raise exception 'Brand article fields are incomplete or exceed their allowed length';
  end if;

  if cardinality(coalesce(target_audiences, '{}'::public.brand_audience[])) not between 1 and 7
    or (
      select count(*) <> count(distinct audience)
      from unnest(coalesce(target_audiences, '{}'::public.brand_audience[])) audience
    ) then
    raise exception 'Choose one or more distinct audiences for the brand article';
  end if;

  if not private.valid_brand_rule_list(coalesce(target_do_list, '{}'::text[]))
    or not private.valid_brand_rule_list(coalesce(target_dont_list, '{}'::text[])) then
    raise exception 'Brand do and do-not lists may contain up to 20 clear rules each';
  end if;

  if not private.valid_brand_reference_urls(coalesce(target_reference_urls, '{}'::text[])) then
    raise exception 'Brand reference URLs must be valid HTTP or HTTPS links';
  end if;
end;
$$;

revoke all on function private.assert_brand_article_fields(
  text, public.brand_category, public.brand_audience[], text, text, text[], text[], text, text[], text
) from public, anon, authenticated;

create or replace function public.create_brand_article_draft(
  target_user_id uuid,
  target_organization_id uuid,
  article_title text,
  article_category public.brand_category,
  article_audiences public.brand_audience[],
  article_summary text,
  article_guidelines text,
  article_do_list text[],
  article_dont_list text[],
  article_examples text,
  article_reference_urls text[],
  article_change_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  article_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can create brand drafts';
  end if;

  perform private.assert_brand_article_fields(
    article_title, article_category, article_audiences, article_summary,
    article_guidelines, article_do_list, article_dont_list, article_examples,
    article_reference_urls, article_change_note
  );

  insert into public.brand_articles (
    organization_id, category, audiences, title, summary, guidelines,
    do_list, dont_list, examples, reference_urls, change_note, created_by
  ) values (
    target_organization_id,
    article_category,
    article_audiences,
    trim(article_title),
    trim(article_summary),
    trim(article_guidelines),
    coalesce(article_do_list, '{}'::text[]),
    coalesce(article_dont_list, '{}'::text[]),
    nullif(trim(article_examples), ''),
    coalesce(article_reference_urls, '{}'::text[]),
    trim(article_change_note),
    target_user_id
  ) returning id into article_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'brand.draft_created',
    'brand_article',
    article_id,
    jsonb_build_object('category', article_category, 'audiences', article_audiences, 'version', 1)
  );

  return article_id;
end;
$$;

create or replace function public.update_brand_article_draft(
  target_user_id uuid,
  target_article_id uuid,
  expected_edit_version bigint,
  article_title text,
  article_category public.brand_category,
  article_audiences public.brand_audience[],
  article_summary text,
  article_guidelines text,
  article_do_list text[],
  article_dont_list text[],
  article_examples text,
  article_reference_urls text[],
  article_change_note text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  article_record public.brand_articles%rowtype;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select article.* into article_record
  from public.brand_articles article
  where article.id = target_article_id
  for update;

  if article_record.id is null then
    raise exception 'Brand article was not found';
  end if;

  if article_record.status <> 'draft' then
    raise exception 'Approved brand articles are immutable; create a new revision instead';
  end if;

  if not private.has_org_role(
    article_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can edit brand drafts';
  end if;

  if article_record.edit_version <> expected_edit_version then
    raise exception 'This brand draft changed in another session; refresh before saving';
  end if;

  perform private.assert_brand_article_fields(
    article_title, article_category, article_audiences, article_summary,
    article_guidelines, article_do_list, article_dont_list, article_examples,
    article_reference_urls, article_change_note
  );

  update public.brand_articles article
  set
    title = trim(article_title),
    category = article_category,
    audiences = article_audiences,
    summary = trim(article_summary),
    guidelines = trim(article_guidelines),
    do_list = coalesce(article_do_list, '{}'::text[]),
    dont_list = coalesce(article_dont_list, '{}'::text[]),
    examples = nullif(trim(article_examples), ''),
    reference_urls = coalesce(article_reference_urls, '{}'::text[]),
    change_note = trim(article_change_note),
    edit_version = article.edit_version + 1,
    updated_at = now()
  where article.id = target_article_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    article_record.organization_id,
    target_user_id,
    'brand.draft_updated',
    'brand_article',
    target_article_id,
    jsonb_build_object('title', article_record.title, 'edit_version', article_record.edit_version),
    jsonb_build_object('title', trim(article_title), 'edit_version', article_record.edit_version + 1)
  );

  return true;
end;
$$;

create or replace function public.revise_brand_article(
  target_user_id uuid,
  target_article_id uuid,
  revision_change_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_article public.brand_articles%rowtype;
  revised_article_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select article.* into source_article
  from public.brand_articles article
  where article.id = target_article_id
  for update;

  if source_article.id is null or source_article.status <> 'approved' then
    raise exception 'Only an approved brand article can start a new revision';
  end if;

  if not private.has_org_role(
    source_article.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can revise brand articles';
  end if;

  if char_length(trim(revision_change_note)) not between 3 and 500 then
    raise exception 'Describe why this brand revision is needed';
  end if;

  if exists (
    select 1 from public.brand_articles article
    where article.organization_id = source_article.organization_id
      and article.topic_id = source_article.topic_id
      and article.status = 'draft'
  ) then
    raise exception 'This brand topic already has an open draft revision';
  end if;

  insert into public.brand_articles (
    organization_id, topic_id, version, category, audiences, title, summary,
    guidelines, do_list, dont_list, examples, reference_urls, change_note, created_by
  ) values (
    source_article.organization_id,
    source_article.topic_id,
    source_article.version + 1,
    source_article.category,
    source_article.audiences,
    source_article.title,
    source_article.summary,
    source_article.guidelines,
    source_article.do_list,
    source_article.dont_list,
    source_article.examples,
    source_article.reference_urls,
    trim(revision_change_note),
    target_user_id
  ) returning id into revised_article_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    source_article.organization_id,
    target_user_id,
    'brand.revision_started',
    'brand_article',
    revised_article_id,
    jsonb_build_object('topic_id', source_article.topic_id, 'version', source_article.version + 1, 'previous_article_id', source_article.id)
  );

  return revised_article_id;
end;
$$;

create or replace function public.approve_brand_article(
  target_user_id uuid,
  target_article_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_article public.brand_articles%rowtype;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select article.* into draft_article
  from public.brand_articles article
  where article.id = target_article_id
  for update;

  if draft_article.id is null or draft_article.status <> 'draft' then
    raise exception 'Only a draft brand article can be approved';
  end if;

  if not private.has_org_role(
    draft_article.organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception 'Only the organization owner can approve brand rules';
  end if;

  perform article.id
  from public.brand_articles article
  where article.organization_id = draft_article.organization_id
    and article.topic_id = draft_article.topic_id
  order by article.version
  for update;

  update public.brand_articles article
  set
    status = 'archived',
    archived_by = target_user_id,
    archived_at = now(),
    updated_at = now()
  where article.organization_id = draft_article.organization_id
    and article.topic_id = draft_article.topic_id
    and article.status = 'approved';

  update public.brand_articles article
  set
    status = 'approved',
    approved_by = target_user_id,
    approved_at = now(),
    edit_version = article.edit_version + 1,
    updated_at = now()
  where article.id = target_article_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    draft_article.organization_id,
    target_user_id,
    'brand.article_approved',
    'brand_article',
    target_article_id,
    jsonb_build_object('topic_id', draft_article.topic_id, 'version', draft_article.version)
  );

  return true;
end;
$$;

create or replace function public.archive_brand_article(
  target_user_id uuid,
  target_article_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  article_record public.brand_articles%rowtype;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select article.* into article_record
  from public.brand_articles article
  where article.id = target_article_id
  for update;

  if article_record.id is null or article_record.status <> 'approved' then
    raise exception 'Only an approved brand article can be archived';
  end if;

  if not private.has_org_role(
    article_record.organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception 'Only the organization owner can archive brand rules';
  end if;

  update public.brand_articles article
  set
    status = 'archived',
    archived_by = target_user_id,
    archived_at = now(),
    updated_at = now()
  where article.id = target_article_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    article_record.organization_id,
    target_user_id,
    'brand.article_archived',
    'brand_article',
    target_article_id,
    jsonb_build_object('topic_id', article_record.topic_id, 'version', article_record.version)
  );

  return true;
end;
$$;

create or replace function private.assert_approved_brand_references(
  target_organization_id uuid,
  target_brand_article_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_ids uuid[] := coalesce(target_brand_article_ids, '{}'::uuid[]);
begin
  if cardinality(clean_ids) > 8
    or (
      select count(*) <> count(distinct article_id)
      from unnest(clean_ids) article_id
    ) then
    raise exception 'Choose no more than eight distinct approved brand references';
  end if;

  if exists (
    select 1
    from unnest(clean_ids) requested_id
    left join public.brand_articles article
      on article.id = requested_id
     and article.organization_id = target_organization_id
     and article.status = 'approved'
    where article.id is null
  ) then
    raise exception 'One or more selected brand references are not approved for this organization';
  end if;
end;
$$;

create or replace function private.link_brand_references(
  target_user_id uuid,
  target_organization_id uuid,
  target_content_item_id uuid,
  target_brand_article_ids uuid[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.content_brand_references (
    organization_id, content_item_id, brand_article_id, created_by
  )
  select
    target_organization_id,
    target_content_item_id,
    article_id,
    target_user_id
  from unnest(coalesce(target_brand_article_ids, '{}'::uuid[])) article_id;
$$;

revoke all on function private.assert_approved_brand_references(uuid, uuid[])
from public, anon, authenticated;
revoke all on function private.link_brand_references(uuid, uuid, uuid, uuid[])
from public, anon, authenticated;

create or replace function public.create_reel_production_workflow_v2(
  target_user_id uuid,
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_script_outline text,
  content_editing_brief text,
  content_thumbnail_brief text,
  content_brand_notes text,
  target_publish_at timestamptz,
  brief_owner_id uuid,
  recording_owner_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  caption_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid,
  initial_raw_url text,
  initial_source_url text,
  initial_reference_url text,
  target_brand_article_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
  reference_count integer := cardinality(coalesce(target_brand_article_ids, '{}'::uuid[]));
begin
  perform private.assert_approved_brand_references(target_organization_id, target_brand_article_ids);

  content_id := public.create_reel_production_workflow(
    target_user_id, target_organization_id, content_title, content_goal, content_hook,
    content_cta, content_script_outline, content_editing_brief,
    content_thumbnail_brief, content_brand_notes, target_publish_at,
    brief_owner_id, recording_owner_id, editing_owner_id, thumbnail_owner_id,
    caption_owner_id, approval_owner_id, publishing_owner_id,
    initial_raw_url, initial_source_url, initial_reference_url
  );

  perform private.link_brand_references(
    target_user_id, target_organization_id, content_id, target_brand_article_ids
  );

  if reference_count > 0 then
    update public.tasks task
    set description = left(
      task.description || chr(10) || 'راجع ' || reference_count || ' مرجع براند معتمد مرتبط بملف المحتوى قبل التنفيذ.',
      5000
    )
    where task.content_item_id = content_id
      and task.content_step in ('brief', 'editing', 'thumbnail', 'caption', 'approval');
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.brand_references_linked',
    'content_item',
    content_id,
    jsonb_build_object('reference_count', reference_count, 'brand_article_ids', coalesce(target_brand_article_ids, '{}'::uuid[]))
  );

  return content_id;
end;
$$;

create or replace function public.create_reel_from_intake_v2(
  target_user_id uuid,
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_script_outline text,
  content_editing_brief text,
  content_thumbnail_brief text,
  content_brand_notes text,
  intake_request_text text,
  telegram_source_url text,
  parsed_timeline jsonb,
  parsed_assets jsonb,
  target_publish_at timestamptz,
  brief_owner_id uuid,
  recording_owner_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  caption_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid,
  target_brand_article_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
  reference_count integer := cardinality(coalesce(target_brand_article_ids, '{}'::uuid[]));
begin
  perform private.assert_approved_brand_references(target_organization_id, target_brand_article_ids);

  content_id := public.create_reel_from_intake(
    target_user_id, target_organization_id, content_title, content_goal, content_hook,
    content_cta, content_script_outline, content_editing_brief,
    content_thumbnail_brief, content_brand_notes, intake_request_text,
    telegram_source_url, parsed_timeline, parsed_assets, target_publish_at,
    brief_owner_id, recording_owner_id, editing_owner_id, thumbnail_owner_id,
    caption_owner_id, approval_owner_id, publishing_owner_id
  );

  perform private.link_brand_references(
    target_user_id, target_organization_id, content_id, target_brand_article_ids
  );

  if reference_count > 0 then
    update public.tasks task
    set description = left(
      task.description || chr(10) || 'راجع ' || reference_count || ' مرجع براند معتمد مرتبط بملف المحتوى قبل التنفيذ.',
      5000
    )
    where task.content_item_id = content_id
      and task.content_step in ('brief', 'editing', 'thumbnail', 'caption', 'approval');
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.brand_references_linked',
    'content_item',
    content_id,
    jsonb_build_object('reference_count', reference_count, 'brand_article_ids', coalesce(target_brand_article_ids, '{}'::uuid[]))
  );

  return content_id;
end;
$$;

revoke all on function public.create_brand_article_draft(
  uuid, uuid, text, public.brand_category, public.brand_audience[], text, text,
  text[], text[], text, text[], text
) from public, anon, authenticated;
grant execute on function public.create_brand_article_draft(
  uuid, uuid, text, public.brand_category, public.brand_audience[], text, text,
  text[], text[], text, text[], text
) to service_role;

revoke all on function public.update_brand_article_draft(
  uuid, uuid, bigint, text, public.brand_category, public.brand_audience[], text,
  text, text[], text[], text, text[], text
) from public, anon, authenticated;
grant execute on function public.update_brand_article_draft(
  uuid, uuid, bigint, text, public.brand_category, public.brand_audience[], text,
  text, text[], text[], text, text[], text
) to service_role;

revoke all on function public.revise_brand_article(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.revise_brand_article(uuid, uuid, text)
to service_role;

revoke all on function public.approve_brand_article(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.approve_brand_article(uuid, uuid)
to service_role;

revoke all on function public.archive_brand_article(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.archive_brand_article(uuid, uuid)
to service_role;

revoke all on function public.create_reel_production_workflow_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_reel_production_workflow_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, uuid[]
) to service_role;

revoke all on function public.create_reel_from_intake_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_reel_from_intake_v2(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid[]
) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'brand_articles'
  ) then
    alter publication supabase_realtime add table public.brand_articles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'content_brand_references'
  ) then
    alter publication supabase_realtime add table public.content_brand_references;
  end if;
end;
$$;

comment on table public.brand_articles is
  'Versioned brand rules. Approved bodies are immutable; edits happen in a new draft revision.';

comment on table public.content_brand_references is
  'Immutable links from a content item to the exact approved brand versions used by its brief.';
