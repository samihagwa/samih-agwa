import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared navigation covers every primary route", async () => {
  const source = await readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8");
  for (const route of ["/tasks", "/content", "/brand", "/campaigns", "/crm", "/analytics", "/team", "/settings"]) {
    assert.match(source, new RegExp(`href(?::|=)\\s*["']${route}`));
  }
});

test("internal navigation remains usable when the experimental client router fails", async () => {
  const sources = await Promise.all([
    "../app/page.tsx",
    "../components/layout/SidebarNav.tsx",
    "../components/ui/Button.tsx",
    "../components/content/ContentWorkspace.tsx",
    "../components/campaigns/CampaignsWorkspace.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  assert.doesNotMatch(sources.join("\n"), /from ["']next\/link["']/);
  assert.match(sources[1], /<a key=\{href\} href=\{href\}/);
  assert.match(sources[2], /if \(href\) return <a href=\{href\}/);
});

test("status badges never rely on color alone", async () => {
  const source = await readFile(new URL("../components/ui/StatusBadge.tsx", import.meta.url), "utf8");
  assert.match(source, /const marks/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /children/);
});

test("browser configuration cannot declare a service role variable", async () => {
  const [envExample, client] = await Promise.all([
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(`${envExample}\n${client}`, /NEXT_PUBLIC_[A-Z_]*SERVICE/i);
  assert.match(`${envExample}\n${client}`, /PUBLISHABLE_KEY/);
});

test("Supabase client consumes generated database types", async () => {
  const [client, types] = await Promise.all([
    readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /createClient<Database>/);
  for (const table of ["audit_events", "brand_articles", "content_assets", "content_brand_references", "content_items", "content_revision_requests", "content_timeline_cues", "crm_activities", "crm_contacts", "crm_conversation_links", "crm_identities", "launch_content_items", "launches", "memberships", "organizations", "profiles", "task_dependencies", "tasks", "task_events"]) {
    assert.match(types, new RegExp(`${table}:`));
  }
});

test("background auth events do not reload the active workspace", async () => {
  const { workspaceIdentityChanged } = await import(new URL("../lib/supabase/auth-session.ts", import.meta.url));

  assert.equal(workspaceIdentityChanged(undefined, "owner-1"), true);
  assert.equal(workspaceIdentityChanged("owner-1", "owner-1"), false);
  assert.equal(workspaceIdentityChanged("owner-1", null), true);
  assert.equal(workspaceIdentityChanged("owner-1", "owner-2"), true);

  const workspaces = await Promise.all([
    "../components/tasks/TasksWorkspace.tsx",
    "../components/content/ContentWorkspace.tsx",
    "../components/brand/BrandWorkspace.tsx",
    "../components/campaigns/CampaignsWorkspace.tsx",
    "../components/crm/CrmWorkspace.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  for (const workspace of workspaces) {
    assert.match(workspace, /useWorkspaceAuth/);
    assert.doesNotMatch(workspace, /auth\.getSession\(\)/);
    assert.doesNotMatch(workspace, /auth\.onAuthStateChange/);
  }
});

test("Telegram intake is an optional reviewed path with a secured execution timeline", async () => {
  const [migration, parser, quickForm, workspace, createCommand, contentCommands, roadmap] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817025228_telegram_smart_content_intake.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/content-intake.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/QuickIntakeForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/create-content-workflow/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/content-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/roadmap.md", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.content_timeline_cues/);
  assert.match(migration, /alter table public\.content_timeline_cues enable row level security/);
  assert.match(migration, /grant select on table public\.content_timeline_cues to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table public\.content_timeline_cues to authenticated/i);
  for (const rpc of ["create_reel_from_intake", "change_timeline_cue"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.match(migration, /to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /thumbnail_task_id, brief_task_id/);
  assert.match(migration, /cue\.completed_at is null/);
  assert.match(parser, /parseProductionRequest/);
  assert.match(quickForm, /تحليل وترتيب الطلب/);
  assert.match(quickForm, /لن يتوزع أي شيء قبل مراجعتك/);
  assert.match(workspace, /طلب كامل من Telegram/);
  assert.match(workspace, /إدخال يدوي/);
  assert.match(workspace, /content_timeline_cues/);
  assert.match(createCommand, /create_reel_from_intake/);
  assert.match(contentCommands, /change_timeline_cue/);
  assert.match(roadmap, /private Supabase Storage buckets/);
  assert.match(roadmap, /does not download, copy, or re-upload Telegram files/);
});

test("task workflow is shared between UI types and database enforcement", async () => {
  const [taskContract, migration] = await Promise.all([
    readFile(new URL("../lib/tasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260816232708_task_management.sql", import.meta.url), "utf8"),
  ]);

  for (const status of ["backlog", "ready", "in_progress", "review", "blocked", "done", "cancelled"]) {
    assert.match(taskContract, new RegExp(`\\b${status}\\b`));
    assert.match(migration, new RegExp(`'${status}'`));
  }

  assert.match(migration, /enable row level security/g);
  assert.match(migration, /private\.enforce_task_rules/);
  assert.match(migration, /private\.record_task_event/);
  assert.match(migration, /grant execute on function public\.bootstrap_market_whales_organization\(uuid\) to service_role/);
  assert.doesNotMatch(migration, /grant delete/i);
});

test("content workflow creates one guarded dependency graph shared with tasks", async () => {
  const [contentContract, migration, securityMigration, edgeFunction, workspace] = await Promise.all([
    readFile(new URL("../lib/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260816235000_content_production_pipeline.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817000500_secure_content_workflow_command.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/create-content-workflow/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  for (const step of ["brief", "recording", "editing", "thumbnail", "caption", "approval", "publishing"]) {
    assert.match(contentContract, new RegExp(`\\b${step}\\b`));
    assert.match(migration, new RegExp(`'${step}'`));
  }

  assert.match(migration, /create table public\.task_dependencies/);
  assert.match(migration, /private\.advance_content_workflow/);
  assert.match(migration, /create or replace function public\.create_reel_workflow/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*content_items/i);
  assert.match(securityMigration, /to service_role/);
  assert.match(securityMigration, /from public, anon, authenticated/);
  assert.match(edgeFunction, /createSupabaseContext/);
  assert.match(edgeFunction, /auth: "user"/);
  assert.match(workspace, /functions\.invoke\("create-content-workflow"/);
  assert.match(workspace, /7 مهام مترابطة/);
});

test("content production briefs, assets, and revision rounds share one secured workflow", async () => {
  const [migration, commands, createCommand, workspace, taskWorkspace, contentContract, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817014819_content_production_briefs_and_revisions.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/content-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/create-content-workflow/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  for (const table of ["content_assets", "content_revision_requests"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(types, new RegExp(`${table}:`));
  }
  for (const rpc of ["create_reel_production_workflow", "update_content_production_brief", "add_content_asset", "remove_content_asset", "request_content_revision", "change_content_revision"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
    assert.match(types, new RegExp(`${rpc}:`));
  }
  assert.match(migration, /to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /guard_content_approval_revisions/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table public\.(content_assets|content_revision_requests) to authenticated/i);
  assert.match(commands, /createSupabaseContext/);
  assert.match(commands, /auth: "user"/);
  assert.match(commands, /request_revision/);
  assert.match(commands, /resolve_revision/);
  assert.match(createCommand, /create_reel_production_workflow/);
  assert.match(workspace, /Production Brief للمونتاج/);
  assert.match(workspace, /مركز الأصول/);
  assert.match(workspace, /جولات التعديل/);
  assert.match(workspace, /functions\.invoke\("content-commands"/);
  assert.match(taskWorkspace, /فتح ملف المحتوى وتسليم النتيجة/);
  assert.match(contentContract, /contentAssetKindConfig/);
  assert.match(contentContract, /contentRevisionStatusConfig/);
});

test("social post deliverables expand into parallel copy and design workflows without double-counting the campaign output", async () => {
  const [enumMigration, engineMigration, launchCommand, contentCommand, campaignWorkspace, contentWorkspace, taskWorkspace, contract, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819015223_social_post_workflow_template.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819015240_social_post_workflow_engine.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/launch-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/content-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns/CampaignsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(enumMigration, /add value if not exists 'design'/);
  assert.match(enumMigration, /add value if not exists 'scheduling'/);
  assert.match(engineMigration, /create table public\.content_step_deliveries/);
  assert.match(engineMigration, /alter table public\.content_step_deliveries enable row level security/);
  assert.match(engineMigration, /grant select on table public\.content_step_deliveries to authenticated/);
  assert.doesNotMatch(engineMigration, /grant (insert|update|delete) on table public\.content_step_deliveries to authenticated/i);
  for (const rpc of ["create_social_post_deliverable", "submit_content_step_delivery", "update_social_post_brief"]) {
    assert.match(engineMigration, new RegExp(`function public\\.${rpc}`));
    assert.match(engineMigration, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.match(engineMigration, /\(caption_task_id, brief_task_id\)/);
  assert.match(engineMigration, /\(design_task_id, brief_task_id\)/);
  assert.match(engineMigration, /\(approval_task_id, caption_task_id\)/);
  assert.match(engineMigration, /\(approval_task_id, design_task_id\)/);
  assert.match(engineMigration, /\(parent_task_id, publishing_task_id\)/);
  assert.match(engineMigration, /workflow_template/);
  assert.match(engineMigration, /target_creation_request_id/);
  assert.match(engineMigration, /tasks_require_content_step_delivery/);
  assert.match(launchCommand, /create_social_post_deliverable/);
  assert.match(launchCommand, /crypto|creation_request_id/);
  assert.match(contentCommand, /submit_step_delivery/);
  assert.match(contentCommand, /update_social_post_brief/);
  assert.match(campaignWorkspace, /إنشاء البند ومصنع البوستات/);
  assert.match(campaignWorkspace, /الكابشن والتصميم بالتوازي/);
  assert.match(contentWorkspace, /كل مرحلة تسلّم نتيجتها داخل الكارت/);
  assert.match(contentWorkspace, /Social Post Brief/);
  assert.match(taskWorkspace, /\["caption", "design", "scheduling", "publishing"\]/);
  assert.match(contract, /socialPostContentSteps/);
  for (const field of ["content_step_deliveries", "copy_brief", "design_brief", "launch_deliverable_id", "workflow_template"]) {
    assert.match(types, new RegExp(`${field}:`));
  }
});

test("brand knowledge is versioned, owner-approved, and linked to content by an exact secured reference", async () => {
  const [migration, indexMigration, commands, createWorkflow, brandWorkspace, contentWorkspace, architecture] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817165446_brand_knowledge_center.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817171101_brand_reference_fk_index.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/brand-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/create-content-workflow/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/brand/BrandWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/architecture.md", import.meta.url), "utf8"),
  ]);

  for (const table of ["brand_articles", "content_brand_references"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`));
    assert.doesNotMatch(migration, new RegExp(`grant (insert|update|delete) on table public\\.${table} to authenticated`, "i"));
  }
  for (const rpc of ["create_brand_article_draft", "update_brand_article_draft", "revise_brand_article", "approve_brand_article", "archive_brand_article", "create_reel_production_workflow_v2", "create_reel_from_intake_v2"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.match(migration, /to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /brand_articles_one_approved_per_topic_idx/);
  assert.match(indexMigration, /content_brand_references_content_org_fk_idx/);
  assert.match(migration, /article\.status = 'approved'/);
  assert.match(commands, /createSupabaseContext/);
  assert.match(commands, /auth: "user"/);
  assert.match(brandWorkspace, /المسودة لا تؤثر على الشغل الحالي/);
  assert.match(contentWorkspace, /brand_article_ids/);
  assert.match(contentWorkspace, /مراجع البراند المعتمدة/);
  assert.match(createWorkflow, /create_reel_production_workflow_v2/);
  assert.match(createWorkflow, /create_reel_from_intake_v2/);
  assert.match(architecture, /approved body is immutable/i);
});

test("application shell does not impersonate an authenticated owner", async () => {
  const source = await readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /سميح عجوة/);
  assert.match(source, /SessionChip/);
});

test("CRM foundation keeps PII behind RLS and follow-ups inside the shared task system", async () => {
  const [migration, contextMigration, scaleMigration, edgeFunction, workspace, taskWorkspace, contract, roadmap] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817033924_crm_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817151104_crm_contact_context_and_chat_links.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817205723_crm_search_multi_identity_owner_performance.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/crm-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/crm.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/roadmap.md", import.meta.url), "utf8"),
  ]);

  for (const table of ["crm_contacts", "crm_identities", "crm_activities"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`));
  }
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table public\.crm_(contacts|identities|activities) to authenticated/i);
  for (const rpc of ["create_crm_lead", "record_crm_activity"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
  }
  assert.match(migration, /tasks_one_open_crm_follow_up_idx/);
  assert.match(migration, /CRM follow-up tasks are managed through the CRM workflow only/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(edgeFunction, /createSupabaseContext/);
  assert.match(edgeFunction, /auth: "user"/);
  assert.match(edgeFunction, /create_crm_lead_v3/);
  assert.match(edgeFunction, /add_crm_identity/);
  assert.match(contextMigration, /create table public\.crm_conversation_links/);
  assert.match(contextMigration, /alter table public\.crm_conversation_links enable row level security/);
  assert.match(contextMigration, /grant select on table public\.crm_conversation_links to authenticated/);
  assert.doesNotMatch(contextMigration, /grant (insert|update|delete) on table public\.crm_conversation_links to authenticated/i);
  assert.match(contextMigration, /function public\.create_crm_lead_v2/);
  assert.match(contextMigration, /to service_role/);
  assert.match(contextMigration, /from public, anon, authenticated/);
  for (const rpc of ["create_crm_lead_v3", "add_crm_identity", "search_crm_contacts", "get_crm_owner_performance"]) {
    assert.match(scaleMigration, new RegExp(`function public\\.${rpc}`));
  }
  assert.match(scaleMigration, /create extension if not exists pg_trgm/);
  assert.match(scaleMigration, /security invoker/);
  assert.match(scaleMigration, /grant execute on function public\.search_crm_contacts[\s\S]*to authenticated/);
  assert.match(scaleMigration, /grant execute on function public\.create_crm_lead_v3[\s\S]*to service_role/);
  assert.match(workspace, /لن تُرسل أي رسالة/);
  assert.match(workspace, /لينك شات/);
  assert.match(workspace, /اسم المصدر الجديد/);
  assert.match(workspace, /سبب التسجيل الجديد/);
  assert.match(workspace, /ابحث بالاسم، الهاتف، البريد، Telegram/);
  assert.match(workspace, /أداء مسؤولي العملاء/);
  assert.match(workspace, /وسائل التواصل — املأ واحدة أو أكثر/);
  assert.match(workspace, /functions\.invoke\("crm-commands"/);
  assert.match(taskWorkspace, /فتح ملف العميل وتسجيل النتيجة/);
  assert.doesNotMatch(migration, /'متابعة عميل محتمل[^']*'\s*,\s*contact_full_name/);
  assert.match(contract, /allowedCrmTransitions/);
  assert.match(roadmap, /Deferred scheduled Telegram publishing/);
  assert.match(roadmap, /test_mode/);
  assert.match(roadmap, /idempotency key/);
});

test("Edge Function errors expose safe server messages through one shared parser", async () => {
  const [parser, ...workspaces] = await Promise.all([
    readFile(new URL("../lib/supabase/function-errors.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns/CampaignsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(parser, /FunctionsHttpError/);
  assert.match(parser, /error\.context\.json\(\)/);
  for (const workspace of workspaces) assert.match(workspace, /getSupabaseFunctionErrorMessage/);
});

test("launch workflow uses guarded gates, shared tasks, and reversible content links", async () => {
  const [launchContract, migration, detachMigration, targetMigration, executionMigration, edgeFunction, workspace, taskWorkspace, indexMigration] = await Promise.all([
    readFile(new URL("../lib/launches.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817002626_campaign_launch_pipeline.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817003302_campaign_launch_detach_content.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817004019_campaign_launch_positive_target.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260818010000_launch_execution_plan.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/launch-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns/CampaignsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817003051_campaign_launch_fk_indexes.sql", import.meta.url), "utf8"),
  ]);

  for (const gate of ["strategy", "offer", "registration", "delivery", "promotion", "tracking", "go_no_go", "launch_day"]) {
    assert.match(launchContract, new RegExp(`\\b${gate}\\b`));
    assert.match(migration, new RegExp(`'${gate}'`));
  }

  assert.match(migration, /create table public\.launches/);
  assert.match(migration, /create table public\.launch_content_items/);
  assert.match(migration, /private\.unlock_task_dependencies/);
  assert.match(migration, /private\.advance_launch_workflow/);
  assert.match(migration, /create or replace function public\.create_launch_workflow/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*launches/i);
  assert.match(detachMigration, /detach_content_from_launch/);
  assert.match(detachMigration, /launch\.content_detached/);
  assert.match(targetMigration, /launches_has_positive_target/);
  assert.match(indexMigration, /tasks_launch_org_fk_idx/);
  for (const table of ["launch_documents", "launch_deliverables", "launch_deliverable_dependencies"]) {
    assert.match(executionMigration, new RegExp(`create table public\\.${table}`));
    assert.match(executionMigration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(executionMigration, new RegExp(`grant select on table public\\.${table} to authenticated`));
  }
  for (const rpc of ["save_launch_gate_document", "create_launch_deliverable", "submit_launch_deliverable"]) {
    assert.match(executionMigration, new RegExp(`function public\\.${rpc}`));
  }
  assert.match(executionMigration, /tasks_require_launch_output/);
  assert.match(executionMigration, /launch_deliverable_id/);
  assert.match(executionMigration, /to service_role/);
  assert.doesNotMatch(executionMigration, /grant (insert|update|delete) on table public\.launch_/i);
  assert.match(edgeFunction, /createSupabaseContext/);
  assert.match(edgeFunction, /auth: "user"/);
  assert.match(edgeFunction, /attach_content/);
  assert.match(edgeFunction, /detach_content/);
  assert.match(edgeFunction, /save_gate_document/);
  assert.match(edgeFunction, /create_deliverable/);
  assert.match(edgeFunction, /submit_deliverable/);
  assert.match(workspace, /functions\.invoke\("launch-commands"/);
  assert.match(workspace, /8 بوابات مترابطة/);
  assert.match(workspace, /الفعلي غير مربوط بعد/);
  assert.match(workspace, /هنا تُحفظ الاستراتيجية وباقي قرارات الإطلاق/);
  assert.match(workspace, /الكميات والمواعيد والميزانية والاعتماديات/);
  assert.match(workspace, /إنشاء البند والمهمة/);
  assert.match(taskWorkspace, /launchGateConfig/);
  assert.match(taskWorkspace, /فتح التفاصيل وتسليم النتيجة/);
});

test("task and content workspaces default to focused current work with clear Arabic typography and expandable detail", async () => {
  const [layout, css, taskWorkspace, contentWorkspace, collapsibleText, taskContract, packageJson] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/CollapsibleText.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/tasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /@fontsource-variable\/noto-sans-arabic/);
  assert.match(layout, /noto-sans-arabic\/wght\.css/);
  assert.match(css, /Noto Sans Arabic Variable/);
  assert.match(taskWorkspace, /شغل مطلوب تنفيذه/);
  assert.match(taskWorkspace, /filter.*active/s);
  assert.match(taskWorkspace, /متأخرة منذ/);
  assert.match(taskWorkspace, /formatOverdueDuration/);
  assert.match(taskWorkspace, /CollapsibleText/);
  assert.match(collapsibleText, /إظهار المزيد/);
  assert.match(taskContract, /تنتظر خطوة سابقة/);
  assert.match(contentWorkspace, /contentFilter/);
  assert.match(contentWorkspace, /فتح التفاصيل/);
  assert.match(contentWorkspace, /published.*cancelled/s);
});

test("notifications, evidence-based team reports, and transparent coarse presence are tenant secured", async () => {
  const [migration, hardening, selfRevisionFix, appShell, notificationCenter, presenceReporter, teamWorkspace, teamPage, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819021613_team_operations_notifications_presence.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819022259_harden_user_state_commands.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819024032_notify_self_assigned_content_revisions.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/NotificationCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/PresenceReporter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/team/TeamWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/team/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);
  for (const table of ["notifications", "member_presence"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(types, new RegExp(`${table}:`));
  }
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table public\.notifications to authenticated/i);
  assert.match(migration, /get_team_task_performance/);
  assert.match(migration, /no productivity score or subjective employee ranking/i);
  assert.match(migration, /No clicks, keystrokes, or hidden surveillance/i);
  assert.match(hardening, /security invoker/g);
  assert.match(hardening, /member_presence_enforce_write/);
  assert.match(selfRevisionFix, /تم تسجيل طلب تعديل لك/);
  assert.match(selfRevisionFix, /on conflict \(dedupe_key\) do nothing/);
  assert.doesNotMatch(selfRevisionFix, /if new\.assigned_to is distinct from new\.requested_by/);
  assert.match(appShell, /NotificationCenter/);
  assert.match(appShell, /PresenceReporter/);
  assert.match(notificationCenter, /mark_notification_read/);
  assert.match(notificationCenter, /30_000/);
  assert.match(notificationCenter, /visibilitychange/);
  assert.match(notificationCenter, /notification-toast/);
  assert.match(presenceReporter, /60_000/);
  assert.match(teamWorkspace, /أرقام واقعية بلا تقييم شخصي/);
  assert.match(teamWorkspace, /آخر أسبوع/);
  assert.match(teamWorkspace, /آخر 30 يوم/);
  assert.match(teamWorkspace, /مدة محددة/);
  assert.match(teamPage, /أداء واضح من غير مراقبة عشوائية/);
});
