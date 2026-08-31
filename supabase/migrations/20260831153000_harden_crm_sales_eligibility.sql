-- Keep CRM routing eligible after future team permission changes, and make the
-- indicator workflow use the same CRM + Tasks capability boundary.

create or replace function private.guard_crm_sales_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.crm_lead_routing_members route
    where route.organization_id = old.organization_id
      and route.user_id = old.user_id;
    return old;
  end if;

  if new.status <> 'active'
    or new.role = 'viewer'
    or not (
      new.role = 'owner'
      or (
        'crm' = any(coalesce(new.allowed_sections, '{}'::text[]))
        and 'tasks' = any(coalesce(new.allowed_sections, '{}'::text[]))
      )
    ) then
    delete from public.crm_lead_routing_members route
    where route.organization_id = new.organization_id
      and route.user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_crm_sales_route on public.memberships;
create trigger memberships_guard_crm_sales_route
after update of status, role, allowed_sections or delete on public.memberships
for each row execute function private.guard_crm_sales_membership();

delete from public.crm_lead_routing_members route
where not exists (
  select 1
  from public.memberships membership
  where membership.organization_id = route.organization_id
    and membership.user_id = route.user_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
    and (
      membership.role = 'owner'
      or (
        'crm' = any(coalesce(membership.allowed_sections, '{}'::text[]))
        and 'tasks' = any(coalesce(membership.allowed_sections, '{}'::text[]))
      )
    )
);

create or replace function public.get_crm_indicator_workflow_settings(
  target_user_id uuid,
  target_organization_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  is_activation_owner boolean,
  is_sales_owner boolean,
  sales_follow_up_delay_hours smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id, target_organization_id, array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can view indicator routing';
  end if;

  return query
  select
    membership.user_id,
    coalesce(nullif(trim(profile.full_name), ''), auth_user.email, 'عضو فريق'),
    auth_user.email::text,
    membership.role,
    settings.activation_owner_id = membership.user_id,
    settings.sales_owner_id = membership.user_id,
    settings.sales_follow_up_delay_hours
  from public.memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join auth.users auth_user on auth_user.id = membership.user_id
  join public.crm_indicator_workflow_settings settings
    on settings.organization_id = membership.organization_id
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
    and (
      membership.role = 'owner'
      or (
        'crm' = any(coalesce(membership.allowed_sections, '{}'::text[]))
        and 'tasks' = any(coalesce(membership.allowed_sections, '{}'::text[]))
      )
    )
  order by membership.created_at, membership.user_id;
end;
$$;

create or replace function public.save_crm_indicator_workflow_settings(
  target_user_id uuid,
  target_organization_id uuid,
  target_activation_owner_id uuid,
  target_sales_owner_id uuid,
  target_sales_follow_up_delay_hours smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id, target_organization_id, array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can change indicator routing';
  end if;
  if target_sales_follow_up_delay_hours is null
    or target_sales_follow_up_delay_hours not between 1 and 168 then
    raise exception 'Sales follow-up delay must be between one hour and seven days';
  end if;
  if target_activation_owner_id is null or target_sales_owner_id is null then
    raise exception 'Indicator and Sales owners are required';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_activation_owner_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (
        membership.role = 'owner'
        or (
          'crm' = any(coalesce(membership.allowed_sections, '{}'::text[]))
          and 'tasks' = any(coalesce(membership.allowed_sections, '{}'::text[]))
        )
      )
  ) then
    raise exception 'The activation owner must have active CRM and Tasks access';
  end if;
  if not exists (
    select 1
    from public.crm_lead_routing_members route
    join public.memberships membership
      on membership.organization_id = route.organization_id
     and membership.user_id = route.user_id
    where route.organization_id = target_organization_id
      and route.user_id = target_sales_owner_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (
        membership.role = 'owner'
        or (
          'crm' = any(coalesce(membership.allowed_sections, '{}'::text[]))
          and 'tasks' = any(coalesce(membership.allowed_sections, '{}'::text[]))
        )
      )
  ) then
    raise exception 'The Sales fallback owner must be selected in the Sales roster';
  end if;

  insert into public.crm_indicator_workflow_settings (
    organization_id, activation_owner_id, sales_owner_id,
    sales_follow_up_delay_hours, updated_by
  ) values (
    target_organization_id, target_activation_owner_id, target_sales_owner_id,
    target_sales_follow_up_delay_hours, target_user_id
  )
  on conflict (organization_id) do update
  set activation_owner_id = excluded.activation_owner_id,
      sales_owner_id = excluded.sales_owner_id,
      sales_follow_up_delay_hours = excluded.sales_follow_up_delay_hours,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'crm.indicator_routing_updated',
    'organization', target_organization_id,
    jsonb_build_object(
      'activation_owner_id', target_activation_owner_id,
      'sales_owner_id', target_sales_owner_id,
      'sales_follow_up_delay_hours', target_sales_follow_up_delay_hours
    )
  );
  return true;
end;
$$;

revoke all on function public.get_crm_indicator_workflow_settings(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.save_crm_indicator_workflow_settings(
  uuid, uuid, uuid, uuid, smallint
) from public, anon, authenticated;
grant execute on function public.get_crm_indicator_workflow_settings(uuid, uuid)
to service_role;
grant execute on function public.save_crm_indicator_workflow_settings(
  uuid, uuid, uuid, uuid, smallint
) to service_role;
