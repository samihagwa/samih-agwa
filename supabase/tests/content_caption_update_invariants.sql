begin;

do $$
declare
  caption_function text;
  content_write_guard text;
  execute_is_service_only boolean;
  content_rls_enabled boolean;
begin
  select pg_get_functiondef(
    'public.update_content_caption_v1(uuid,uuid,bigint,text)'::regprocedure
  ) into caption_function;
  select pg_get_functiondef('private.guard_content_item_write()'::regprocedure)
  into content_write_guard;

  if caption_function not like '%item_record.version <> expected_content_version%'
    or caption_function not like '%item_record.caption_brief = clean_caption%'
    or caption_function not like '%return item_record.version;%'
  then
    raise exception 'Caption update is not optimistic and retry-idempotent';
  end if;
  if caption_function not like '%actor_is_requester%'
    or caption_function not like '%actor_is_step_owner%'
    or caption_function not like '%actor_is_content_leadership%'
    or caption_function not like '%task.is_work_item%'
    or caption_function not like '%task.content_step in (%'
    or caption_function not like '%task.status <> ''cancelled''%'
    or caption_function not like '%array[''content'']%'
  then
    raise exception 'Caption update authorization is broader than its contract';
  end if;
  if caption_function not like '%content.caption_updated%'
    or caption_function not like '%content_brief_updated%'
    or caption_function not like '%:caption:v%'
  then
    raise exception 'Caption update is missing audit or deduplicated publisher notice';
  end if;
  if content_write_guard not like '%changed_fields <@ allowed_caption_fields%'
    or content_write_guard not like '%task.is_work_item%'
    or content_write_guard not like '%task.content_step in (%'
    or content_write_guard not like '%task.status <> ''cancelled''%'
  then
    raise exception 'The table write guard rejects a real linked workflow participant';
  end if;

  select has_function_privilege(
      'service_role',
      'public.update_content_caption_v1(uuid,uuid,bigint,text)',
      'EXECUTE'
    ) and not has_function_privilege(
      'authenticated',
      'public.update_content_caption_v1(uuid,uuid,bigint,text)',
      'EXECUTE'
    )
  into execute_is_service_only;
  if not execute_is_service_only then
    raise exception 'Caption update RPC must stay behind the authenticated Edge command';
  end if;

  select table_record.relrowsecurity
  into content_rls_enabled
  from pg_class table_record
  where table_record.oid = 'public.content_items'::regclass;
  if not content_rls_enabled then
    raise exception 'Content item RLS must remain enabled';
  end if;
end;
$$;

rollback;
