-- Private CRM evidence. No public URLs, no external provider, no automatic purge.
-- Pending uploads reserve the FULL bucket file limit, not a client-supplied size.
create table private.crm_conversation_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  object_path text not null unique,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/webp','image/jpeg')),
  caption text not null default '' check (char_length(caption) <= 300),
  state text not null default 'pending' check (state in ('pending','ready','archived')),
  held_bytes bigint not null default 1048576 check (held_bytes between 1 and 1048576),
  foreign key (contact_id, organization_id) references public.crm_contacts(id, organization_id),
  unique (contact_id, content_hash)
);
create index crm_conversation_images_contact_idx on private.crm_conversation_images(contact_id, created_at desc, id);
alter table private.crm_conversation_images enable row level security;
revoke all on private.crm_conversation_images from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('crm-conversation-images','crm-conversation-images',false,1048576,array['image/webp','image/jpeg']);

-- Reuse contact ownership AND section access: authentication alone is insufficient.
create function private.crm_image_access(target_contact uuid, target_org uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null
    and private.can_access_crm_contact(target_contact,target_org)
    and private.can_access_any_section(target_org,array['crm']::text[]);
$$;
revoke all on function private.crm_image_access(uuid,uuid) from public,anon;
grant execute on function private.crm_image_access(uuid,uuid) to authenticated;

create function private.crm_image_object_allowed(path text, writing boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from private.crm_conversation_images i
    where i.object_path=path and private.crm_image_access(i.contact_id,i.organization_id)
      and case when writing then i.state='pending' and i.created_by=auth.uid()
        else i.state in ('ready','archived') end
  );
$$;
revoke all on function private.crm_image_object_allowed(text,boolean) from public,anon;
grant execute on function private.crm_image_object_allowed(text,boolean) to authenticated;

create policy crm_images_read on storage.objects for select to authenticated
using (bucket_id='crm-conversation-images' and private.crm_image_object_allowed(name,false));
create policy crm_images_insert on storage.objects for insert to authenticated
with check (bucket_id='crm-conversation-images' and private.crm_image_object_allowed(name,true));
-- No update/upsert/delete policy. Existing evidence is immutable; archive is reversible.

create function private.crm_images_command(action text, target_contact uuid, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); org uuid; item private.crm_conversation_images%rowtype;
  used_bytes bigint; other_bytes bigint; total_count bigint; object_meta jsonb;
  image_hash text; image_mime text; image_id uuid; rows_json jsonb;
  page_number integer := greatest(0,least(coalesce((payload->>'page')::integer,0),10000));
  archived boolean := coalesce((payload->>'archived')::boolean,false);
begin
  select organization_id into org from public.crm_contacts where id=target_contact;
  if actor is null or org is null or not private.crm_image_access(target_contact,org) then
    raise exception 'ليس لديك صلاحية لصور هذا العميل';
  end if;
  if action='list' then
    select count(*) into total_count from private.crm_conversation_images
      where contact_id=target_contact and state=case when archived then 'archived' else 'ready' end;
    select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id),'[]'::jsonb) into rows_json from (
      select i.id,i.object_path,i.created_by,i.created_at,i.caption,i.held_bytes as bytes,i.state,
        coalesce(p.full_name,'عضو فريق') as author_name
      from private.crm_conversation_images i left join public.profiles p on p.id=i.created_by
      where i.contact_id=target_contact and i.state=case when archived then 'archived' else 'ready' end
      order by i.created_at desc,i.id limit 12 offset page_number*12
    ) r;
    select coalesce(sum(held_bytes),0) into used_bytes from private.crm_conversation_images;
    return jsonb_build_object('images',rows_json,'total',total_count,'used_bytes',used_bytes,
      'limit_bytes',734003200,'pending', (select count(*) from private.crm_conversation_images
        where contact_id=target_contact and state='pending' and created_by=actor));
  elsif action='reserve' then
    image_hash := payload->>'hash'; image_mime := payload->>'mime';
    if image_hash is null or image_hash !~ '^[a-f0-9]{64}$'
      or image_mime is null or image_mime not in ('image/webp','image/jpeg')
      or char_length(coalesce(payload->>'caption',''))>300 then
      raise exception 'صيغة الصورة أو بياناتها غير صالحة';
    end if;
    -- A single project-wide lock serializes all reservations, including other tenants.
    perform pg_advisory_xact_lock(726319840);
    select * into item from private.crm_conversation_images where contact_id=target_contact and content_hash=image_hash;
    if item.id is not null then
      if item.state='pending' and item.created_by<>actor then raise exception 'الصورة قيد الرفع بواسطة عضو آخر'; end if;
      return jsonb_build_object('id',item.id,'object_path',item.object_path,'state',item.state);
    end if;
    select coalesce(sum(held_bytes),0) into used_bytes from private.crm_conversation_images;
    select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0)
      into other_bytes from storage.objects where bucket_id<>'crm-conversation-images';
    if used_bytes+1048576>734003200 or used_bytes+other_bytes+1048576>943718400 then
      raise exception 'وصلنا لسقف مساحة الصور. تواصل مع الإدارة؛ لن نحذف الصور القديمة أو نرفع التكلفة تلقائيًا';
    end if;
    if (select count(*) from private.crm_conversation_images where contact_id=target_contact)>=200 then
      raise exception 'وصل الملف إلى حد 200 صورة. تواصل مع الإدارة';
    end if;
    image_id := gen_random_uuid();
    insert into private.crm_conversation_images(id,organization_id,contact_id,created_by,object_path,content_hash,mime_type,caption)
      values(image_id,org,target_contact,actor,org::text||'/'||target_contact::text||'/'||image_id::text||case when image_mime='image/webp' then '.webp' else '.jpg' end,
        image_hash,image_mime,coalesce(payload->>'caption','')) returning * into item;
    return jsonb_build_object('id',item.id,'object_path',item.object_path,'state',item.state);
  elsif action in ('finish','archive','restore') then
    select * into item from private.crm_conversation_images where id=(payload->>'id')::uuid and contact_id=target_contact for update;
    if item.id is null then raise exception 'الصورة غير متاحة'; end if;
    if action='finish' then
      if item.created_by<>actor then raise exception 'فقط صاحب الرفع يستطيع إكماله'; end if;
      if item.state<>'pending' then return jsonb_build_object('id',item.id,'state',item.state); end if;
      select metadata into object_meta from storage.objects where bucket_id='crm-conversation-images' and name=item.object_path;
      if object_meta is null then raise exception 'الصورة لم تصل بعد. أعد اختيارها ورفعها لاستكمال المحاولة'; end if;
      if coalesce(object_meta->>'size','') !~ '^[0-9]+$'
        or (object_meta->>'size')::bigint not between 1 and 1048576
        or object_meta->>'mimetype' is distinct from item.mime_type then raise exception 'حجم الصورة أو نوعها غير صالح'; end if;
      update private.crm_conversation_images set state='ready',held_bytes=(object_meta->>'size')::bigint where id=item.id;
    else
      if item.created_by<>actor and not private.has_org_role(org,array['owner','admin','manager']::public.app_role[]) then
        raise exception 'الأرشفة والاستعادة لصاحب الصورة أو الإدارة فقط';
      end if;
      if item.state='pending' then raise exception 'أكمل رفع الصورة أولًا'; end if;
      if item.state=(case when action='archive' then 'archived' else 'ready' end) then return jsonb_build_object('id',item.id); end if;
      update private.crm_conversation_images set state=case when action='archive' then 'archived' else 'ready' end where id=item.id;
    end if;
    insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,after_data)
      values(org,actor,'crm.image_'||action,'crm_contact',target_contact,jsonb_build_object('image_id',item.id));
    return jsonb_build_object('id',item.id);
  end if;
  raise exception 'إجراء الصور غير معروف';
end;
$$;
revoke all on function private.crm_images_command(text,uuid,jsonb) from public,anon;
grant execute on function private.crm_images_command(text,uuid,jsonb) to authenticated;
create function public.crm_images_command(action text, target_contact uuid, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.crm_images_command(action,target_contact,payload);
$$;
revoke all on function public.crm_images_command(text,uuid,jsonb) from public,anon;
grant execute on function public.crm_images_command(text,uuid,jsonb) to authenticated;
