-- Qualify the generated provider identifier so it cannot conflict with the
-- provider_id column inside PL/pgSQL statements.
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
  resolved_provider_id uuid := coalesce(target_provider_id, gen_random_uuid());
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
      resolved_provider_id, target_organization_id, clean_name, provider_protocol,
      clean_base_url, clean_model, right(clean_api_key, 4), target_user_id, target_user_id
    ) returning * into provider_record;
  end if;

  secret_name := 'mw_ai_' || replace(target_organization_id::text, '-', '') || '_' || replace(resolved_provider_id::text, '-', '');
  select secret_ref.vault_secret_id into secret_id
  from private.ai_provider_secrets secret_ref
  where secret_ref.provider_id = resolved_provider_id
  for update;

  if clean_api_key <> '' then
    if secret_id is null then
      secret_id := vault.create_secret(
        clean_api_key,
        secret_name,
        'Market Whales AI provider credential. Managed by owner-only commands.'
      );
      insert into private.ai_provider_secrets (provider_id, organization_id, vault_secret_id)
      values (resolved_provider_id, target_organization_id, secret_id);
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
    where organization_id = target_organization_id and id <> resolved_provider_id and is_default;
    update public.ai_providers
    set is_default = true, updated_by = target_user_id
    where id = resolved_provider_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    target_organization_id,
    target_user_id,
    case when target_provider_id is null then 'ai_provider.created' else 'ai_provider.updated' end,
    'ai_provider',
    resolved_provider_id,
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
  return resolved_provider_id;
end;
$$;

revoke all on function public.save_ai_provider(
  uuid, uuid, uuid, text, public.ai_api_protocol, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.save_ai_provider(
  uuid, uuid, uuid, text, public.ai_api_protocol, text, text, text, boolean
) to service_role;
