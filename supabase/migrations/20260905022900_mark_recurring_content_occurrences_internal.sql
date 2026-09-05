-- The occurrence map is intentionally invisible to signed-in clients. An
-- explicit deny policy documents that boundary and keeps the security linter
-- from treating the absence of client policies as an accidental omission.

create policy "recurring_content_occurrences_internal_only"
on public.recurring_content_occurrences
as restrictive for all to authenticated
using (false)
with check (false);
