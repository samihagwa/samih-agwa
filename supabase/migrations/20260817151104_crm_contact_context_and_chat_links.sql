-- Preserve structured reporting while allowing a clear custom acquisition source,
-- a custom registration reason, and one-click links to customer conversations.

create type public.crm_conversation_channel as enum (
  'telegram',
  'whatsapp',
  'instagram',
  'facebook',
  'messenger',
  'other'
);

alter table public.crm_contacts
  add column source_detail text,
  add column interest_detail text,
  add constraint crm_contacts_source_detail_contract check (
    source_detail is null
    or (
      source = 'other'
      and char_length(trim(source_detail)) between 2 and 160
    )
  ),
  add constraint crm_contacts_interest_detail_contract check (
    interest_detail is null
    or (
      interest = 'other'
      and char_length(trim(interest_detail)) between 2 and 160
    )
  );

create table public.crm_conversation_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  channel public.crm_conversation_channel not null,
  label text,
  url text not null,
  is_primary boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint crm_conversation_links_contact_org_fkey
    foreign key (contact_id, organization_id)
    references public.crm_contacts (id, organization_id)
    on delete cascade,
  constraint crm_conversation_links_url_length check (
    char_length(trim(url)) between 8 and 2000
  ),
  constraint crm_conversation_links_http_url check (
    trim(url) ~* '^https?://[^[:space:]]+$'
  ),
  constraint crm_conversation_links_label_length check (
    label is null or char_length(trim(label)) between 2 and 80
  )
);

create unique index crm_conversation_links_one_primary_idx
  on public.crm_conversation_links (contact_id)
  where is_primary;

create index crm_conversation_links_contact_org_idx
  on public.crm_conversation_links (contact_id, organization_id, id);

create index crm_conversation_links_org_contact_idx
  on public.crm_conversation_links (organization_id, contact_id, created_at, id);

create index crm_conversation_links_creator_idx
  on public.crm_conversation_links (created_by);

alter table public.crm_conversation_links enable row level security;

create policy "crm_conversation_links_select_contact_scope"
on public.crm_conversation_links
for select
to authenticated
using (
  (select private.can_access_crm_contact(contact_id, organization_id))
);

revoke all on table public.crm_conversation_links from anon, authenticated;
grant select on table public.crm_conversation_links to authenticated;

create or replace function public.create_crm_lead_v2(
  target_user_id uuid,
  target_organization_id uuid,
  contact_full_name text,
  contact_source public.crm_source,
  contact_source_detail text,
  contact_interest public.crm_interest,
  contact_interest_detail text,
  contact_owner_id uuid,
  contact_consent_status public.crm_consent_status,
  identity_kind public.crm_identity_kind,
  identity_value text,
  initial_notes text,
  target_follow_up_at timestamptz,
  target_conversation_channel public.crm_conversation_channel,
  target_conversation_url text,
  target_conversation_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_source_detail text := nullif(trim(contact_source_detail), '');
  clean_interest_detail text := nullif(trim(contact_interest_detail), '');
  clean_conversation_url text := nullif(trim(target_conversation_url), '');
  clean_conversation_label text := nullif(trim(target_conversation_label), '');
  contact_id uuid;
begin
  if contact_source = 'other' then
    if clean_source_detail is null
      or char_length(clean_source_detail) not between 2 and 160 then
      raise exception 'Custom registration source must contain between 2 and 160 characters';
    end if;
  elsif clean_source_detail is not null then
    raise exception 'A custom registration source is allowed only with the Other source';
  end if;

  if contact_interest = 'other' then
    if clean_interest_detail is null
      or char_length(clean_interest_detail) not between 2 and 160 then
      raise exception 'Custom registration reason must contain between 2 and 160 characters';
    end if;
  elsif clean_interest_detail is not null then
    raise exception 'A custom registration reason is allowed only with the Other reason';
  end if;

  if (target_conversation_channel is null) <> (clean_conversation_url is null) then
    raise exception 'Conversation channel and conversation link must be provided together';
  end if;

  if clean_conversation_url is null and clean_conversation_label is not null then
    raise exception 'Conversation label requires a conversation link';
  end if;

  if clean_conversation_url is not null then
    if char_length(clean_conversation_url) not between 8 and 2000
      or clean_conversation_url !~* '^https?://[^[:space:]]+$' then
      raise exception 'Conversation link must be a valid HTTP or HTTPS URL';
    end if;

    if clean_conversation_label is not null
      and char_length(clean_conversation_label) not between 2 and 80 then
      raise exception 'Conversation label must contain between 2 and 80 characters';
    end if;
  end if;

  contact_id := public.create_crm_lead(
    target_user_id,
    target_organization_id,
    contact_full_name,
    contact_source,
    contact_interest,
    contact_owner_id,
    contact_consent_status,
    identity_kind,
    identity_value,
    initial_notes,
    target_follow_up_at
  );

  update public.crm_contacts contact
  set
    source_detail = clean_source_detail,
    interest_detail = clean_interest_detail
  where contact.id = contact_id;

  if clean_conversation_url is not null then
    insert into public.crm_conversation_links (
      organization_id,
      contact_id,
      channel,
      label,
      url,
      is_primary,
      created_by
    ) values (
      target_organization_id,
      contact_id,
      target_conversation_channel,
      clean_conversation_label,
      clean_conversation_url,
      true,
      target_user_id
    );
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'crm.contact_context_added',
    'crm_contact',
    contact_id,
    jsonb_build_object(
      'source_detail', clean_source_detail,
      'interest_detail', clean_interest_detail,
      'conversation_channel', target_conversation_channel,
      'has_conversation_link', clean_conversation_url is not null
    )
  );

  return contact_id;
end;
$$;

revoke all on function public.create_crm_lead_v2(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz,
  public.crm_conversation_channel, text, text
) from public, anon, authenticated;

grant execute on function public.create_crm_lead_v2(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz,
  public.crm_conversation_channel, text, text
) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'crm_conversation_links'
  ) then
    alter publication supabase_realtime add table public.crm_conversation_links;
  end if;
end;
$$;

comment on table public.crm_conversation_links is
  'Direct conversation URLs for CRM contacts; readable only within the same contact visibility scope.';

comment on function public.create_crm_lead_v2(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz,
  public.crm_conversation_channel, text, text
) is 'Creates one CRM lead, initial follow-up task, optional custom acquisition context, and optional conversation link atomically.';
