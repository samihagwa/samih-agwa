-- Telegram media inbox for the connected publishing administrator. The bot
-- keeps Telegram file_id values server-side and stores only a small private
-- preview thumbnail for the authenticated workspace UI.

create table public.publishing_telegram_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  received_by_user_id uuid not null references public.profiles (id) on delete restrict,
  telegram_chat_id bigint not null,
  telegram_user_id bigint not null,
  telegram_message_id bigint not null,
  telegram_file_id text not null,
  telegram_file_unique_id text not null,
  media_kind text not null,
  display_name text not null,
  original_caption text,
  file_name text,
  mime_type text,
  file_size bigint,
  width integer,
  height integer,
  duration_seconds integer,
  preview_object_path text,
  archived_at timestamptz,
  last_received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_telegram_assets_kind_allowed check (media_kind in ('photo', 'video')),
  constraint publishing_telegram_assets_display_name_length check (char_length(trim(display_name)) between 2 and 180),
  constraint publishing_telegram_assets_file_id_length check (char_length(telegram_file_id) between 8 and 1024),
  constraint publishing_telegram_assets_unique_id_length check (char_length(telegram_file_unique_id) between 4 and 256),
  constraint publishing_telegram_assets_caption_length check (original_caption is null or char_length(original_caption) <= 1024),
  constraint publishing_telegram_assets_file_name_length check (file_name is null or char_length(file_name) <= 255),
  constraint publishing_telegram_assets_mime_length check (mime_type is null or char_length(mime_type) <= 160),
  constraint publishing_telegram_assets_size_valid check (file_size is null or file_size >= 0),
  constraint publishing_telegram_assets_dimensions_valid check (
    (width is null or width > 0) and (height is null or height > 0)
  ),
  constraint publishing_telegram_assets_duration_valid check (duration_seconds is null or duration_seconds >= 0),
  constraint publishing_telegram_assets_preview_path_length check (
    preview_object_path is null or char_length(preview_object_path) between 10 and 1024
  ),
  constraint publishing_telegram_assets_org_file_unique unique (organization_id, telegram_file_unique_id),
  constraint publishing_telegram_assets_org_id_unique unique (organization_id, id)
);

create index publishing_telegram_assets_org_recent_idx
  on public.publishing_telegram_assets (organization_id, created_at desc, id)
  where archived_at is null;
create index publishing_telegram_assets_receiver_idx
  on public.publishing_telegram_assets (received_by_user_id);

create trigger publishing_telegram_assets_set_updated_at
before update on public.publishing_telegram_assets
for each row execute function private.set_updated_at();

alter table public.publishing_telegram_assets enable row level security;

create policy "publishing_telegram_assets_select_members"
on public.publishing_telegram_assets
for select to authenticated
using ((select private.is_org_member(organization_id)));

revoke all on table public.publishing_telegram_assets from anon, authenticated;
grant select on table public.publishing_telegram_assets to authenticated;

alter table public.publishing_posts
  add column media_asset_id uuid,
  add constraint publishing_posts_media_asset_kind check (
    media_asset_id is null or media_kind in ('photo', 'video')
  ),
  add constraint publishing_posts_media_asset_org_fkey
    foreign key (organization_id, media_asset_id)
    references public.publishing_telegram_assets (organization_id, id)
    on delete restrict;

create index publishing_posts_media_asset_idx
  on public.publishing_posts (media_asset_id)
  where media_asset_id is not null;

create or replace function private.resolve_publishing_post_media_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_asset_id uuid;
begin
  if new.media_kind = 'none' or new.media_source is null then
    new.media_asset_id := null;
    return new;
  end if;

  if new.media_source ~* '^https://[^[:space:]]+$' then
    new.media_asset_id := null;
    return new;
  end if;

  select asset.id into resolved_asset_id
  from public.publishing_telegram_assets asset
  where asset.organization_id = new.organization_id
    and asset.telegram_file_id = new.media_source
    and asset.media_kind = new.media_kind
    and asset.archived_at is null
  order by asset.last_received_at desc
  limit 1;

  if resolved_asset_id is null then
    raise exception 'Choose this Telegram file from the organization media library';
  end if;

  new.media_asset_id := resolved_asset_id;
  return new;
end;
$$;

create trigger publishing_posts_resolve_media_asset
before insert or update of organization_id, media_kind, media_source
on public.publishing_posts
for each row execute function private.resolve_publishing_post_media_asset();

revoke all on function private.resolve_publishing_post_media_asset() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'publishing-media-previews',
  'publishing-media-previews',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "publishing_media_previews_select_members"
on storage.objects
for select to authenticated
using (
  bucket_id = 'publishing-media-previews'
  and exists (
    select 1
    from public.publishing_telegram_assets asset
    where asset.preview_object_path = storage.objects.name
      and (select private.is_org_member(asset.organization_id))
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'publishing_telegram_assets'
  ) then
    alter publication supabase_realtime add table public.publishing_telegram_assets;
  end if;
end;
$$;
