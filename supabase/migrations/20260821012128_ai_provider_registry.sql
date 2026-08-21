-- Organization-scoped AI provider registry.
-- Provider credentials are encrypted in Supabase Vault and never exposed through
-- public tables or authenticated RPCs. Mutations are owner-only service commands.

create type public.ai_api_protocol as enum (
  'openai_chat_completions',
  'openai_responses'
);

create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  protocol public.ai_api_protocol not null,
  base_url text not null,
  model text not null,
  is_enabled boolean not null default true,
  is_default boolean not null default false,
  key_hint text not null,
  last_tested_at timestamptz,
  last_test_status text not null default 'untested',
  last_test_message text,
  created_by uuid not null references auth.users (id),
  updated_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint ai_providers_name_length check (char_length(trim(name)) between 2 and 80),
  constraint ai_providers_base_url_https check (
    char_length(base_url) between 9 and 500
    and base_url ~ '^https://[^[:space:]]+$'
  ),
  constraint ai_providers_model_length check (char_length(trim(model)) between 1 and 200),
  constraint ai_providers_key_hint_length check (char_length(key_hint) between 1 and 8),
  constraint ai_providers_test_status_allowed check (last_test_status in ('untested', 'success', 'failed')),
  constraint ai_providers_test_message_length check (last_test_message is null or char_length(last_test_message) <= 300)
);

create unique index ai_providers_org_name_unique
  on public.ai_providers (organization_id, lower(name));

create unique index ai_providers_one_default_per_org
  on public.ai_providers (organization_id)
  where is_default;

create index ai_providers_org_enabled_idx
  on public.ai_providers (organization_id, is_enabled, updated_at desc);

create table private.ai_provider_secrets (
  provider_id uuid not null,
  organization_id uuid not null,
  vault_secret_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider_id),
  foreign key (provider_id, organization_id)
    references public.ai_providers (id, organization_id) on delete cascade
);

create trigger ai_providers_set_updated_at
before update on public.ai_providers
for each row execute function private.set_updated_at();

create trigger ai_provider_secrets_set_updated_at
before update on private.ai_provider_secrets
for each row execute function private.set_updated_at();

alter table public.ai_providers enable row level security;

create policy "ai_providers_select_owner"
on public.ai_providers
for select
to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner']::public.app_role[]
  )
);

revoke all on table public.ai_providers from anon, authenticated;
grant select on table public.ai_providers to authenticated;
revoke all on table private.ai_provider_secrets from public, anon, authenticated;

create or replace function private.is_ai_provider_owner(
  target_user_id uuid,
  target_organization_id uuid
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
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role = 'owner'
  );
$$;

create or replace function public.save_ai_provider(
  target_user_id uuid,
  target_organization_id uuid,
  target_provider_id uuid,
  provider_name text,
  provider_protocol public.ai_api_protocol,
  provider_base_url text,
  provider_model text,
  provider_api_key text,
  provider_is_default boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_record public.ai_providers%rowtype;
  previous_record public.ai_providers%rowtype;
  provider_id uuid := coalesce(target_provider_id, gen_random_uuid());
  secret_id uuid;
  secret_name text;
  clean_name text := trim(provider_name);
  clean_base_url text := rtrim(trim(provider_base_url), '/');
  clean_model text := trim(provider_model);
  clean_api_key text := trim(provider_api_key);
  should_be_default boolean;
  config_changed boolean := false;
begin
  if not private.is_ai_provider_owner(target_user_id, target_organization_id) then
    raise exception 'Only an active organization owner can manage AI providers';
  end if;
  if char_length(clean_name) not between 2 and 80 then raise exception 'Provider name is invalid'; end if;
  if clean_base_url !~ '^https://[^[:space:]]+$' or char_length(clean_base_url) > 500 then
    raise exception 'Provider base URL must be a valid HTTPS URL';
  end if;
  if char_length(clean_model) not between 1 and 200 then raise exception 'Provider model is invalid'; end if;
  if clean_api_key <> '' and char_length(clean_api_key) not between 8 and 2000 then
    raise exception 'Provider API key is invalid';
  end if;

  if target_provider_id is not null then
    select * into previous_record
    from public.ai_providers
    where id = target_provider_id and organization_id = target_organization_id
    for update;
    if previous_record.id is null then raise exception 'AI provider not found'; end if;
    if clean_api_key = '' and not exists (
      select 1 from private.ai_provider_secrets secret_ref where secret_ref.provider_id = target_provider_id
    ) then
      raise exception 'Provider API key is required';
    end if;

    config_changed := previous_record.protocol <> provider_protocol
      or previous_record.base_url <> clean_base_url
      or previous_record.model <> clean_model
      or clean_api_key <> '';

    update public.ai_providers
    set name = clean_name,
        protocol = provider_protocol,
        base_url = clean_base_url,
        model = clean_model,
        key_hint = case when clean_api_key <> '' then right(clean_api_key, 4) else key_hint end,
        is_enabled = true,
        updated_by = target_user_id,
        last_tested_at = case when config_changed then null else last_tested_at end,
        last_test_status = case when config_changed then 'untested' else last_test_status end,
        last_test_message = case when config_changed then null else last_test_message end
    where id = target_provider_id
    returning * into provider_record;
  else
    if clean_api_key = '' then raise exception 'Provider API key is required'; end if;
    insert into public.ai_providers (
      id, organization_id, name, protocol, base_url, model, key_hint,
      created_by, updated_by
    ) values (
      provider_id, target_organization_id, clean_name, provider_protocol,
      clean_base_url, clean_model, right(clean_api_key, 4), target_user_id, target_user_id
    ) returning * into provider_record;
  end if;

  secret_name := 'mw_ai_' || replace(target_organization_id::text, '-', '') || '_' || replace(provider_id::text, '-', '');
  select secret_ref.vault_secret_id into secret_id
  from private.ai_provider_secrets secret_ref
  where secret_ref.provider_id = provider_id
  for update;

  if clean_api_key <> '' then
    if secret_id is null then
      secret_id := vault.create_secret(
        clean_api_key,
        secret_name,
        'Market Whales AI provider credential. Managed by owner-only commands.'
      );
      insert into private.ai_provider_secrets (provider_id, organization_id, vault_secret_id)
      values (provider_id, target_organization_id, secret_id);
    else
      perform vault.update_secret(
        secret_id,
        clean_api_key,
        secret_name,
        'Market Whales AI provider credential. Managed by owner-only commands.'
      );
    end if;
  end if;

  should_be_default := coalesce(provider_is_default, false)
    or coalesce(previous_record.is_default, false)
    or not exists (
      select 1 from public.ai_providers existing
      where existing.organization_id = target_organization_id and existing.is_default
    );
  if should_be_default then
    update public.ai_providers
    set is_default = false, updated_by = target_user_id
    where organization_id = target_organization_id and id <> provider_id and is_default;
    update public.ai_providers
    set is_default = true, updated_by = target_user_id
    where id = provider_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    target_organization_id,
    target_user_id,
    case when target_provider_id is null then 'ai_provider.created' else 'ai_provider.updated' end,
    'ai_provider',
    provider_id,
    case when target_provider_id is null then null else jsonb_build_object(
      'name', previous_record.name,
      'protocol', previous_record.protocol,
      'base_url', previous_record.base_url,
      'model', previous_record.model,
      'is_default', previous_record.is_default
    ) end,
    jsonb_build_object(
      'name', clean_name,
      'protocol', provider_protocol,
      'base_url', clean_base_url,
      'model', clean_model,
      'is_default', should_be_default,
      'credential_rotated', clean_api_key <> ''
    )
  );
  return provider_id;
end;
$$;

create or replace function public.set_default_ai_provider(
  target_user_id uuid,
  target_provider_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_record public.ai_providers%rowtype;
begin
  select * into provider_record from public.ai_providers where id = target_provider_id for update;
  if provider_record.id is null then raise exception 'AI provider not found'; end if;
  if not private.is_ai_provider_owner(target_user_id, provider_record.organization_id) then
    raise exception 'Only an active organization owner can manage AI providers';
  end if;
  update public.ai_providers
  set is_default = false, updated_by = target_user_id
  where organization_id = provider_record.organization_id and id <> target_provider_id and is_default;
  update public.ai_providers
  set is_default = true, is_enabled = true, updated_by = target_user_id
  where id = target_provider_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    provider_record.organization_id, target_user_id, 'ai_provider.defaulted',
    'ai_provider', target_provider_id, jsonb_build_object('model', provider_record.model)
  );
  return true;
end;
$$;

create or replace function public.record_ai_provider_test(
  target_user_id uuid,
  target_provider_id uuid,
  test_success boolean,
  test_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_record public.ai_providers%rowtype;
  safe_message text := left(nullif(trim(test_message), ''), 300);
begin
  select * into provider_record from public.ai_providers where id = target_provider_id for update;
  if provider_record.id is null then raise exception 'AI provider not found'; end if;
  if not private.is_ai_provider_owner(target_user_id, provider_record.organization_id) then
    raise exception 'Only an active organization owner can manage AI providers';
  end if;
  update public.ai_providers
  set last_tested_at = now(),
      last_test_status = case when test_success then 'success' else 'failed' end,
      last_test_message = safe_message,
      updated_by = target_user_id
  where id = target_provider_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    provider_record.organization_id, target_user_id, 'ai_provider.tested', 'ai_provider',
    target_provider_id, jsonb_build_object('success', test_success, 'message', safe_message)
  );
  return true;
end;
$$;

create or replace function public.delete_ai_provider(
  target_user_id uuid,
  target_provider_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_record public.ai_providers%rowtype;
  secret_id uuid;
  promoted_provider_id uuid;
begin
  select * into provider_record from public.ai_providers where id = target_provider_id for update;
  if provider_record.id is null then raise exception 'AI provider not found'; end if;
  if not private.is_ai_provider_owner(target_user_id, provider_record.organization_id) then
    raise exception 'Only an active organization owner can manage AI providers';
  end if;
  select vault_secret_id into secret_id
  from private.ai_provider_secrets where provider_id = target_provider_id;
  delete from public.ai_providers where id = target_provider_id;
  if secret_id is not null then delete from vault.secrets where id = secret_id; end if;

  if provider_record.is_default then
    select id into promoted_provider_id
    from public.ai_providers
    where organization_id = provider_record.organization_id and is_enabled
    order by updated_at desc, created_at desc
    limit 1
    for update;
    if promoted_provider_id is not null then
      update public.ai_providers
      set is_default = true, updated_by = target_user_id
      where id = promoted_provider_id;
    end if;
  end if;

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, before_data)
  values (
    provider_record.organization_id, target_user_id, 'ai_provider.deleted', 'ai_provider',
    target_provider_id, jsonb_build_object(
      'name', provider_record.name,
      'protocol', provider_record.protocol,
      'base_url', provider_record.base_url,
      'model', provider_record.model,
      'was_default', provider_record.is_default,
      'promoted_provider_id', promoted_provider_id
    )
  );
  return true;
end;
$$;

create or replace function public.get_ai_provider_runtime_for_owner(
  target_user_id uuid,
  target_provider_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  provider_record public.ai_providers%rowtype;
  api_key text;
begin
  select * into provider_record
  from public.ai_providers
  where id = target_provider_id and is_enabled;
  if provider_record.id is null then raise exception 'AI provider not found'; end if;
  if not private.is_ai_provider_owner(target_user_id, provider_record.organization_id) then
    raise exception 'Only an active organization owner can manage AI providers';
  end if;
  select decrypted.decrypted_secret into api_key
  from private.ai_provider_secrets secret_ref
  join vault.decrypted_secrets decrypted on decrypted.id = secret_ref.vault_secret_id
  where secret_ref.provider_id = provider_record.id;
  if api_key is null then raise exception 'AI provider credential is missing'; end if;
  return jsonb_build_object(
    'id', provider_record.id,
    'organization_id', provider_record.organization_id,
    'name', provider_record.name,
    'protocol', provider_record.protocol,
    'base_url', provider_record.base_url,
    'model', provider_record.model,
    'api_key', api_key
  );
end;
$$;

create or replace function public.get_script_ai_provider_runtime(
  target_user_id uuid,
  target_script_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  provider_record public.ai_providers%rowtype;
  api_key text;
begin
  select * into script_record from public.scripts where id = target_script_id;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(
    target_user_id, script_record.organization_id, script_record.assigned_to
  ) then
    raise exception 'You cannot generate this private script';
  end if;

  select * into provider_record
  from public.ai_providers
  where organization_id = script_record.organization_id
    and is_enabled
    and is_default
  limit 1;
  if provider_record.id is null then return null; end if;

  select decrypted.decrypted_secret into api_key
  from private.ai_provider_secrets secret_ref
  join vault.decrypted_secrets decrypted on decrypted.id = secret_ref.vault_secret_id
  where secret_ref.provider_id = provider_record.id;
  if api_key is null then return null; end if;

  return jsonb_build_object(
    'id', provider_record.id,
    'name', provider_record.name,
    'protocol', provider_record.protocol,
    'base_url', provider_record.base_url,
    'model', provider_record.model,
    'api_key', api_key
  );
end;
$$;

revoke all on function private.is_ai_provider_owner(uuid, uuid) from public, anon, authenticated;

revoke all on function public.save_ai_provider(
  uuid, uuid, uuid, text, public.ai_api_protocol, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.save_ai_provider(
  uuid, uuid, uuid, text, public.ai_api_protocol, text, text, text, boolean
) to service_role;

revoke all on function public.set_default_ai_provider(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_default_ai_provider(uuid, uuid) to service_role;

revoke all on function public.record_ai_provider_test(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.record_ai_provider_test(uuid, uuid, boolean, text) to service_role;

revoke all on function public.delete_ai_provider(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_ai_provider(uuid, uuid) to service_role;

revoke all on function public.get_ai_provider_runtime_for_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_ai_provider_runtime_for_owner(uuid, uuid) to service_role;

revoke all on function public.get_script_ai_provider_runtime(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_script_ai_provider_runtime(uuid, uuid) to service_role;
