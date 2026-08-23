-- Durable, private workspace-assistant conversations.
--
-- The complete transcript stays available to its member, while the provider
-- receives only a bounded request memory and a small recent-message window.
-- Neither platform leadership nor another member can select this data.

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'محادثة مساعد التشغيل',
  memory_summary text not null default '',
  message_count integer not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (id, organization_id, user_id),
  constraint assistant_conversations_title_length check (
    char_length(trim(title)) between 2 and 120
  ),
  constraint assistant_conversations_memory_length check (
    char_length(memory_summary) <= 4000
  ),
  constraint assistant_conversations_message_count_positive check (
    message_count >= 0
  )
);

create table public.assistant_messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null,
  body text not null,
  provider_label text,
  links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint assistant_messages_conversation_owner_fkey
    foreign key (conversation_id, organization_id, user_id)
    references public.assistant_conversations (id, organization_id, user_id)
    on delete cascade,
  constraint assistant_messages_role_check check (role in ('user', 'assistant')),
  constraint assistant_messages_body_length check (
    char_length(trim(body)) between 1 and 12000
  ),
  constraint assistant_messages_provider_length check (
    provider_label is null or char_length(trim(provider_label)) between 2 and 160
  ),
  constraint assistant_messages_links_array check (
    jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 20
  )
);

create index assistant_messages_conversation_time_idx
  on public.assistant_messages (conversation_id, created_at desc, id desc);

create index assistant_conversations_user_time_idx
  on public.assistant_conversations (user_id, last_message_at desc nulls last);

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;

create policy "assistant_conversations_select_self"
on public.assistant_conversations
for select
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.memberships membership
    where membership.organization_id = assistant_conversations.organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

create policy "assistant_messages_select_self"
on public.assistant_messages
for select
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.memberships membership
    where membership.organization_id = assistant_messages.organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  )
);

revoke all on table public.assistant_conversations from public, anon, authenticated;
revoke all on table public.assistant_messages from public, anon, authenticated;
revoke all on sequence public.assistant_messages_id_seq from public, anon, authenticated;
grant select on table public.assistant_conversations to authenticated;
grant select on table public.assistant_messages to authenticated;
grant select, insert, update, delete on table public.assistant_conversations to service_role;
grant select, insert, update, delete on table public.assistant_messages to service_role;
grant usage, select on sequence public.assistant_messages_id_seq to service_role;

create or replace function public.get_or_create_assistant_conversation(
  target_user_id uuid,
  target_organization_id uuid
)
returns table (
  conversation_id uuid,
  title text,
  memory_summary text,
  message_count integer,
  last_message_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Assistant conversation requires an active membership';
  end if;

  insert into public.assistant_conversations (organization_id, user_id)
  values (target_organization_id, target_user_id)
  on conflict (organization_id, user_id) do nothing;

  return query
  select
    conversation.id,
    conversation.title,
    conversation.memory_summary,
    conversation.message_count,
    conversation.last_message_at
  from public.assistant_conversations conversation
  where conversation.organization_id = target_organization_id
    and conversation.user_id = target_user_id;
end;
$$;

create or replace function public.append_assistant_exchange(
  target_user_id uuid,
  target_organization_id uuid,
  target_conversation_id uuid,
  user_question text,
  assistant_answer text,
  assistant_provider_label text,
  assistant_links jsonb default '[]'::jsonb
)
returns table (
  conversation_id uuid,
  user_message_id bigint,
  assistant_message_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_question text := trim(user_question);
  clean_answer text := trim(assistant_answer);
  clean_provider text := nullif(trim(assistant_provider_label), '');
  clean_links jsonb := coalesce(assistant_links, '[]'::jsonb);
  inserted_user_message_id bigint;
  inserted_assistant_message_id bigint;
begin
  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Assistant exchange requires an active membership';
  end if;

  if char_length(clean_question) not between 2 and 1500
    or char_length(clean_answer) not between 1 and 12000 then
    raise exception 'Assistant exchange text is invalid';
  end if;

  if clean_provider is not null and char_length(clean_provider) > 160 then
    raise exception 'Assistant provider label is invalid';
  end if;

  if jsonb_typeof(clean_links) <> 'array'
    or jsonb_array_length(clean_links) > 20
    or exists (
      select 1
      from jsonb_array_elements(clean_links) link
      where jsonb_typeof(link) <> 'object'
        or jsonb_typeof(link->'label') <> 'string'
        or jsonb_typeof(link->'url') <> 'string'
        or char_length(trim(link->>'label')) not between 1 and 120
        or char_length(link->>'url') not between 1 and 500
        or (link->>'url') !~ '^/[A-Za-z0-9/_?#=&.%:-]+$'
    ) then
    raise exception 'Assistant links are invalid';
  end if;

  perform 1
  from public.assistant_conversations conversation
  where conversation.id = target_conversation_id
    and conversation.organization_id = target_organization_id
    and conversation.user_id = target_user_id
  for update;

  if not found then
    raise exception 'Assistant conversation is not owned by this member';
  end if;

  insert into public.assistant_messages (
    organization_id, conversation_id, user_id, role, body
  ) values (
    target_organization_id, target_conversation_id, target_user_id, 'user', clean_question
  ) returning id into inserted_user_message_id;

  insert into public.assistant_messages (
    organization_id, conversation_id, user_id, role, body, provider_label, links
  ) values (
    target_organization_id, target_conversation_id, target_user_id,
    'assistant', clean_answer, clean_provider, clean_links
  ) returning id into inserted_assistant_message_id;

  update public.assistant_conversations conversation
  set title = case
        when conversation.message_count = 0 then left(clean_question, 120)
        else conversation.title
      end,
      memory_summary = right(
        concat_ws(E'\n', nullif(conversation.memory_summary, ''), '- ' || left(clean_question, 600)),
        4000
      ),
      message_count = conversation.message_count + 2,
      last_message_at = now(),
      updated_at = now()
  where conversation.id = target_conversation_id;

  return query select target_conversation_id, inserted_user_message_id, inserted_assistant_message_id;
end;
$$;

revoke all on function public.get_or_create_assistant_conversation(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.append_assistant_exchange(uuid, uuid, uuid, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.get_or_create_assistant_conversation(uuid, uuid) to service_role;
grant execute on function public.append_assistant_exchange(uuid, uuid, uuid, text, text, text, jsonb) to service_role;

comment on table public.assistant_conversations is
  'One durable private workspace-assistant conversation per active member.';
comment on table public.assistant_messages is
  'Private assistant transcript. Select access is limited to the owning active member.';
comment on function public.append_assistant_exchange(uuid, uuid, uuid, text, text, text, jsonb) is
  'Service-only atomic append of a successful user/assistant exchange with bounded memory.';
