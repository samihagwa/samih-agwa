-- One-time production reset requested before team onboarding.
-- Preserve scripts and their handoff content, CRM history, publishing, team,
-- AI configuration, and brand knowledge. Remove only pre-cutoff test operations.

do $$
declare
  target_org_id uuid;
  owner_user_id uuid;
  reset_cutoff constant timestamptz := '2026-08-31 13:33:34.508169+00';
  task_count_before bigint;
  deletable_content_count bigint;
  plan_count_before bigint;
  launch_count_before bigint;
  protected_workflow_count bigint;
  publishing_links_to_deletable bigint;
  scripts_before bigint;
  script_versions_before bigint;
  script_research_before bigint;
  voice_profiles_before bigint;
  crm_contacts_before bigint;
  crm_identities_before bigint;
  crm_activities_before bigint;
  crm_links_before bigint;
  crm_batches_before bigint;
  crm_rows_before bigint;
  crm_intake_before bigint;
  memberships_before bigint;
  publishing_posts_before bigint;
  publishing_schedules_before bigint;
  publishing_channels_before bigint;
  publishing_occurrences_before bigint;
  publishing_logs_before bigint;
  publishing_assets_before bigint;
  ai_providers_before bigint;
  brand_articles_before bigint;
  historical_reclassified bigint;
  linked_content_archived bigint;
begin
  select organization.id into target_org_id
  from public.organizations organization
  where organization.slug = 'market-whales'
  limit 1;
  if target_org_id is null then
    raise exception 'Market Whales organization was not found; reset aborted';
  end if;

  select membership.user_id into owner_user_id
  from public.memberships membership
  where membership.organization_id = target_org_id
    and membership.status = 'active'
    and membership.role = 'owner'
  order by membership.created_at, membership.user_id
  limit 1;
  if owner_user_id is null then
    raise exception 'Market Whales owner was not found; reset aborted';
  end if;

  -- Keep the public intake transaction from racing the one-time reset. New
  -- registrations wait briefly, then continue against the clean Sales setup.
  execute 'lock table public.tasks, public.crm_contacts, public.crm_lead_routing_members in share row exclusive mode';

  select count(*) into task_count_before
  from public.tasks task
  where task.organization_id = target_org_id and task.created_at <= reset_cutoff;
  select count(*) into deletable_content_count
  from public.content_items item
  where item.organization_id = target_org_id
    and item.created_at <= reset_cutoff
    and not exists (
      select 1 from public.scripts script
      where script.organization_id = item.organization_id
        and script.content_item_id = item.id
    );
  select count(*) into plan_count_before
  from public.content_plans plan
  where plan.organization_id = target_org_id and plan.created_at <= reset_cutoff;
  select count(*) into launch_count_before
  from public.launches launch
  where launch.organization_id = target_org_id and launch.created_at <= reset_cutoff;

  -- Exact preflight protects a later production state from an unexpectedly
  -- broad cleanup if this one-time migration is ever replayed elsewhere.
  if task_count_before <> 64
    or deletable_content_count <> 8
    or plan_count_before <> 2
    or launch_count_before <> 1 then
    raise exception
      'Production reset preflight mismatch (tasks %, content %, plans %, launches %); reset aborted',
      task_count_before, deletable_content_count, plan_count_before, launch_count_before;
  end if;

  select count(*) into protected_workflow_count
  from public.crm_indicator_workflows workflow
  join public.tasks task
    on task.id in (workflow.activation_task_id, workflow.sales_task_id)
  where workflow.organization_id = target_org_id
    and task.created_at <= reset_cutoff;
  if protected_workflow_count <> 0 then
    raise exception 'A CRM indicator workflow references reset tasks; reset aborted';
  end if;

  select count(*) into publishing_links_to_deletable
  from public.publishing_posts post
  join public.content_items item on item.id = post.content_item_id
  where item.organization_id = target_org_id
    and item.created_at <= reset_cutoff
    and not exists (
      select 1 from public.scripts script
      where script.organization_id = item.organization_id
        and script.content_item_id = item.id
    );
  if publishing_links_to_deletable <> 0 then
    raise exception 'A publishing post references disposable test content; reset aborted';
  end if;

  select count(*) into scripts_before from public.scripts where organization_id = target_org_id;
  select count(*) into script_versions_before from public.script_versions where organization_id = target_org_id;
  select count(*) into script_research_before from public.script_research_items where organization_id = target_org_id;
  select count(*) into voice_profiles_before from public.script_voice_profiles where organization_id = target_org_id;
  select count(*) into crm_contacts_before from public.crm_contacts where organization_id = target_org_id;
  select count(*) into crm_identities_before from public.crm_identities where organization_id = target_org_id;
  select count(*) into crm_activities_before from public.crm_activities where organization_id = target_org_id;
  select count(*) into crm_links_before from public.crm_conversation_links where organization_id = target_org_id;
  select count(*) into crm_batches_before from public.crm_import_batches where organization_id = target_org_id;
  select count(*) into crm_rows_before from public.crm_import_rows where organization_id = target_org_id;
  select count(*) into crm_intake_before from public.crm_lead_intake_events where organization_id = target_org_id;
  select count(*) into memberships_before from public.memberships where organization_id = target_org_id;
  select count(*) into publishing_posts_before from public.publishing_posts where organization_id = target_org_id;
  select count(*) into publishing_schedules_before from public.publishing_schedules where organization_id = target_org_id;
  select count(*) into publishing_channels_before from public.publishing_channels where organization_id = target_org_id;
  select count(*) into publishing_occurrences_before from public.publishing_occurrences where organization_id = target_org_id;
  select count(*) into publishing_logs_before from public.publishing_publication_logs where organization_id = target_org_id;
  select count(*) into publishing_assets_before from public.publishing_telegram_assets where organization_id = target_org_id;
  select count(*) into ai_providers_before from public.ai_providers where organization_id = target_org_id;
  select count(*) into brand_articles_before from public.brand_articles where organization_id = target_org_id;

  -- Test notifications are cleared first; their Telegram outbox rows cascade.
  delete from public.notifications notification
  where notification.organization_id = target_org_id
    and notification.created_at <= reset_cutoff;

  -- Restrictive task children must be removed before their tasks.
  delete from public.task_revision_requests revision
  using public.tasks task
  where revision.task_id = task.id
    and task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.content_revision_requests revision
  using public.tasks task
  where revision.task_id = task.id
    and task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.task_events event
  using public.tasks task
  where event.task_id = task.id
    and task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.task_dependencies dependency
  using public.tasks task
  where task.organization_id = target_org_id
    and task.created_at <= reset_cutoff
    and (dependency.task_id = task.id or dependency.depends_on_task_id = task.id);

  -- These tables use cascading task foreign keys, but explicit deletion keeps
  -- the reset scope obvious and independently auditable.
  delete from public.task_discussion_messages discussion
  using public.tasks task
  where discussion.task_id = task.id
    and task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.task_deliveries delivery
  using public.tasks task
  where delivery.task_id = task.id
    and task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.content_step_deliveries delivery
  using public.tasks task
  where delivery.task_id = task.id
    and task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.tasks task
  where task.organization_id = target_org_id
    and task.created_at <= reset_cutoff;

  delete from public.recurring_task_templates template
  where template.organization_id = target_org_id
    and template.created_at <= reset_cutoff;

  -- Remove test launches after their tasks no longer hold restrictive links.
  delete from public.launch_deliverable_dependencies dependency
  using public.launches launch
  where dependency.launch_id = launch.id
    and launch.organization_id = target_org_id
    and launch.created_at <= reset_cutoff;

  delete from public.launch_content_items link
  using public.launches launch
  where link.launch_id = launch.id
    and launch.organization_id = target_org_id
    and launch.created_at <= reset_cutoff;

  delete from public.launch_deliverables deliverable
  using public.launches launch
  where deliverable.launch_id = launch.id
    and launch.organization_id = target_org_id
    and launch.created_at <= reset_cutoff;

  delete from public.launch_documents document
  using public.launches launch
  where document.launch_id = launch.id
    and launch.organization_id = target_org_id
    and launch.created_at <= reset_cutoff;

  delete from public.launches launch
  where launch.organization_id = target_org_id
    and launch.created_at <= reset_cutoff;

  -- Remove test plan children. The owner-only delete trigger is temporarily
  -- disabled only inside this transaction; rollback restores it on any error.
  delete from public.content_plan_items item
  using public.content_plans plan
  where item.plan_id = plan.id
    and plan.organization_id = target_org_id
    and plan.created_at <= reset_cutoff;

  delete from public.content_plan_pillars pillar
  using public.content_plans plan
  where pillar.plan_id = plan.id
    and plan.organization_id = target_org_id
    and plan.created_at <= reset_cutoff;

  alter table public.content_plans disable trigger content_plans_guard_and_audit_delete;
  delete from public.content_plans plan
  where plan.organization_id = target_org_id
    and plan.created_at <= reset_cutoff;
  alter table public.content_plans enable trigger content_plans_guard_and_audit_delete;

  -- Keep the one content record referenced by a preserved script handoff.
  delete from public.content_items item
  where item.organization_id = target_org_id
    and item.created_at <= reset_cutoff
    and not exists (
      select 1 from public.scripts script
      where script.organization_id = item.organization_id
        and script.content_item_id = item.id
    );

  -- One content row is required by a preserved handed-off script. Keep the
  -- referential link, but move the orphaned production card out of the active
  -- board now that its test tasks have been removed.
  update public.content_items item
  set status = 'cancelled',
      updated_at = now(),
      version = version + 1
  where item.organization_id = target_org_id
    and item.created_at <= reset_cutoff
    and exists (
      select 1 from public.scripts script
      where script.organization_id = item.organization_id
        and script.content_item_id = item.id
    );
  get diagnostics linked_content_archived = row_count;
  if linked_content_archived <> 1 then
    raise exception 'The preserved script content handoff did not match the reset preflight';
  end if;

  -- The existing selected Sales member was a test account. Future members are
  -- chosen explicitly by the owner; no ordinary member becomes Sales by login.
  delete from public.crm_lead_routing_members route
  where route.organization_id = target_org_id;

  -- Historical sheet registrations were already contacted before this system.
  -- Reclassify only untouched historical records and create no task/activity.
  update public.crm_contacts contact
  set stage = 'contacted',
      follow_up_required = false,
      next_follow_up_at = null,
      updated_at = now(),
      version = version + 1
  where contact.organization_id = target_org_id
    and contact.stage = 'new'
    and not contact.follow_up_required
    and contact.next_follow_up_at is null
    and contact.id in (
      select distinct intake.contact_id
      from public.crm_lead_intake_events intake
      where intake.organization_id = target_org_id
        and intake.source_system = 'google_sheet_whales_zone'
        and intake.outcome = 'created'
        and intake.contact_id is not null
    );
  get diagnostics historical_reclassified = row_count;
  if historical_reclassified <> 115 then
    raise exception
      'Historical Whales Zone reclassification mismatch (expected 115, changed %); reset aborted',
      historical_reclassified;
  end if;

  -- Old operational audit noise should not pollute the clean analytics start.
  delete from public.audit_events audit
  where audit.organization_id = target_org_id
    and audit.occurred_at <= reset_cutoff
    and audit.entity_type in (
      'task', 'task_delivery', 'content_item', 'content_revision',
      'content_step_delivery', 'content_timeline_cue', 'content_plan',
      'content_plan_item', 'content_plans', 'content_plan_items',
      'content_plan_pillars', 'launch', 'launch_deliverable'
    );

  if exists (
    select 1 from public.tasks task
    where task.organization_id = target_org_id and task.created_at <= reset_cutoff
  ) or exists (
    select 1 from public.content_plans plan
    where plan.organization_id = target_org_id and plan.created_at <= reset_cutoff
  ) or exists (
    select 1 from public.launches launch
    where launch.organization_id = target_org_id and launch.created_at <= reset_cutoff
  ) then
    raise exception 'Operational reset did not clear every scoped record';
  end if;

  if scripts_before <> (select count(*) from public.scripts where organization_id = target_org_id)
    or script_versions_before <> (select count(*) from public.script_versions where organization_id = target_org_id)
    or script_research_before <> (select count(*) from public.script_research_items where organization_id = target_org_id)
    or voice_profiles_before <> (select count(*) from public.script_voice_profiles where organization_id = target_org_id)
    or crm_contacts_before <> (select count(*) from public.crm_contacts where organization_id = target_org_id)
    or crm_identities_before <> (select count(*) from public.crm_identities where organization_id = target_org_id)
    or crm_activities_before <> (select count(*) from public.crm_activities where organization_id = target_org_id)
    or crm_links_before <> (select count(*) from public.crm_conversation_links where organization_id = target_org_id)
    or crm_batches_before <> (select count(*) from public.crm_import_batches where organization_id = target_org_id)
    or crm_rows_before <> (select count(*) from public.crm_import_rows where organization_id = target_org_id)
    or crm_intake_before <> (select count(*) from public.crm_lead_intake_events where organization_id = target_org_id)
    or memberships_before <> (select count(*) from public.memberships where organization_id = target_org_id)
    or publishing_posts_before <> (select count(*) from public.publishing_posts where organization_id = target_org_id)
    or publishing_schedules_before <> (select count(*) from public.publishing_schedules where organization_id = target_org_id)
    or publishing_channels_before <> (select count(*) from public.publishing_channels where organization_id = target_org_id)
    or publishing_occurrences_before <> (select count(*) from public.publishing_occurrences where organization_id = target_org_id)
    or publishing_logs_before <> (select count(*) from public.publishing_publication_logs where organization_id = target_org_id)
    or publishing_assets_before <> (select count(*) from public.publishing_telegram_assets where organization_id = target_org_id)
    or ai_providers_before <> (select count(*) from public.ai_providers where organization_id = target_org_id)
    or brand_articles_before <> (select count(*) from public.brand_articles where organization_id = target_org_id) then
    raise exception 'A protected data set changed during the reset; transaction aborted';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_org_id,
    owner_user_id,
    'system.production_operational_reset',
    'system_reset',
    target_org_id,
    jsonb_build_object(
      'cutoff', reset_cutoff,
      'deleted_tasks', task_count_before,
      'deleted_content_items', deletable_content_count,
      'deleted_content_plans', plan_count_before,
      'deleted_launches', launch_count_before,
      'linked_script_content_archived', linked_content_archived,
      'historical_contacts_reclassified', historical_reclassified,
      'scripts_preserved', scripts_before,
      'crm_contacts_preserved', crm_contacts_before,
      'publishing_schedules_preserved', publishing_schedules_before
    )
  );
end;
$$;
