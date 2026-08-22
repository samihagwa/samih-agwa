create index crm_import_batches_created_by_idx
  on public.crm_import_batches (created_by);

create index crm_import_batches_rolled_back_by_idx
  on public.crm_import_batches (rolled_back_by)
  where rolled_back_by is not null;
