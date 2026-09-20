import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Isolated PostgreSQL contract fixture. No external database, credentials or sends.
const org = '10000000-0000-4000-8000-000000000001';
const otherOrg = '10000000-0000-4000-8000-000000000002';
const owner = '20000000-0000-4000-8000-000000000001';
const member = '20000000-0000-4000-8000-000000000002';
const outsider = '20000000-0000-4000-8000-000000000003';
const object = '30000000-0000-4000-8000-000000000001';
const migration = await readFile(new URL('../supabase/migrations/20260920020042_team_activity_reports.sql', import.meta.url), 'utf8');

test('team reports: isolated SQL authorization, accounting, schedule and outbox contracts', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      grant usage on schema public,private,auth to authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create type public.app_role as enum('owner','admin','manager','member');
      create table public.organizations(id uuid primary key);
      create table public.profiles(id uuid primary key, full_name text);
      create table public.memberships(organization_id uuid,user_id uuid,role public.app_role,status text,primary key(organization_id,user_id));
      create table public.member_presence(organization_id uuid,user_id uuid,last_seen_at timestamptz,primary key(organization_id,user_id));
      create table public.audit_events(id bigint generated always as identity,organization_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,before_data jsonb,after_data jsonb,occurred_at timestamptz default now());
      create table public.tasks(id uuid,organization_id uuid,owner_id uuid,status text,due_at timestamptz);
      create table public.publishing_posts(id uuid,organization_id uuid,created_by uuid);
      create table public.publishing_publication_logs(organization_id uuid,post_id uuid,occurrence_id uuid,status text,published_at timestamptz);
      create table public.publishing_admin_connections(organization_id uuid,user_id uuid,connected_at timestamptz,telegram_chat_id bigint,workflow_notifications_enabled boolean,telegram_user_id bigint);
      create table public.notifications(id bigint generated always as identity,organization_id uuid,user_id uuid,kind text,title text,body text,entity_type text,entity_id uuid,action_url text,dedupe_key text unique,constraint notifications_kind_allowed check(kind<>'invalid'));
      create table private.telegram_notification_outbox(id bigint generated always as identity,notification_id bigint);
      create function private.add_notification(o uuid,u uuid,k text,t text,b text,e text,i uuid,url text,d text) returns void language plpgsql as $$
      declare n bigint; begin
        insert into public.notifications(organization_id,user_id,kind,title,body,entity_type,entity_id,action_url,dedupe_key) values(o,u,k,t,b,e,i,url,d) on conflict do nothing returning id into n;
        if n is not null and exists(select 1 from public.publishing_admin_connections where organization_id=o and user_id=u and connected_at is not null and workflow_notifications_enabled) then
          insert into private.telegram_notification_outbox(notification_id) values(n);
        end if;
      end $$;
      insert into public.organizations values('${org}'),('${otherOrg}');
      insert into public.profiles values('${owner}','مالك اختبار'),('${member}','عضو اختبار'),('${outsider}','فريق آخر');
      insert into public.memberships values('${org}','${owner}','owner','active'),('${org}','${member}','member','active'),('${otherOrg}','${outsider}','owner','active');
    `);
    await db.exec(migration);
    async function command(actor, cmd, payload = {}, tenant = org) {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${actor}',false)`);
      try { return (await db.query('select public.team_reports_command($1,$2,$3) result', [cmd, tenant, JSON.stringify(payload)])).rows[0].result; }
      finally { await db.exec('reset role'); }
    }
    let config;
    await t.test('owner defaults are disabled, all active members included, owner receives only on-site', async () => {
      config = await command(owner, 'settings');
      assert.equal(config.daily_enabled, false); assert.equal(config.weekly_enabled, false);
      assert.deepEqual(config.included_users.sort(), [owner, member]);
      assert.deepEqual(config.recipients, [{ user_id: owner, scope: 'team', telegram: false }]);
      assert.equal(config.scheduler_available, false);
    });
    await t.test('fresh membership, tenant and owner checks; anon cannot call RPC', async () => {
      for (const action of ['settings', 'preview', 'save']) await assert.rejects(command(member, action), /للمالك/);
      await assert.rejects(command(outsider, 'settings'), /غير مسموح/);
      await assert.rejects(command(owner, 'list', {}, otherOrg), /غير مسموح/);
      await db.exec('set role anon');
      await assert.rejects(db.query('select public.team_reports_command($1,$2)', ['list',org]), /permission denied/);
      await db.exec('reset role');
    });
    await t.test('invalid recipients, cross-tenant members, duplicates and disconnected Telegram rejected', async () => {
      await assert.rejects(command(owner,'save',{...config,included_users:[outsider]}), /نفس الفريق/);
      await assert.rejects(command(owner,'save',{...config,recipients:[{user_id:member,scope:'team'}]}), /الشامل/);
      await assert.rejects(command(owner,'save',{...config,recipients:[config.recipients[0],config.recipients[0]]}), /مكرر/);
      await assert.rejects(command(owner,'save',{...config,recipients:[{...config.recipients[0],telegram:true}]}), /تيليجرام/);
      await assert.rejects(command(owner,'save',{...config,included_users:[owner],recipients:[{user_id:member,scope:'self'}]}), /المشمولين/);
      await assert.rejects(command(owner,'save',{...config,daily_enabled:true}), /Cron/);
    });
    await t.test('optimistic revision check prevents lost settings; settings mutation audited', async () => {
      const saved = await command(owner,'save',config);
      assert.equal(saved.revision,1);
      await assert.rejects(command(owner,'save',config), /تغيرت/);
      config = saved;
      assert.equal((await db.query("select count(*)::int n from public.audit_events where action='team.report_settings_updated'")).rows[0].n,1);
    });
    await t.test('private tables cannot be read, inserted, updated or deleted by authenticated users', async () => {
      await db.exec('set role authenticated');
      for (const table of ['team_reports','team_report_settings','team_presence_days','team_report_coverage']) {
        for (const sql of [`select * from private.${table}`,`delete from private.${table}`,`update private.${table} set ${table==='team_report_coverage'?'singleton=singleton':'organization_id=organization_id'}`,`insert into private.${table} default values`]) await assert.rejects(db.exec(sql), /permission denied/);
      }
      await assert.rejects(db.exec('select private.materialize_team_activity_reports()'), /permission denied/);
      await db.exec('reset role');
    });
    await t.test('history starts at installation and heartbeats preserve first/last per Cairo day', async () => {
      assert.equal((await db.query('select count(*)::int n from private.team_presence_days')).rows[0].n,0);
      await db.exec(`insert into public.member_presence values('${org}','${member}','2026-09-17 21:30Z'); update public.member_presence set last_seen_at='2026-09-17 22:30Z';`);
      const day=(await db.query('select day::text,first_seen,last_seen from private.team_presence_days')).rows[0];
      assert.equal(day.day,'2026-09-18'); assert.equal(new Date(day.last_seen)-new Date(day.first_seen),3600000);
    });
    await t.test('dedupe work objects, historical task owner credit, exclusive Cairo boundary and confirmed publication', async () => {
      assert.equal((await db.query(`select private.team_report_metric('task.updated','{}','{"status":"done","is_work_item":false}') metric`)).rows[0].metric,null);
      await db.exec(`
        insert into public.audit_events(organization_id,actor_id,action,entity_id,before_data,after_data,occurred_at) values
          ('${org}','${member}','script.saved','${object}',null,'{}','2026-09-17 21:00Z'),
          ('${org}','${member}','script.saved','${object}',null,'{}','2026-09-18 12:00Z'),
          ('${org}','${member}','script.saved',gen_random_uuid(),null,'{}','2026-09-18 21:00Z'),
          ('${org}','${owner}','task.updated','${object}','{"status":"in_progress"}','{"status":"done","owner_id":"${member}"}','2026-09-18 10:00Z'),
          ('${org}','${owner}','task.updated','${object}','{"status":"done"}','{"status":"done","owner_id":"${member}"}','2026-09-18 11:00Z'),
          ('${org}','${member}','task.delivery_submitted','${object}',null,'{"task_id":"${object}"}','2026-09-18 10:00Z'),
          ('${org}','${member}','content.step_completed',gen_random_uuid(),null,'{"task_id":"${object}"}','2026-09-18 10:00Z'),
          ('${org}','${member}','script.ai_requested','${object}',null,'{}','2026-09-18 10:00Z'),
          ('${otherOrg}','${member}','script.created','${object}',null,'{}','2026-09-18 10:00Z');
        insert into public.tasks values('${object}','${org}','${owner}','done',now());
        insert into public.publishing_posts values('${object}','${org}','${member}');
        insert into public.publishing_publication_logs values('${org}','${object}','${object}','published','2026-09-18 10:00Z'),('${org}','${object}','${object}','published','2026-09-18 11:00Z');
      `);
      const report = await command(owner,'preview',{start:'2026-09-18',end:'2026-09-18'});
      const row=report.members.find(p=>p.user_id===member), lead=report.members.find(p=>p.user_id===owner);
      assert.equal(row.metrics.scripts_edited,1); assert.equal(row.metrics.completed,1); assert.equal(row.metrics.deliveries,1);
      assert.equal(row.metrics.scripts_created,undefined); assert.equal(lead.metrics.completed,undefined);
      assert.equal(row.auto_published,1); assert.equal(row.presence_days,1);
      assert.equal(JSON.stringify(report).includes('after_data'),false);
      await assert.rejects(command(owner,'preview',{start:'2026-01-01',end:'2026-09-18'}), /31/);
      await assert.rejects(command(owner,'preview',{start:'2026-09-18',end:'2026-09-17'}), /31/);
      assert.equal((await db.query("select extract(epoch from (('2026-04-25'::timestamp at time zone 'Africa/Cairo')-('2026-04-24'::timestamp at time zone 'Africa/Cairo')))::int seconds")).rows[0].seconds,82800);
    });
    await t.test('daily/weekly snapshots and notifications created once, personal scope isolated, no Telegram opt-in means no outbox', async () => {
      config=await command(owner,'save',{...config,delivery_hour:0,recipients:[...config.recipients,{user_id:member,scope:'self',telegram:false}]});
      await db.exec(`insert into public.publishing_admin_connections values('${org}','${owner}',now(),123,true,123),('${org}','${member}',now(),124,true,124); update private.team_report_settings set daily_enabled=true,weekly_enabled=true;`);
      assert.equal((await db.query('select private.materialize_team_activity_reports() n')).rows[0].n,4);
      assert.equal((await db.query('select private.materialize_team_activity_reports() n')).rows[0].n,0);
      assert.equal((await db.query('select count(*)::int n from public.notifications')).rows[0].n,4);
      assert.equal((await db.query('select count(*)::int n from private.telegram_notification_outbox')).rows[0].n,0);
      const mine=await command(member,'list'), leads=await command(owner,'list');
      assert.equal(mine.length,2); assert.equal(leads.length,2);
      const personal=await command(member,'get',{id:mine[0].id});
      assert.deepEqual(personal.members.map(p=>p.user_id),[member]);
      await assert.rejects(command(member,'get',{id:leads[0].id}), /غير متاح/);
      await assert.rejects(command(owner,'get',{id:mine[0].id}), /غير متاح/);
      assert.equal((await command(owner,'get',{id:leads[0].id})).members.length,2);
    });
    await t.test('Telegram reauthorization and report access revoke immediately with recipients or membership', async () => {
      const id=(await db.query("select id from public.notifications where user_id=$1 limit 1",[owner])).rows[0].id;
      assert.equal((await db.query('select private.team_report_telegram_allowed($1) ok',[id])).rows[0].ok,false);
      await db.exec("update private.team_report_settings set recipients=jsonb_set(recipients,'{0,telegram}','true')");
      assert.equal((await db.query('select private.team_report_telegram_allowed($1) ok',[id])).rows[0].ok,true);
      await db.query('insert into private.telegram_notification_outbox(notification_id) values($1)',[id]);
      assert.equal((await db.query('select count(*)::int n from private.telegram_notification_outbox')).rows[0].n,1);
      await db.exec(`update public.memberships set role='member' where user_id='${owner}'`);
      assert.equal((await db.query('select private.team_report_telegram_allowed($1) ok',[id])).rows[0].ok,false);
      assert.deepEqual(await command(owner,'list'),[]);
      const own=(await command(member,'list'))[0];
      await db.exec("update private.team_report_settings set recipients='[]'");
      assert.deepEqual(await command(member,'list'),[]);
      await assert.rejects(command(member,'get',{id:own.id}), /غير متاح/);
    });
  } finally { await db.close(); }
});
