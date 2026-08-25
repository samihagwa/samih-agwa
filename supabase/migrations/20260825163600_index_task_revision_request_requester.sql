-- Cover the requester foreign key and the requester-first history lookup.
create index if not exists task_revision_requests_requester_time_idx
  on public.task_revision_requests (requested_by, requested_at desc, id);
