alter function public.create_content_request_workflow(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,uuid,uuid,uuid[],public.content_format,text[]) set schema private;
create function public.create_content_request_workflow(target_user_id uuid,target_organization_id uuid,request_id uuid,content_title text,content_request_text text,target_publish_at timestamptz,raw_materials jsonb,editing_owner_id uuid,thumbnail_owner_id uuid,publishing_owner_id uuid,target_brand_article_ids uuid[],request_format public.content_format,request_platforms text[])
returns uuid language sql security invoker set search_path='' as $$
 select private.create_content_request_workflow(target_user_id,target_organization_id,request_id,content_title,content_request_text,target_publish_at,raw_materials,editing_owner_id,thumbnail_owner_id,publishing_owner_id,target_brand_article_ids,request_format,request_platforms);
$$;
revoke all on function public.create_content_request_workflow(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,uuid,uuid,uuid[],public.content_format,text[]) from public,anon,authenticated;
grant execute on function public.create_content_request_workflow(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,uuid,uuid,uuid[],public.content_format,text[]) to service_role;
alter function public.submit_carousel_delivery(uuid,uuid,text,jsonb,bigint,bigint) set schema private;
create function public.submit_carousel_delivery(target_user_id uuid,target_task_id uuid,delivery_result_note text,images jsonb,expected_task_version bigint,expected_delivery_version bigint)
returns uuid language sql security invoker set search_path='' as $$
 select private.submit_carousel_delivery(target_user_id,target_task_id,delivery_result_note,images,expected_task_version,expected_delivery_version);
$$;
revoke all on function public.submit_carousel_delivery(uuid,uuid,text,jsonb,bigint,bigint) from public,anon,authenticated;
grant execute on function public.submit_carousel_delivery(uuid,uuid,text,jsonb,bigint,bigint) to service_role;
