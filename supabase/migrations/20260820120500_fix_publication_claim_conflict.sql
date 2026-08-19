-- Output column names in a RETURNS TABLE function are PL/pgSQL variables.
-- Target the named unique constraint so ON CONFLICT cannot be ambiguous.
do $migration$
declare
  function_definition text;
  repaired_definition text;
begin
  select pg_get_functiondef('public.claim_publication_batch(integer)'::regprocedure)
  into function_definition;
  repaired_definition := replace(
    function_definition,
    'on conflict (occurrence_id, channel_id)',
    'on conflict on constraint publishing_logs_occurrence_channel_unique'
  );
  if repaired_definition = function_definition then
    raise exception 'Expected publication claim conflict target was not found';
  end if;
  execute repaired_definition;
end;
$migration$;

