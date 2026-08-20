import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared navigation covers every primary route", async () => {
  const source = await readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8");
  for (const route of ["/tasks", "/content", "/publishing", "/brand", "/campaigns", "/crm", "/analytics", "/team", "/settings"]) {
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
  for (const table of ["audit_events", "brand_articles", "content_assets", "content_brand_references", "content_items", "content_revision_requests", "content_timeline_cues", "crm_activities", "crm_contacts", "crm_conversation_links", "crm_identities", "launch_content_items", "launches", "memberships", "organizations", "profiles", "publishing_channels", "publishing_occurrences", "publishing_publication_logs", "publishing_schedules", "publishing_telegram_assets", "task_dependencies", "tasks", "task_events"]) {
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
    "../components/publishing/PublishingWorkspace.tsx",
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
  const [contentContract, migration, securityMigration, compactMigration, nonBlockingMigration, edgeFunction, workspace, taskWorkspace] = await Promise.all([
    readFile(new URL("../lib/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260816235000_content_production_pipeline.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817000500_secure_content_workflow_command.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819033000_compact_reel_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819165954_remove_blocking_content_approval.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/create-content-workflow/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
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
  assert.match(edgeFunction, /create_reel_production_workflow_v3/);
  assert.match(workspace, /functions\.invoke\("create-content-workflow"/);
  assert.match(workspace, /3 مهام إذا كانت المادة الخام جاهزة، و4 فقط/);
  assert.match(workspace, /الكابشن النهائي/);
  assert.match(workspace, /النتيجة تغلق المهمة وتفتح التالية تلقائيًا/);
  assert.doesNotMatch(contentContract, /"brief", "recording", "editing", "thumbnail", "caption", "approval", "publishing"/);
  assert.match(nonBlockingMigration, /task_record\.content_step = 'publishing'/);
  assert.match(nonBlockingMigration, /update public\.tasks set status = 'done'/);
  assert.match(nonBlockingMigration, /task\.content_step = 'approval'[\s\S]*status = 'cancelled'/);
  assert.match(nonBlockingMigration, /'task_done'/);
  assert.match(compactMigration, /add column is_work_item boolean not null default true/);
  assert.match(compactMigration, /caption_owned_by_content_creator/);
  assert.match(compactMigration, /create_reel_production_workflow_v3/);
  assert.match(compactMigration, /change_reel_approval_gate/);
  assert.match(taskWorkspace, /\.eq\("is_work_item", true\)/);
  assert.match(taskWorkspace, /content-workflow-group/);
  assert.match(taskWorkspace, /contentWorkflowMatchesFilter/);
  assert.match(taskWorkspace, /if \(isContentWorkflow\) return tasks\.every\(taskIsClosed\) \? "closed" : "work"/);
  assert.match(taskWorkspace, /content-workflow-progress/);
  assert.match(taskWorkspace, /مهمتك الآن/);
});

test("content production briefs, assets, and revision rounds share one secured workflow", async () => {
  const [migration, completionMigration, nonBlockingMigration, commands, createCommand, workspace, taskWorkspace, contentContract, taskContract, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817014819_content_production_briefs_and_revisions.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819040034_simplify_content_task_completion.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819165954_remove_blocking_content_approval.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/content-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/create-content-workflow/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/content.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/tasks.ts", import.meta.url), "utf8"),
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
  assert.match(workspace, /حفظ التسليم وإغلاق المهمة/);
  assert.match(workspace, /تأكيد أنه تم النشر/);
  assert.match(taskWorkspace, /فتح وتسليم المهمة/);
  assert.doesNotMatch(taskWorkspace, /status-select compact/);
  assert.match(commands, /recording.*editing.*thumbnail.*caption.*design.*scheduling.*publishing/);
  assert.match(completionMigration, /confirm_content_publishing_task_id/);
  assert.match(completionMigration, /Only organization leadership can approve a submitted content task/);
  assert.doesNotMatch(nonBlockingMigration, /Only organization leadership can approve a submitted content task/);
  assert.match(nonBlockingMigration, /completed_by_single_submission/);
  assert.match(completionMigration, /task_record\.content_step = 'publishing'/);
  assert.match(taskContract, /done: "تم النشر"/);
  assert.match(contentContract, /contentAssetKindConfig/);
  assert.match(contentContract, /contentRevisionStatusConfig/);
});

test("social post deliverables expand into parallel copy and design workflows without double-counting the campaign output", async () => {
  const [enumMigration, engineMigration, completionMigration, nonBlockingMigration, launchCommand, contentCommand, campaignWorkspace, contentWorkspace, taskWorkspace, contract, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819015223_social_post_workflow_template.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819015240_social_post_workflow_engine.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819040034_simplify_content_task_completion.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819165954_remove_blocking_content_approval.sql", import.meta.url), "utf8"),
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
  assert.match(contentWorkspace, /النتيجة تغلق المهمة وتفتح التالية تلقائيًا/);
  assert.match(contentWorkspace, /Social Post Brief/);
  assert.match(taskWorkspace, /فتح للمراجعة والاعتماد/);
  assert.match(completionMigration, /content_step_deliveries_step_allowed/);
  assert.match(nonBlockingMigration, /prerequisite\.content_step in \('caption', 'design'\)/);
  assert.match(contract, /socialPostContentSteps/);
  for (const field of ["content_step_deliveries", "copy_brief", "design_brief", "launch_deliverable_id", "workflow_template"]) {
    assert.match(types, new RegExp(`${field}:`));
  }
});

test("Telegram auto-publishing is durable, allowlisted, fenced, safely editable, and visible in one control room", async () => {
  const [schema, workerMigration, occurrenceKeyMigration, mediaLibraryMigration, scheduleManagementMigration, invariantTest, worker, webhook, commands, workspace, publishingContract, navigation, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819165956_telegram_auto_publishing.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819170000_telegram_auto_publishing_worker.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260820030355_immutable_publishing_occurrence_key.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260820153739_telegram_media_library.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260820163232_manage_publishing_schedule_revisions.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/tests/telegram_publishing_invariants.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/telegram-publisher/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/telegram-webhook/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/telegram-publishing-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/publishing/PublishingWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/publishing.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);
  for (const table of ["publishing_channels", "publishing_posts", "publishing_schedules", "publishing_occurrences", "publishing_publication_logs"]) {
    assert.match(schema, new RegExp(`create table public\\.${table}`));
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(types, new RegExp(`${table}:`));
  }
  assert.match(schema, /allowlisted boolean not null default false/);
  assert.match(schema, /unique \(occurrence_id, channel_id\)/);
  assert.match(workerMigration, /for update of occurrence skip locked/);
  assert.match(workerMigration, /network_started_at is not null[\s\S]*status = 'unknown'/);
  assert.match(workerMigration, /snapshot_hash_mismatch/);
  assert.match(workerMigration, /kill_switch_generation_changed/);
  assert.match(occurrenceKeyMigration, /occurrence_key/);
  assert.match(occurrenceKeyMigration, /on conflict \(occurrence_key\) do nothing/);
  assert.match(mediaLibraryMigration, /create table public\.publishing_telegram_assets/);
  assert.match(mediaLibraryMigration, /publishing_telegram_assets_org_file_unique/);
  assert.match(mediaLibraryMigration, /alter table public\.publishing_telegram_assets enable row level security/);
  assert.match(mediaLibraryMigration, /publishing-media-previews/);
  assert.match(mediaLibraryMigration, /resolve_publishing_post_media_asset/);
  assert.match(scheduleManagementMigration, /function public\.revise_telegram_publication/);
  assert.match(scheduleManagementMigration, /function public\.delete_publishing_schedule/);
  assert.match(scheduleManagementMigration, /hold_reason = 'schedule_revised'/);
  assert.match(scheduleManagementMigration, /hold_reason = 'schedule_deleted'/);
  assert.match(scheduleManagementMigration, /publication_log\.status in \('claimed', 'publishing'\)/);
  assert.match(scheduleManagementMigration, /publishing\.schedule_revised/);
  assert.match(scheduleManagementMigration, /publishing\.schedule_deleted/);
  assert.doesNotMatch(scheduleManagementMigration, /delete from public\.publishing_/);
  assert.match(invariantTest, /Duplicate publication claim was created/);
  assert.match(invariantTest, /Expired network call was retried/);
  assert.match(invariantTest, /Publish-now rematerialized the original scheduled slot/);
  assert.match(worker, /mark_publication_network_started/);
  assert.match(worker, /target_terminal_status: "unknown"/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /publishing_telegram_assets/);
  assert.match(webhook, /telegram_file_unique_id/);
  assert.match(webhook, /publishing_admin_connections/);
  assert.match(worker, /previewMethod/);
  assert.match(worker, /sendPhoto/);
  assert.match(commands, /getChatMember/);
  assert.match(commands, /verified_can_post/);
  assert.match(publishingContract, /معاينة ثم نشر تلقائي/);
  assert.match(workspace, /previewPolicyConfig/);
  assert.match(workspace, /إيقاف طوارئ/);
  assert.match(workspace, /مكتبة وسائط النشر/);
  assert.match(workspace, /@teamwhalesbot/);
  assert.match(workspace, /aria-controls="publishing-composer"/);
  assert.match(workspace, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(workspace, /إغلاق نموذج الجدولة/);
  assert.match(workspace, /تعديل المنشور والجدول/);
  assert.match(workspace, /نعم، احذف الجدول/);
  assert.match(workspace, /النسخ القادمة القديمة/);
  assert.match(workspace, /revise_telegram_publication/);
  assert.match(workspace, /delete_publishing_schedule/);
  assert.doesNotMatch(workspace, /disabled=\{!readyChannels\.length\} onClick=\{toggleComposer\}/);
  assert.match(types, /revise_telegram_publication:/);
  assert.match(types, /delete_publishing_schedule:/);
  assert.match(navigation, /href: "\/publishing"/);
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
  assert.match(createWorkflow, /create_reel_production_workflow_v3/);
  assert.match(createWorkflow, /create_reel_from_intake_v3/);
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
  assert.match(roadmap, /Telegram scheduled publishing foundation — implemented/);
  assert.match(roadmap, /unique database claim/);
  assert.match(roadmap, /never retried automatically/);
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
  const [migration, hardening, selfRevisionFix, selfAssignmentFix, appShell, notificationCenter, presenceReporter, teamWorkspace, teamPage, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819021613_team_operations_notifications_presence.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819022259_harden_user_state_commands.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819024032_notify_self_assigned_content_revisions.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819034452_notify_self_assigned_tasks.sql", import.meta.url), "utf8"),
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
  assert.match(selfAssignmentFix, /if new\.status = 'ready' then/);
  assert.doesNotMatch(selfAssignmentFix, /new\.status = 'ready'\s+and new\.owner_id is distinct from actor/);
  assert.match(selfAssignmentFix, /revoke all on function private\.notify_task_change\(\)/);
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
