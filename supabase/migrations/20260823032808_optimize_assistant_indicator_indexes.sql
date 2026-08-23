-- Cover the new foreign-key access paths before conversation and lead volume
-- grows, and evaluate auth.uid() once per RLS statement instead of per row.

create index assistant_messages_conversation_owner_idx
  on public.assistant_messages (conversation_id, organization_id, user_id);
create index assistant_messages_organization_idx
  on public.assistant_messages (organization_id);
create index assistant_messages_user_idx
  on public.assistant_messages (user_id);

create index crm_indicator_settings_activation_owner_idx
  on public.crm_indicator_workflow_settings (activation_owner_id);
create index crm_indicator_settings_sales_owner_idx
  on public.crm_indicator_workflow_settings (sales_owner_id);
create index crm_indicator_settings_updated_by_idx
  on public.crm_indicator_workflow_settings (updated_by);

create index crm_indicator_workflows_contact_org_idx
  on public.crm_indicator_workflows (contact_id, organization_id);
create index crm_indicator_workflows_organization_idx
  on public.crm_indicator_workflows (organization_id);
create index crm_indicator_workflows_activation_owner_idx
  on public.crm_indicator_workflows (activation_owner_id);
create index crm_indicator_workflows_sales_owner_idx
  on public.crm_indicator_workflows (sales_owner_id);

drop policy if exists "assistant_conversations_select_self"
on public.assistant_conversations;
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

drop policy if exists "assistant_messages_select_self"
on public.assistant_messages;
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
