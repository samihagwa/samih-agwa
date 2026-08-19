-- Cover every publishing foreign key so deletes and joins stay predictable at scale.
create index publishing_admin_connections_user_idx
  on public.publishing_admin_connections (user_id, organization_id);
create index publishing_channels_creator_idx
  on public.publishing_channels (created_by);
create index publishing_controls_updater_idx
  on public.publishing_controls (updated_by)
  where updated_by is not null;
create index publishing_posts_creator_idx
  on public.publishing_posts (created_by);
create index publishing_schedule_channels_channel_idx
  on public.publishing_schedule_channels (channel_id, schedule_id);
create index publishing_schedules_creator_idx
  on public.publishing_schedules (created_by);

