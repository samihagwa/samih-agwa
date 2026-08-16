-- Let authenticated clients omit created_by while the database remains the authority.
alter table public.tasks
  alter column created_by set default auth.uid();
