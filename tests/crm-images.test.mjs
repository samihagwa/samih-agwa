import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
const migration=await readFile(new URL('../supabase/migrations/20260920162440_crm_conversation_images.sql',import.meta.url),'utf8');
const source=await readFile(new URL('../lib/crm-images.ts',import.meta.url),'utf8');
const helpers=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText).toString('base64'));
test('CRM image input is bounded and preserves long screenshot legibility',()=>{
 assert.equal(helpers.imageInputError({type:'image/png',size:150000}),null);
 for(const file of [{type:'image/svg+xml',size:100},{type:'image/gif',size:100},{type:'image/jpeg',size:16*1048576},{type:'image/png',size:0}])assert.ok(helpers.imageInputError(file));
 assert.deepEqual(helpers.imageDimensions(1080,8000),{width:1080,height:8000});
 assert.deepEqual(helpers.imageDimensions(3200,1800),{width:1600,height:900});
 assert.throws(()=>helpers.imageDimensions(10000,10000));
});
test('CRM photo migration: private storage, authorized commands, immutable bytes, idempotency and quota',async t=>{
 const db=new PGlite();
 const org='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
 const owner='20000000-0000-4000-8000-000000000001',sales='20000000-0000-4000-8000-000000000002',peer='20000000-0000-4000-8000-000000000003',outsider='20000000-0000-4000-8000-000000000004';
 const contact='30000000-0000-4000-8000-000000000001';
 try{
 await db.exec(`create role anon;create role authenticated;create schema private;create schema auth;create schema storage;
 grant usage on schema public,private,auth,storage to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create type public.app_role as enum('owner','admin','manager','member');
 create table public.organizations(id uuid primary key);
 create table public.profiles(id uuid primary key,full_name text);
 create table public.memberships(organization_id uuid,user_id uuid,role public.app_role,status text,crm boolean default true);
 create table public.crm_contacts(id uuid primary key,organization_id uuid,owner_id uuid,unique(id,organization_id));
 create table public.audit_events(organization_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,after_data jsonb);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 create function private.has_org_role(o uuid,r public.app_role[]) returns boolean language sql stable security definer as $$select exists(select 1 from public.memberships where organization_id=o and user_id=auth.uid() and status='active' and role=any(r))$$;
 create function private.can_access_any_section(o uuid,s text[]) returns boolean language sql stable security definer as $$select exists(select 1 from public.memberships where organization_id=o and user_id=auth.uid() and status='active' and crm)$$;
 create function private.can_access_crm_contact(c uuid,o uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.crm_contacts a join public.memberships m on m.organization_id=a.organization_id and m.user_id=auth.uid() and m.status='active' where a.id=c and a.organization_id=o and (a.owner_id=auth.uid() or m.role in ('owner','admin','manager')))$$;
 insert into public.organizations values('${org}'),('${other}');
 insert into public.profiles values('${owner}','Owner'),('${sales}','Sales'),('${peer}','Peer'),('${outsider}','Outside');
 insert into public.memberships(organization_id,user_id,role,status) values('${org}','${owner}','owner','active'),('${org}','${sales}','member','active'),('${org}','${peer}','member','active'),('${other}','${outsider}','owner','active');
 insert into public.crm_contacts values('${contact}','${org}','${sales}');`);
 await db.exec(migration);
 async function as(actor,fn){await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false)`);try{return await fn();}finally{await db.exec('reset role');}}
 async function cmd(actor,action,payload={}){return as(actor,async()=> (await db.query('select public.crm_images_command($1,$2,$3) value',[action,contact,JSON.stringify(payload)])).rows[0].value);}
 async function object(path,size=12000,mime='image/webp'){await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['crm-conversation-images',path,JSON.stringify({size,mimetype:mime})]);}
 let photo;
 await t.test('private bucket enforces file types and one MiB maximum',async()=>{const b=(await db.query('select * from storage.buckets')).rows[0];assert.equal(b.public,false);assert.equal(Number(b.file_size_limit),1048576);assert.deepEqual(b.allowed_mime_types,['image/webp','image/jpeg']);});
 await t.test('owner and assigned sales allowed, other sales and tenant denied',async()=>{
   assert.equal((await cmd(sales,'list')).total,0);assert.equal((await cmd(owner,'list')).total,0);
   for(const actor of [peer,outsider])await assert.rejects(cmd(actor,'list'),/صلاحية/);
   await db.exec('set role anon');await assert.rejects(db.query('select public.crm_images_command($1,$2)',['list',contact]),/permission denied/);await db.exec('reset role');
 });
 await t.test('no direct metadata writes, metadata reads or storage path guessing',async()=>{
  await as(sales,async()=>{for(const sql of ['select * from private.crm_conversation_images','delete from private.crm_conversation_images','update private.crm_conversation_images set state=state','insert into private.crm_conversation_images default values'])await assert.rejects(db.exec(sql),/permission denied/);
  await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('crm-conversation-images','guess.webp')"),/row-level security/);});
 });
 await t.test('server validates MIME/hash/caption and reserves full size idempotently',async()=>{
  for(const p of [{hash:'no',mime:'image/webp'},{hash:'a'.repeat(64),mime:'image/svg+xml'},{hash:'a'.repeat(64),mime:'image/webp',caption:'x'.repeat(301)}])await assert.rejects(cmd(sales,'reserve',p),/غير صالحة/);
  photo=await cmd(sales,'reserve',{hash:'a'.repeat(64),mime:'image/webp',caption:'اتفاق اختبار'});
  assert.equal((await cmd(sales,'reserve',{hash:'a'.repeat(64),mime:'image/webp'})).id,photo.id);
  assert.equal((await cmd(sales,'list')).used_bytes,1048576);
  await assert.rejects(cmd(owner,'reserve',{hash:'a'.repeat(64),mime:'image/webp'}),/عضو آخر/);
  await assert.rejects(cmd(sales,'finish',{id:photo.id}),/لم تصل/);
 });
 await t.test('storage INSERT only for creator reserved path; incomplete image not readable',async()=>{
  await as(owner,()=>assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['crm-conversation-images',photo.object_path]),/row-level security/));
  await as(sales,()=>object(photo.object_path));
  assert.equal((await as(sales,()=>db.query('select * from storage.objects'))).rows.length,0);
  await assert.rejects(cmd(owner,'finish',{id:photo.id}),/صاحب الرفع/);
 });
 await t.test('finish verifies storage metadata, releases unused reservation, audits once',async()=>{
  await cmd(sales,'finish',{id:photo.id});await cmd(sales,'finish',{id:photo.id});
  const list=await cmd(sales,'list');assert.equal(list.total,1);assert.equal(list.used_bytes,12000);assert.equal(list.images[0].caption,'اتفاق اختبار');assert.equal(list.images[0].author_name,'Sales');
  assert.equal((await db.query('select count(*)::int n from public.audit_events')).rows[0].n,1);
  assert.equal((await as(sales,()=>db.query('select * from storage.objects'))).rows.length,1);
  assert.equal((await as(peer,()=>db.query('select * from storage.objects'))).rows.length,0);
 });
 await t.test('immutable objects cannot be replaced/deleted, even by uploader',async()=>{
  for(const sql of ["update storage.objects set metadata='{}' returning *",'delete from storage.objects returning *'])assert.equal((await as(sales,()=>db.query(sql))).rows.length,0);
 });
 await t.test('fresh section access, membership and reassignment revoke image access',async()=>{
  await db.exec(`update public.memberships set crm=false where user_id='${sales}'`);await assert.rejects(cmd(sales,'list'),/صلاحية/);assert.equal((await as(sales,()=>db.query('select * from storage.objects'))).rows.length,0);
  await db.exec(`update public.memberships set crm=true,status='inactive' where user_id='${sales}'`);await assert.rejects(cmd(sales,'list'),/صلاحية/);
  await db.exec(`update public.memberships set status='active' where user_id='${sales}';update public.crm_contacts set owner_id='${peer}'`);await assert.rejects(cmd(sales,'list'),/صلاحية/);assert.equal((await cmd(peer,'list')).total,1);
  await assert.rejects(cmd(peer,'archive',{id:photo.id}),/الأرشفة/);await db.exec(`update public.crm_contacts set owner_id='${sales}'`);
 });
 await t.test('archive/restore reversible and does not free quota or repeat audits',async()=>{
  await cmd(sales,'archive',{id:photo.id});await cmd(sales,'archive',{id:photo.id});assert.equal((await cmd(sales,'list')).total,0);assert.equal((await cmd(sales,'list',{archived:true})).total,1);assert.equal((await cmd(sales,'list')).used_bytes,12000);
  await cmd(owner,'restore',{id:photo.id});assert.equal((await cmd(sales,'list')).total,1);assert.equal((await db.query('select count(*)::int n from public.audit_events')).rows[0].n,3);
 });
 await t.test('oversized or wrong MIME object cannot finalize',async()=>{
  const p=await cmd(sales,'reserve',{hash:'b'.repeat(64),mime:'image/webp'});await object(p.object_path,1048577);await assert.rejects(cmd(sales,'finish',{id:p.id}),/غير صالح/);
  await db.query("update storage.objects set metadata=$1 where name=$2",[JSON.stringify({size:100,mimetype:'image/svg+xml'}),p.object_path]);await assert.rejects(cmd(sales,'finish',{id:p.id}),/غير صالح/);
 });
 await t.test('global space includes other buckets; allocation never trusts declared client bytes',async()=>{
  await db.exec("insert into storage.objects(bucket_id,name,metadata) values('other','large','{\"size\":943718400}')");
  await assert.rejects(cmd(sales,'reserve',{hash:'c'.repeat(64),mime:'image/webp',bytes:0}),/سقف/);
 });
 }finally{await db.close();}
});
