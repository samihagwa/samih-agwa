create index launches_cancelled_by_idx
  on public.launches (cancelled_by)
  where cancelled_by is not null;
