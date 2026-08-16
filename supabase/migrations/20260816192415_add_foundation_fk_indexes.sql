create index audit_events_actor_idx
  on public.audit_events (actor_id);

create index memberships_invited_by_idx
  on public.memberships (invited_by);

create index organizations_created_by_idx
  on public.organizations (created_by);
