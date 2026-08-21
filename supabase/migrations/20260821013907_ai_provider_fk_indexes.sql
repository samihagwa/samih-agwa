create index ai_provider_secrets_provider_org_idx
  on private.ai_provider_secrets (provider_id, organization_id);

create index ai_providers_created_by_idx
  on public.ai_providers (created_by);

create index ai_providers_updated_by_idx
  on public.ai_providers (updated_by);
