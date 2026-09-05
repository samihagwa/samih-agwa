import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared navigation exposes one permission-aware content area while old routes remain valid", async () => {
  const [navigation, contentNavigation, shell, access] = await Promise.all([
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/ContentSectionNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
  ]);
  for (const route of ["/tasks", "/content", "/scripts", "/publishing", "/brand", "/crm", "/analytics", "/chat", "/team", "/settings"]) {
    assert.match(navigation, new RegExp(`href(?::|=)\\s*["']${route}`));
  }
  assert.doesNotMatch(navigation, /id:\s*["']planning["']/);
  assert.doesNotMatch(navigation, /\{\s*id:\s*["']campaigns["']/);
  assert.doesNotMatch(navigation, /label:\s*["']الحملات والإطلاقات["']/);
  assert.match(navigation, /label:\s*["']طلبات المحتوى["']/);
  assert.match(navigation, /allowed\.has\("content"\) \|\| allowed\.has\("planning"\) \|\| allowed\.has\("campaigns"\)/);
  assert.match(navigation, /campaigns:\s*\{ href:\s*["']\/campaigns["'] \}/);
  assert.match(contentNavigation, /href:\s*["']\/planning["']/);
  assert.match(contentNavigation, /href:\s*["']\/content["']/);
  assert.match(contentNavigation, /id:\s*["']campaigns["'], href:\s*["']\/campaigns["']/);
  assert.match(contentNavigation, /الإطلاقات — للمدير/);
  assert.match(contentNavigation, /visibleViews = views\.filter\(\(\{ id \}\) => allowed\.has\(id\)\)/);
  assert.match(shell, /<ContentSectionNav allowedSections=\{allowedSections\}/);
  assert.match(shell, /requestedSection === "campaigns"/);
  assert.match(access, /\{ id: "planning", label: "الخطة وتقويم المحتوى", href: "\/planning" \}/);
  assert.match(access, /\{ id: "content", label: "طلبات التنفيذ", href: "\/content" \}/);
  assert.match(access, /\{ id: "campaigns", label: "الحملات والإطلاقات", href: "\/campaigns" \}/);
});

test("internal navigation remains usable when the experimental client router fails", async () => {
  const sources = await Promise.all([
    "../app/page.tsx",
    "../components/layout/SidebarNav.tsx",
    "../components/layout/ContentSectionNav.tsx",
    "../components/ui/Button.tsx",
    "../components/content/ContentWorkspace.tsx",
    "../components/planning/PlanningWorkspace.tsx",
    "../components/campaigns/CampaignsWorkspace.tsx",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  assert.doesNotMatch(sources.join("\n"), /from ["']next\/link["']/);
  assert.match(sources[1], /<a key=\{href\} href=\{href\}/);
  assert.match(sources[2], /<a key=\{href\} href=\{href\}/);
  assert.match(sources[3], /if \(href\) return <a href=\{href\}/);
});

test("planning capacity is advisory, atomic, AI-readable, and linked to exact execution", async () => {
  const [capacityMigration, workflowMigration, planning, calendar, tasks, assistant, types, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260826012841_team_capacity_unified_calendar.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260826020205_rebuild_compact_reel_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/planning/PlanningWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/planning/TeamCapacityCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/workspace-assistant/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(capacityMigration, /create table public\.team_capacity_settings/);
  assert.match(capacityMigration, /create or replace function public\.check_team_member_capacity/);
  assert.match(capacityMigration, /create or replace function public\.get_team_capacity_calendar/);
  assert.match(capacityMigration, /create or replace function public\.create_plan_item_execution/);
  assert.match(capacityMigration, /TEAM_CAPACITY_EXCEEDED/);
  assert.match(capacityMigration, /allow_capacity_override/);
  assert.match(capacityMigration, /source_plan_item_id/);
  assert.match(capacityMigration, /alter table public\.team_capacity_settings enable row level security/);
  assert.match(workflowMigration, /work_task_count.*raw_material_ready/s);
  assert.match(workflowMigration, /content_step, is_work_item, estimated_minutes/);
  assert.doesNotMatch(workflowMigration, /content_step, is_work_item, estimated_minutes[\s\S]*'approval'/);

  assert.match(planning, /إرسال للتنفيذ الآن/);
  assert.match(planning, /حفظ في التقويم فقط/);
  assert.match(planning, /إسناد رغم الضغط/);
  assert.match(planning, /create_plan_item_execution/);
  assert.match(planning, /plan-item-\$\{item\.id\}/);
  assert.match(calendar, /تقويم الفريق وحمل التنفيذ/);
  assert.match(calendar, /workspace-ai:ask/);
  assert.match(calendar, /team_capacity_settings/);
  assert.match(tasks, /check_team_member_capacity/);
  assert.match(tasks, /estimated_minutes/);
  assert.match(tasks, /اسأل AI قبل الإسناد/);
  assert.match(tasks, /workspace-ai:ask/);
  assert.match(assistant, /planning_context/);
  assert.match(assistant, /daily_capacity_minutes/);
  assert.match(types, /team_capacity_settings:/);
  assert.match(types, /create_plan_item_execution:/);
  assert.match(css, /\.capacity-board-wrap[^}]*overflow-x: auto/);
});

test("status badges never rely on color alone", async () => {
  const source = await readFile(new URL("../components/ui/StatusBadge.tsx", import.meta.url), "utf8");
  assert.match(source, /const marks/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /children/);
});

test("workflow execution is assignee-scoped, voice profiles are private, and mobile navigation is a drawer", async () => {
  const [hardening, cancelFix, taskContract, tasks, content, scripts, editor, launches, launchCommands, shell, navigation, css, access] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822030003_harden_workflow_permissions_and_private_voice_profiles.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822032608_fix_cancel_launch_reason_ambiguity.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/tasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns/CampaignsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/launch-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
  ]);

  assert.match(hardening, /tasks_update_assignee_or_platform_admin/);
  assert.match(hardening, /Only the assigned task owner can execute or update this task/);
  assert.match(taskContract, /role === "owner" \|\| role === "admin"/);
  assert.match(tasks, /canManageAllTaskExecution/);
  assert.match(content, /contentCoordinator/);
  assert.match(hardening, /content_items_select_involved_members/);
  assert.match(hardening, /content_assets_select_involved_members/);

  assert.match(hardening, /add primary key \(organization_id, user_id\)/);
  assert.match(hardening, /script_voice_select_self/);
  assert.match(hardening, /profile\.user_id = target_user_id/);
  assert.match(hardening, /Only the assigned writer can generate this private script/);
  assert.match(scripts, /بصمتي الخاصة/);
  assert.match(editor, /const assignedWriter/);
  assert.match(editor, /const readOnly = !canWriteScript/);

  assert.match(launchCommands, /action === "update_launch"/);
  assert.match(launchCommands, /action === "cancel_launch"/);
  assert.match(launches, /إلغاء الإطلاق/);
  assert.match(launches, /سبب الإلغاء/);
  assert.match(cancelFix, /cancellation_reason = trim\(\$4\)/);

  assert.match(shell, /mobile-nav-trigger/);
  assert.match(shell, /mobile-nav-backdrop/);
  assert.match(navigation, /onNavigate/);
  assert.match(css, /\.sidebar\.mobile-open \{ transform: translateX\(0\)/);
  assert.match(css, /\.mobile-nav-backdrop\.visible/);
  assert.match(access, /manager: \["tasks", "planning", "chat"\]/);
  assert.match(access, /member: \["tasks", "chat"\]/);
});

test("task review is optional, requester-gated, and never self-approved", async () => {
  const [migration, revisionMigration, statusGuardMigration, requesterIndexMigration, taskContract, workspace, detail, deepLinks, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260825151421_optional_task_review_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825160911_task_detail_revision_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825162147_prevent_task_status_bypass.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825163600_index_task_revision_request_requester.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/tasks.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/deep-links.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /add column requires_review boolean not null default false/);
  assert.match(migration, /char_length\(trim\(acceptance_criteria\)\) <= 4000/);
  assert.match(migration, /tasks_update_assignee_requester_or_platform_admin/);
  assert.match(migration, /The task assignee cannot modify their own task while it is under review/);
  assert.match(migration, /Submit this task for review before completion/);
  assert.match(migration, /new\.created_by, 'task_review'/);

  assert.match(taskContract, /requiresReview \? "review" : "done"/);
  assert.match(taskContract, /currentStatus === "review" \? "إرجاع للتنفيذ"/);
  assert.match(taskContract, /if \(!isAssignee\) return \[\]/);
  assert.doesNotMatch(taskContract, /in_progress:\s*\["ready"/);
  assert.match(workspace, /معيار القبول — اختياري/);
  assert.match(workspace, /هل المهمة تحتاج مراجعة؟/);
  assert.match(workspace, /task\.status === "review" && task\.created_by === currentUserId/);
  assert.match(workspace, /غير متاح عند إسناد المهمة لنفسك/);
  assert.match(workspace, /taskDeepLink\(task\.id\)/);
  assert.match(revisionMigration, /create table public\.task_revision_requests/);
  assert.match(revisionMigration, /task_revision_requests_insert_requester_or_platform_admin/);
  assert.match(revisionMigration, /Platform leadership cannot execute a task assigned to another member/);
  assert.match(revisionMigration, /app\.task_revision_request_id/);
  assert.match(revisionMigration, /Invalid task revision command/);
  assert.match(revisionMigration, /'revision_requested'/);
  assert.match(revisionMigration, /new\.url := '\/tasks\/' \|\| new\.entity_id/);
  assert.match(statusGuardMigration, /create or replace function private\.guard_manual_task_status_actor/);
  assert.match(statusGuardMigration, /The assignee cannot approve, cancel, or reopen their own task/);
  assert.match(statusGuardMigration, /Return reviewed work through a written revision request/);
  assert.match(statusGuardMigration, /Only the assigned task owner can execute this task/);
  assert.match(statusGuardMigration, /drop trigger if exists tasks_actor_status_guard/);
  assert.match(requesterIndexMigration, /\(requested_by, requested_at desc, id\)/);
  assert.match(detail, /const canRequestRevision/);
  assert.match(detail, /from\("task_revision_requests"\)\.insert/);
  assert.match(detail, /task_version: workspace\.task\.version/);
  assert.match(detail, /التنفيذ يخص/);
  assert.match(deepLinks, /return `\/tasks\/\$\{id\}`/);
  assert.match(types, /task_revision_requests:/);
  assert.match(types, /requires_review: boolean/);
});

test("team community chat is private, realtime, command-written, and permission scoped", async () => {
  const [migration, hardening, commands, workspace, page, navigation, access, presence, css, types, config] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822171303_team_chat_workspace_assistant.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822172439_harden_chat_commands_and_indexes.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/chat-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/chat/ChatWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/chat/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/PresenceReporter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  for (const table of ["team_chat_rooms", "team_chat_messages"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(types, new RegExp(`${table}:`));
  }
  assert.match(migration, /private\.can_access_any_section\(organization_id, array\['chat'\]/);
  assert.match(migration, /revoke all on table public\.team_chat_messages from anon, authenticated/);
  assert.match(migration, /send_team_chat_message/);
  assert.match(migration, /Only the message author can edit this message/);
  assert.match(migration, /Only the author or workspace leadership can delete this message/);
  assert.match(migration, /alter publication supabase_realtime add table public\.team_chat_messages/);
  assert.match(workspace, /postgres_changes/);
  assert.match(hardening, /send_team_chat_message_v2/);
  assert.match(hardening, /to service_role/);
  assert.match(hardening, /drop function public\.send_team_chat_message/);
  assert.match(hardening, /team_chat_messages_room_org_idx/);
  assert.match(commands, /createSupabaseContext/);
  assert.match(commands, /auth: "user"/);
  assert.match(commands, /send_team_chat_message_v2/);
  assert.match(workspace, /functions\.invoke\("chat-commands"/);
  assert.doesNotMatch(workspace, /\.rpc\("(send|edit|delete|create)_team_chat/);
  assert.match(page, /دردشة داخلية منظمة/);
  assert.match(navigation, /href: "\/chat"/);
  assert.match(access, /id: "chat"/);
  assert.match(presence, /\["\/chat", "chat"\]/);
  assert.match(css, /\.team-chat-shell/);
  assert.match(config, /\[functions\.chat-commands\][\s\S]*verify_jwt = true/);
});

test("task links stay visible, task discussion notifies exact participants, and member names are durable", async () => {
  const [migration, notificationKinds, board, detail, sessionChip, chat, css, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260826003105_task_discussion_and_member_names.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260826003817_allow_task_discussion_notification_kinds.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/SessionChip.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/chat/ChatWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.task_discussion_messages/);
  assert.match(migration, /alter table public\.task_discussion_messages enable row level security/);
  assert.match(migration, /task_discussion_select_participants/);
  assert.match(migration, /task_discussion_insert_participants/);
  assert.match(migration, /grant insert \(task_id, body\)/);
  assert.match(migration, /'task_question'/);
  assert.match(migration, /'\/tasks\/' \|\| task_record\.id \|\| '\?message='/);
  assert.match(migration, /alter publication supabase_realtime add table public\.task_discussion_messages/);
  assert.match(migration, /memberships_require_display_name/);
  assert.match(migration, /profiles_protect_active_display_name/);
  assert.match(notificationKinds, /'task_question'/);
  assert.match(notificationKinds, /'task_discussion'/);
  assert.match(board, /className="task-open-link" href=\{taskDeepLink\(task\.id\)\}/);
  assert.match(board, /`طلبها \$\{requester\?\.name/);
  assert.match(detail, /from\("task_discussion_messages"\)\.insert/);
  assert.match(detail, /table: "task_discussion_messages"/);
  assert.match(detail, /اسأل .*طالب المهمة/);
  assert.match(detail, /discussion-\$\{message\.id\}/);
  assert.match(sessionChip, /select\("full_name"\)/);
  assert.match(sessionChip, /const displayName = fullName \?\? email/);
  assert.match(chat, /\.\.\.\(initialMessages \?\? \[\]\)\.map\(\(message\) => message\.author_id\)/);
  assert.match(css, /\.task-open-link/);
  assert.match(css, /\.task-discussion-list/);
  assert.match(types, /task_discussion_messages:/);
});

test("workspace assistant answers personal work from the current account and keeps team context separate", async () => {
  const [migration, memory, indexes, edgeFunction, providerHelpers, component, shell, config] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822171303_team_chat_workspace_assistant.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823025207_workspace_assistant_conversation_memory.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823032808_optimize_assistant_indicator_indexes.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/workspace-assistant/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/ai-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/assistant/WorkspaceAssistant.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /get_workspace_assistant_provider_runtime/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.get_workspace_assistant_provider_runtime[^;]+authenticated/s);
  for (const table of ["assistant_conversations", "assistant_messages"]) {
    assert.match(memory, new RegExp(`create table public\\.${table}`));
    assert.match(memory, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(memory, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(memory, /function public\.get_or_create_assistant_conversation/);
  assert.match(memory, /function public\.append_assistant_exchange/);
  assert.match(memory, /memory_summary = right\(/);
  assert.doesNotMatch(memory, /grant (insert|update|delete) on table public\.assistant_/i);
  assert.match(indexes, /assistant_messages_conversation_owner_idx/);
  assert.match(indexes, /crm_indicator_workflows_contact_org_idx/);
  assert.match(edgeFunction, /createSupabaseContext/);
  assert.match(edgeFunction, /auth: "user"/);
  assert.match(edgeFunction, /allowed_sections/);
  assert.match(edgeFunction, /\.eq\("organization_id", organizationId\)\.eq\("owner_id", actorId\)/);
  assert.match(edgeFunction, /workspaceContext\.my_open_tasks = myOpenTasks/);
  assert.match(edgeFunction, /workspaceContext\.team_open_tasks/);
  assert.match(edgeFunction, /team_open_tasks تُستخدم فقط لما السؤال يطلب صراحة مهام التيم أو الفريق/);
  assert.match(edgeFunction, /personalQuestionIntent\(question\)/);
  assert.match(edgeFunction, /قاعدة المهام · حسابك فقط/);
  assert.match(edgeFunction, /مفيش أي مهمة لعضو تاني داخلة في القائمة دي/);
  assert.match(edgeFunction, /ممنوع اختراع مهمة أو عميل أو موعد أو رابط/);
  assert.match(edgeFunction, /fetchProviderJson/);
  assert.match(edgeFunction, /assistant\.request_started/);
  assert.match(edgeFunction, /get_or_create_assistant_conversation/);
  assert.match(edgeFunction, /append_assistant_exchange/);
  assert.match(edgeFunction, /\.eq\("assigned_to", actorId\)/);
  assert.match(edgeFunction, /collectAllowedLinks/);
  assert.match(edgeFunction, /verifiedAnswerLinks/);
  assert.match(providerHelpers, /Array\.isArray\(message\?\.content\)/);
  assert.doesNotMatch(edgeFunction, /api_key[^]*jsonResponse\(\{ answer/s);
  assert.match(component, /functions\.invoke\("workspace-assistant"/);
  assert.match(component, /from\("assistant_conversations"\)/);
  assert.match(component, /from\("assistant_messages"\)/);
  assert.match(component, /conversation_id/);
  assert.match(component, /assistant-message-links/);
  assert.match(component, /payload\.source\?\.label/);
  assert.match(component, /لا يغيّر أي بيانات/);
  assert.match(shell, /WorkspaceAssistant/);
  assert.match(config, /\[functions\.workspace-assistant\][\s\S]*verify_jwt = true/);
});

test("team workspace contains mobile overflow inside the report instead of floating the whole page", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.team-workspace \{ min-width: 0; max-width: 100%;[^}]+overflow-x: clip/);
  assert.match(css, /\.team-report-table-wrap \{ width: 100%; min-width: 0; max-width: 100%; overflow-x: auto/);
  assert.match(css, /\.team-workspace \.team-range-controls \.segmented-control \{ width: 100%; display: grid/);
  assert.match(css, /\.team-workspace \.presence-grid dl > div \{ align-items: flex-start; flex-direction: column/);
});

test("script studio is private to each assignee, versioned, AI-assisted, and explicitly handed off", async () => {
  const [migration, calibration, stagedAi, captionHandoff, archiveDelete, strictPrivacy, policyGrant, commands, ai, workspace, editor, content, contract, navigation, presence, team, types, config] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260821010000_content_script_studio.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821023326_script_voice_calibration.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821032746_stage_script_ai_and_production_pack.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821122852_carry_selected_caption_to_content.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823023146_script_archive_delete_controls.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823030130_strict_private_scripts_and_self_handoff.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823032533_grant_script_policy_helper_execution.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/script-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/script-ai/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/scripts.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/PresenceReporter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/team/TeamWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);

  for (const table of ["scripts", "script_versions", "script_research_items", "script_voice_profiles"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`));
    assert.match(types, new RegExp(`${table}:`));
  }
  assert.match(migration, /scripts_select_assignee_or_owner/);
  assert.match(migration, /assigned_to = \(select auth\.uid\(\)\)/);
  assert.match(migration, /array\['owner'\]::public\.app_role\[\]/);
  assert.doesNotMatch(migration, /array\['owner', 'admin', 'manager'\].*scripts_select/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table public\.(scripts|script_versions|script_research_items|script_voice_profiles) to authenticated/i);
  for (const rpc of ["create_script_draft", "save_script_draft", "change_script_status", "create_script_from_research", "save_script_voice_profile", "handoff_script_to_content"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
    assert.match(types, new RegExp(`${rpc}:`));
  }
  assert.match(migration, /to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /private\.add_script_version/);
  assert.match(migration, /create_reel_production_workflow_v3/);
  assert.match(migration, /script\.handed_off/);
  assert.match(migration, /script_assigned/);
  assert.match(migration, /script_ready/);
  for (const status of ["draft", "ready_to_record", "handed_off", "archived"]) {
    assert.match(contract, new RegExp(`\\b${status}\\b`));
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(commands, /createSupabaseContext/);
  assert.match(commands, /auth: "user"/);
  assert.match(commands, /handoff_script_to_content/);
  assert.match(commands, /delete_archived_script/);
  assert.match(commands, /body\.action === "delete_script"/);
  assert.match(archiveDelete, /function public\.delete_archived_script/);
  assert.match(strictPrivacy, /script\.assigned_to = \(select auth\.uid\(\)\)/);
  assert.match(strictPrivacy, /target_assigned_to = target_user_id/);
  assert.match(strictPrivacy, /Only the assigned writer can hand off this private script/);
  assert.match(strictPrivacy, /Only the assigned writer can permanently delete this private script/);
  assert.doesNotMatch(strictPrivacy, /private\.is_org_owner_actor\(target_user_id/);
  assert.match(policyGrant, /grant execute on function private\.actor_can_access_any_section\(uuid, uuid, text\[\]\)/);
  assert.match(policyGrant, /to authenticated/);
  assert.match(archiveDelete, /status <> 'archived'/);
  assert.match(archiveDelete, /content_item_id is not null/);
  assert.match(archiveDelete, /script_research_items/);
  assert.match(archiveDelete, /'script\.deleted'/);
  assert.match(archiveDelete, /from public, anon, authenticated/);
  assert.match(archiveDelete, /to service_role/);
  assert.match(types, /delete_archived_script:/);
  assert.match(workspace, /لا يستطيع أي عضو آخر، بما في ذلك مدير المنصة/);
  assert.match(workspace, /كل المطلوب والروابط/);
  assert.match(workspace, /script-request-textarea/);
  assert.match(workspace, /source_url: ""/);
  assert.match(workspace, /scriptForm\.objective\.trim\(\) \|\| requestText\.slice\(0, 1000\)/);
  assert.doesNotMatch(workspace, /<span>مسؤول الاسكريبت<\/span>/);
  assert.match(editor, /assignedWriter/);
  assert.match(ai, /get_script_ai_provider_runtime/);
  assert.match(ai, /openai_responses/);
  assert.match(ai, /response_format/);
  assert.match(ai, /json_schema/);
  assert.match(ai, /store: false/);
  assert.match(ai, /أضف مزوّد AI من الإعدادات/);
  assert.match(ai, /extractCalibratedSamples/);
  assert.match(ai, /selected_story/);
  assert.match(ai, /generation_direction/);
  assert.match(ai, /story_use/);
  assert.match(ai, /السؤال \(ده\|دا\) \(بيوصلني\|بيجيلي\) كتير/);
  assert.match(ai, /filterWritingOutput/);
  assert.match(ai, /generationIssues\(\{ variants: \[variant\], hook_variants: \[\] \}/);
  assert.match(ai, /generationIssues\(\{ hook_variants: \[hook\] \}/);
  assert.match(ai, /مش مجرد.*ده\/دي/);
  assert.match(ai, /script\.ai_request_started/);
  assert.match(ai, /ولم يحفظ شيئًا أو يرسل طلبًا ثانيًا/);
  assert.doesNotMatch(ai, /for \(let attempt|while \(.*provider/i);
  assert.match(ai, /caption_options/);
  assert.match(ai, /thumbnail_options/);
  assert.match(ai, /selectableProductionScopes/);
  assert.match(ai, /const savesProduction = productionScopes\.has\(scope\) && !selectableProductionScopes\.has\(scope\)/);
  assert.doesNotMatch(ai, /providerBody\(provider, mode, aiContext\)/);
  assert.doesNotMatch(ai, /OPENAI_API_KEY|OPENAI_SCRIPT_MODEL/);
  assert.doesNotMatch(ai, /https:\/\/api\.openai\.com/);
  assert.doesNotMatch(ai, /apify|notion/i);
  assert.match(stagedAi, /production_pack_stale/);
  assert.match(stagedAi, /save_ai_script_production/);
  assert.match(stagedAi, /create_script_from_research_variant/);
  assert.match(stagedAi, /get_script_research_ai_context/);
  assert.match(stagedAi, /drop function if exists public\.save_ai_script_generation/);
  assert.match(ai, /script_variants/);
  assert.match(ai, /production_pack/);
  assert.match(ai, /writingScopes/);
  assert.match(workspace, /اختيار وحفظ كاسكريبت/);
  assert.match(workspace, /الفكرة مازالت في مكانها ولم يُنشأ أي اسكريبت/);
  assert.match(workspace, /اسكريبتاتي/);
  assert.match(workspace, /الأفكار والرادار/);
  assert.match(workspace, /بصمتي/);
  assert.match(workspace, /Apify/);
  assert.match(workspace, /حذف نهائي/);
  assert.match(workspace, /window\.confirm/);
  assert.match(workspace, /changeScriptStatus\(script, "archived"\)/);
  assert.match(editor, /إنشاء طلب تنفيذ/);
  assert.match(editor, /حذف نهائي/);
  assert.match(editor, /إما تُنشأ المهام كلها معًا/);
  assert.match(editor, /functions\.invoke/);
  assert.match(editor, /بدون قصة شخصية — الافتراضي/);
  assert.match(editor, /generation_direction/);
  assert.match(editor, /selected_story/);
  assert.match(editor, /اعتمد النص كعينة لصوتي/);
  assert.match(editor, /ولّد 3 بدائل للاسكريبت/);
  assert.match(editor, /الحارس استبعد/);
  assert.match(editor, /3 اقتراحات للغلاف/);
  assert.match(editor, /3 اقتراحات للكابشن/);
  assert.match(editor, /محدد بعلامة صح/);
  assert.match(editor, /لم نعتمد شيئًا تلقائيًا/);
  assert.match(captionHandoff, /add column caption_brief text not null default ''/);
  assert.match(captionHandoff, /content_items_caption_brief_length/);
  assert.match(captionHandoff, /caption_brief = left\(concat_ws/);
  assert.match(captionHandoff, /caption_brief_carried/);
  assert.match(captionHandoff, /to service_role/);
  assert.match(content, /item\.caption_brief/);
  assert.match(content, /محفوظ مع ملف الريلز وسيظهر تلقائيًا لمسؤول النشر/);
  assert.match(types, /caption_brief: string/);
  assert.match(editor, /إنشاء حزمة التنفيذ/);
  assert.match(editor, /CTA جزء من النص النهائي/);
  assert.doesNotMatch(editor, /<span>الدعوة للإجراء CTA<\/span>/);
  assert.match(commands, /approve_voice_sample/);
  assert.match(commands, /approve_script_as_voice_sample/);
  assert.match(calibration, /function public\.approve_script_as_voice_sample/);
  assert.match(calibration, /latest_source is distinct from 'manual_save'/);
  assert.match(calibration, /script_voice\.sample_approved/);
  assert.match(calibration, /from public, anon, authenticated/);
  assert.match(calibration, /to service_role/);
  assert.match(types, /approve_script_as_voice_sample:/);
  assert.match(navigation, /href: "\/scripts"/);
  assert.match(presence, /\["\/scripts", "scripts"\]/);
  assert.match(team, /workspaceSectionDefinitions/);
  assert.match(config, /\[functions\.script-commands\][\s\S]*verify_jwt = true/);
  assert.match(config, /\[functions\.script-ai\][\s\S]*verify_jwt = true/);
});

test("script lifecycle filters use persisted script states and linked production facts", async () => {
  const [workspace, editor, css] = await Promise.all([
    readFile(new URL("../components/scripts/ScriptsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const filter of ["idea", "draft", "ready_to_record", "production", "recorded", "published", "archived"]) {
    assert.match(workspace, new RegExp(`value: "${filter}"`));
  }
  assert.match(workspace, /script\.spoken_script\.trim\(\)\.length < 20 \? "idea" : "draft"/);
  assert.match(workspace, /linkedStep\(tasks, script, "recording"\)\?\.status === "done"/);
  assert.match(workspace, /linkedStep\(tasks, script, "publishing"\)\?\.status === "done"/);
  assert.match(workspace, /aria-pressed=\{statusFilter === filter\.value\}/);
  assert.match(workspace, /changeScriptStatus\(script, "ready_to_record"\)/);
  assert.match(workspace, /expected_edit_version: script\.edit_version/);
  assert.doesNotMatch(workspace, /changeScriptStatus\(script, "(?:recorded|published|handed_off)"\)/);

  assert.match(editor, /الاختيار المعتمد: \$\{option\.label\}/);
  assert.match(editor, /thumbnail_notes: thumbnailOptionText\(option\)/);
  assert.match(editor, /thumbnailInstructionsSaved/);
  assert.match(editor, /تعليمات الغلاف التي ستصل للمصمم/);
  assert.match(editor, /workspace\.script\.thumbnail_notes\.trim\(\)/);
  assert.match(css, /\.script-status-filters button\[aria-pressed="true"\]/);
  assert.match(css, /\.script-variants-grid article\.selected/);
  assert.match(css, /\.script-handoff-cover-summary/);
});

test("AI providers are owner-managed, Vault-backed, testable, and provider-agnostic", async () => {
  const [migration, ambiguityFix, commands, adapter, settings, editor, types, config] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260821012128_ai_provider_registry.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821014515_fix_ai_provider_function_ambiguity.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/ai-provider-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/ai-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/settings/AiProvidersWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.ai_providers/);
  assert.match(migration, /alter table public\.ai_providers enable row level security/);
  assert.match(migration, /ai_providers_select_owner/);
  assert.match(migration, /array\['owner'\]::public\.app_role\[\]/);
  assert.match(migration, /private\.ai_provider_secrets/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /vault\.update_secret/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /resolved_provider_id/);
  assert.match(ambiguityFix, /resolved_provider_id/);
  assert.doesNotMatch(`${migration}\n${ambiguityFix}`, /secret_ref\.provider_id = provider_id\b/);
  assert.doesNotMatch(migration, /grant select on table private\.ai_provider_secrets/);
  for (const rpc of ["save_ai_provider", "set_default_ai_provider", "record_ai_provider_test", "delete_ai_provider", "get_ai_provider_runtime_for_owner", "get_script_ai_provider_runtime"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.match(commands, /auth: "user"/);
  assert.match(commands, /test_provider/);
  assert.match(commands, /get_ai_provider_runtime_for_owner/);
  assert.match(adapter, /https:/);
  assert.match(adapter, /localhost/);
  assert.match(adapter, /Authorization: `Bearer/);
  assert.match(settings, /deepseek-v4-flash/);
  assert.match(settings, /deepseek-v4-pro/);
  assert.match(settings, /https:\/\/api\.deepseek\.com/);
  assert.match(settings, /API مخصص/);
  assert.match(settings, /اتركه فارغًا للاحتفاظ بالمفتاح الحالي/);
  assert.doesNotMatch(settings, /service_role/i);
  assert.match(editor, /بدون قصة شخصية — الافتراضي/);
  assert.match(types, /ai_providers:/);
  assert.match(types, /ai_api_protocol/);
  assert.match(config, /\[functions\.ai-provider-commands\][\s\S]*verify_jwt = true/);
});

test("browser configuration cannot declare a service role variable", async () => {
  const [envExample, client, viteConfig] = await Promise.all([
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(`${envExample}\n${client}`, /NEXT_PUBLIC_[A-Z_]*SERVICE/i);
  assert.match(`${envExample}\n${client}`, /PUBLISHABLE_KEY/);
  assert.match(viteConfig, /loadEnv\(mode, process\.cwd\(\), \["NEXT_PUBLIC_"\]\)/);
  assert.match(viteConfig, /Missing required browser environment/);
});

test("Whales Zone registrations are idempotent, CRM-first, historically importable, and publicly hardened", async () => {
  const [migration, reimportFix, ambiguityFix, splitWorkflow, intake, commands, parser, workspace, landing, types, config] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822191033_whales_zone_lead_intake.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822193056_make_whales_zone_reimport_safe.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822193245_disambiguate_whales_zone_reimport.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823030656_whales_zone_activation_and_sales_routing.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/lead-intake/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/crm-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/crm-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../whales-zone/index.html", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.crm_lead_intake_events/);
  assert.match(migration, /alter table public\.crm_lead_intake_events enable row level security/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /crm_lead_intake_rate_limits/);
  assert.match(migration, /payload_hash <> intake_payload_hash/);
  assert.match(migration, /import_whales_zone_sheet_batch/);
  assert.match(migration, /get_whales_zone_intake_health/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant (insert|update|delete) on table public\.crm_lead_intake_events to authenticated/i);
  assert.match(reimportFix, /existing_intake/);
  assert.match(ambiguityFix, /row_external_id/);
  assert.doesNotMatch(ambiguityFix, /intake\.external_id = external_id\b/);
  assert.match(splitWorkflow, /crm_work_kind/);
  assert.match(splitWorkflow, /tasks_one_open_crm_work_kind_idx/);
  assert.match(splitWorkflow, /create table public\.crm_indicator_workflow_settings/);
  assert.match(splitWorkflow, /create table public\.crm_indicator_workflows/);
  assert.match(splitWorkflow, /intake_event_id uuid primary key/);
  assert.match(splitWorkflow, /عملية تفعيل المؤشر/);
  assert.match(splitWorkflow, /متابعة سيلز/);
  assert.match(splitWorkflow, /on conflict \(intake_event_id\) do nothing/);

  assert.match(intake, /allowedOrigins/);
  assert.match(intake, /company/);
  assert.match(intake, /elapsed < 2_000/);
  assert.match(intake, /ingest_whales_zone_lead/);
  assert.match(intake, /complete_whales_zone_sheet_mirror/);
  assert.match(intake, /sheetMirrorUrl/);
  assert.match(commands, /import_whales_zone_sheet_batch/);
  assert.match(commands, /get_indicator_routing/);
  assert.match(commands, /save_indicator_routing/);
  assert.match(parser, /parseWhalesZoneSheetImport/);
  assert.match(parser, /اليوزرنيم/);
  assert.match(workspace, /Google Sheet · Whales Zone/);
  assert.match(workspace, /get_whales_zone_intake_health/);
  assert.match(workspace, /Whales Zone مرتبط بالـCRM/);
  assert.match(workspace, /مسؤول تفعيل المؤشر/);
  assert.match(workspace, /مسؤول متابعة السيلز/);
  assert.match(workspace, /المتابعة بعد التسجيل/);
  assert.match(landing, /functions\/v1\/lead-intake/);
  assert.match(landing, /await fetch/);
  assert.doesNotMatch(landing, /mode:\s*["']no-cors["']/);
  assert.match(types, /crm_lead_intake_events:/);
  assert.match(types, /get_whales_zone_intake_health:/);
  assert.match(types, /crm_indicator_workflow_settings:/);
  assert.match(types, /crm_indicator_workflows:/);
  assert.match(types, /get_crm_indicator_workflow_settings:/);
  assert.match(types, /save_crm_indicator_workflow_settings:/);
  assert.match(config, /\[functions\.lead-intake\][\s\S]*verify_jwt = false/);
  assert.match(config, /\[functions\.crm-commands\][\s\S]*verify_jwt = true/);
});

test("Supabase client consumes generated database types", async () => {
  const [client, types] = await Promise.all([
    readFile(new URL("../lib/supabase/client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);
  assert.match(client, /createClient<Database>/);
  for (const table of ["audit_events", "brand_articles", "content_assets", "content_brand_references", "content_items", "content_plan_items", "content_plan_pillars", "content_plans", "content_revision_requests", "content_timeline_cues", "crm_activities", "crm_contacts", "crm_conversation_links", "crm_identities", "launch_content_items", "launches", "memberships", "organizations", "profiles", "publishing_channels", "publishing_occurrences", "publishing_publication_logs", "publishing_schedules", "publishing_telegram_assets", "task_dependencies", "tasks", "task_events"]) {
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
    "../components/planning/PlanningWorkspace.tsx",
    "../components/scripts/ScriptsWorkspace.tsx",
    "../components/scripts/ScriptEditor.tsx",
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

test("quarterly planning, readiness, and deadline reminders are database-governed", async () => {
  const [migration, indexes, planning, dashboard, navigation, contentNavigation, presence, types, packageJson] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260821230406_team_readiness_reminders_and_planning.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821232458_content_planning_fk_indexes.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/planning/PlanningWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard/LeadershipDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/ContentSectionNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/PresenceReporter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const table of ["content_plans", "content_plan_pillars", "content_plan_items"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(types, new RegExp(`${table}:`));
  }
  assert.match(migration, /content_plans_one_active_per_org_idx/);
  assert.match(migration, /Planned publish time must be inside the plan period/);
  assert.match(migration, /sync_content_plan_item_from_content/);
  assert.match(migration, /materialize_task_deadline_notifications/);
  assert.match(migration, /market-whales-task-deadline-reminders/);
  assert.match(migration, /count\(\*\).*memberships[\s\S]*> 1/);
  assert.match(migration, /task_due_soon/);
  assert.match(migration, /task_overdue_escalated/);
  assert.match(migration, /function public\.get_workspace_readiness/);
  assert.match(types, /get_workspace_readiness:/);
  for (const index of ["content_plans_creator_idx", "content_plan_pillars_plan_org_idx", "content_plan_items_plan_org_idx", "content_plan_items_pillar_org_idx"]) {
    assert.match(indexes, new RegExp(index));
  }
  assert.match(planning, /لن تُنشأ أي مهام تلقائيًا/);
  assert.match(planning, /إرسال للتنفيذ الآن/);
  assert.match(dashboard, /بوابة حقيقية من البيانات/);
  assert.match(dashboard, /قرار إدخال الفريق يعتمد على البيانات أعلاه/);
  assert.match(dashboard, /تكامل Exness ليس شرطًا/);
  assert.doesNotMatch(navigation, /id: "planning"/);
  assert.match(contentNavigation, /href: "\/planning"/);
  assert.match(presence, /\["\/planning", "planning"\]/);
  assert.match(packageJson, /"lint": "eslint/);
  assert.match(packageJson, /"typecheck": "tsc --noEmit"/);
  assert.match(packageJson, /"test": "pnpm run build/);
});

test("content plans support a real archive and owner-safe permanent deletion", async () => {
  const [migration, planning, assistant, types, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260827011105_content_plan_archive_delete_controls.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/planning/PlanningWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/workspace-assistant/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /archived_at timestamptz/);
  assert.match(migration, /content_plans_delete_owner/);
  assert.match(migration, /array\['owner'\]::public\.app_role\[\]/);
  assert.match(migration, /Archive the content plan before permanently deleting it/);
  assert.match(migration, /A plan linked to execution cannot be permanently deleted/);
  assert.match(migration, /'planning\.plan_deleted'/);
  assert.match(migration, /plan\.status <> 'archived'/);
  assert.match(planning, /الخطط الحالية/);
  assert.match(planning, /الأرشيف/);
  assert.match(planning, /نقل إلى الأرشيف/);
  assert.match(planning, /استرجاع كمسودة/);
  assert.match(planning, /حذف نهائي/);
  assert.match(planning, /window\.confirm/);
  assert.match(assistant, /visiblePlanIds/);
  assert.match(types, /archived_at: string \| null/);
  assert.match(css, /\.planning-archive-empty/);
});

test("content intake accepts generic raw-material web links while legacy Telegram timelines stay readable", async () => {
  const [migration, simpleMigration, rawGateMigration, genericLinksMigration, parser, quickForm, workspace, taskDetail, createCommand, contentCommands, roadmap] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817025228_telegram_smart_content_intake.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260830070000_simplified_content_request_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831015354_enforce_direct_reel_raw_material_gate.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831032124_allow_generic_raw_material_links.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/content-intake.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/QuickIntakeForm.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
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
  assert.match(simpleMigration, /create_simplified_content_workflow_v1/);
  assert.match(simpleMigration, /content\.simplified_request_created/);
  assert.match(simpleMigration, /كل المطلوب والروابط/);
  assert.match(simpleMigration, /create or replace function public\.handoff_script_to_content/);
  assert.match(simpleMigration, /content_id := public\.create_simplified_content_workflow_v1/);
  assert.match(simpleMigration, /'workflow', 'simplified_request_v1'/);
  assert.doesNotMatch(simpleMigration, /create_reel_production_workflow_v3/);
  assert.doesNotMatch(simpleMigration, /'كابشن الريلز:'/);
  assert.match(simpleMigration, /visible_work_task_count.*case when material_is_ready then 3 else 4 end/s);
  assert.match(simpleMigration, /Publishing requires the final caption in the same delivery form/);
  assert.match(simpleMigration, /drop constraint if exists content_items_intake_fields_together/);
  assert.match(simpleMigration, /intake_request_key uuid/);
  assert.match(simpleMigration, /unique \(organization_id, intake_request_key\)/);
  assert.match(simpleMigration, /expected_content_version bigint/);
  assert.match(simpleMigration, /membership\.status = 'active'/);
  assert.match(simpleMigration, /array\['content'\]::text\[\]/);
  assert.match(simpleMigration, /private\.can_read_content_actor/);
  assert.match(simpleMigration, /Only an active non-viewer organization member can submit a result/);
  assert.match(simpleMigration, /Only the assigned step owner can submit its result/);
  assert.doesNotMatch(simpleMigration, /organization leadership can submit its result/);
  assert.match(simpleMigration, /target_url text := '\/tasks\/' \|\| new\.id/);
  assert.match(simpleMigration, /new\.is_work_item and new\.status = 'ready'/);
  assert.match(simpleMigration, /to service_role/);
  assert.match(simpleMigration, /from public, anon, authenticated/);
  assert.match(simpleMigration, /array\['content', 'campaigns', 'scripts', 'tasks'\]/);
  assert.match(simpleMigration, /private\.can_read_task_actor/);
  assert.match(simpleMigration, /create policy "tasks_select_involved_members"/);
  assert.match(simpleMigration, /task_events_select_involved_members/);
  assert.match(simpleMigration, /task_revision_requests_select_involved_members/);
  assert.match(simpleMigration, /task_deliveries_select_involved_members/);
  assert.match(simpleMigration, /task_dependencies_select_involved_members/);
  assert.match(simpleMigration, /membership\.role <> 'viewer'/);
  assert.match(simpleMigration, /reject_viewer_operational_write/);
  for (const table of ["content_items", "content_assets", "content_revision_requests", "content_timeline_cues", "content_brand_references"]) {
    assert.match(simpleMigration, new RegExp(`before insert or update or delete on public\\.${table}`));
  }
  assert.match(simpleMigration, /enforce_task_assignee_reachability/);
  assert.match(simpleMigration, /'tasks' = any\(membership\.allowed_sections\)/);
  assert.match(rawGateMigration, /create_direct_reel_workflow_v2/);
  assert.match(rawGateMigration, /content_has_real_raw_material/);
  assert.match(rawGateMigration, /guard_reel_task_prerequisites/);
  assert.match(rawGateMigration, /jsonb_array_length\(raw_materials\) not between 1 and 10/);
  assert.match(rawGateMigration, /publishing_task_id, editing_task_id/);
  assert.match(rawGateMigration, /publishing_task_id, thumbnail_task_id/);
  assert.match(rawGateMigration, /Recording, editing, thumbnail, design, and publishing steps require a result URL/);
  assert.match(rawGateMigration, /to service_role/);
  assert.match(rawGateMigration, /from public, anon, authenticated/);
  assert.match(genericLinksMigration, /drop constraint if exists content_items_intake_source_url_http/);
  assert.match(genericLinksMigration, /validate constraint content_items_intake_source_url_http/);
  assert.ok(genericLinksMigration.includes("'^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$'"));
  assert.match(genericLinksMigration, /Each raw material needs a valid type and HTTP or HTTPS URL/);
  assert.match(genericLinksMigration, /The optional source must be a valid HTTP or HTTPS URL/);
  assert.match(genericLinksMigration, /from public, anon, authenticated/);
  assert.match(genericLinksMigration, /to service_role/);
  assert.doesNotMatch(genericLinksMigration, /Telegram raw-material links|valid type and Telegram URL/);
  assert.match(quickForm, /كل المطلوب والروابط/);
  assert.match(quickForm, /raw_materials/);
  assert.match(quickForm, /الخطوة \{step \+ 1\} من \{wizardSteps\.length\}/);
  assert.match(quickForm, /فين رابط المادة الخام/);
  assert.match(quickForm, /function isWebUrl/);
  assert.doesNotMatch(quickForm, /function isTelegramUrl|يبدأ بـ https:\/\/t\.me/);
  assert.match(quickForm, /event\.preventDefault\(\); goNext\(\)/);
  assert.match(quickForm, /key="quick-intake-submit"/);
  assert.doesNotMatch(quickForm, /raw_material_sent/);
  assert.match(quickForm, /crypto\.randomUUID/);
  assert.doesNotMatch(quickForm, /content_goal|content_hook|content_cta|content_editing_brief/);
  assert.match(workspace, /طلب ريلز كامل/);
  assert.doesNotMatch(workspace, /طلب كامل من Telegram|إدخال يدوي/);
  assert.match(workspace, /content_timeline_cues/);
  assert.match(taskDetail, /content_items/);
  assert.match(taskDetail, /intake_request/);
  assert.match(taskDetail, /كل المطلوب والروابط/);
  assert.match(taskDetail, /submit_step_delivery/);
  assert.match(taskDetail, /رابط المادة الخام/);
  assert.doesNotMatch(taskDetail, /رابط رسالة المادة الخام على Telegram/);
  assert.doesNotMatch(taskDetail, /confirmTelegramRawHandoff/);
  assert.match(createCommand, /create_direct_reel_workflow_v2/);
  assert.match(createCommand, /directRawMaterials/);
  assert.match(createCommand, /function isWebUrl/);
  assert.match(createCommand, /!isWebUrl\(url\)/);
  assert.match(createCommand, /!isTelegramUrl\(telegramSource\)/);
  assert.match(createCommand, /create_reel_from_intake/);
  assert.match(workspace, /رابط المصدر الأصلي/);
  assert.match(contentCommands, /body\.request_source_url \?\? body\.telegram_source_url/);
  assert.doesNotMatch(contentCommands, /telegram\.me/);
  assert.match(contentCommands, /change_timeline_cue/);
  assert.match(roadmap, /private Supabase Storage buckets/);
  assert.match(roadmap, /does not download, copy, or re-upload Telegram files/);
});

test("planning is a thin calendar over the same canonical request instead of a duplicate production board", async () => {
  const [planning, migration, navigation] = await Promise.all([
    readFile(new URL("../components/planning/PlanningWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260830070000_simplified_content_request_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/ContentSectionNav.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(planning, /كل المطلوب والروابط/);
  assert.match(planning, /هذه الخانة هي المرجع الوحيد/);
  assert.match(planning, /إرسال للتنفيذ الآن/);
  assert.match(planning, /حفظ في التقويم فقط/);
  assert.doesNotMatch(planning, /name="hook_direction"|name="cta"/);
  assert.match(migration, /if target_kind = 'reel' then[\s\S]*create_simplified_content_workflow_v1/);
  assert.match(navigation, /العمل اليومي والتعديل والتسليم داخل «مهامي»/);
  assert.match(navigation, /الخطة والإطلاقات أدوات إدارة وليست مهامًا إضافية على الفريق/);
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
  assert.match(edgeFunction, /create_direct_reel_workflow_v2/);
  assert.match(edgeFunction, /create_reel_production_workflow_v3/);
  assert.match(workspace, /functions\.invoke\("create-content-workflow"/);
  assert.match(workspace, /payload\.raw_materials\.length/);
  assert.match(workspace, /كل المطلوب والروابط/);
  assert.match(workspace, /الكابشن النهائي/);
  assert.match(workspace, /const activeTasks = workTasks\.filter/);
  assert.match(workspace, /التنفيذ والتسليم من صفحة المهمة داخل «مهامي»/);
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
  assert.doesNotMatch(taskWorkspace, /contentRequests\[task\.content_item_id\]/);
  assert.match(taskWorkspace, /task\.content_item_id[\s\S]*transitions\.filter\(\(option\) => \["in_progress", "blocked"\]\.includes\(option\)\)/);
  assert.match(taskWorkspace, /taskDeliveryDeepLink\(task\.id\)/);
  assert.doesNotMatch(taskWorkspace, /task\.content_item_id \? <a className="task-production-link" href=\{`\/content/);
});

test("task board filters remain deterministic and completion-first", async () => {
  const taskWorkspace = await readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8");

  assert.match(taskWorkspace, /task\.completed_at \?\? task\.updated_at/);
  assert.match(taskWorkspace, /boardEntryCompletionTimestamp\(right\) - boardEntryCompletionTimestamp\(left\)/);
  assert.match(taskWorkspace, /طالب المهمة/);
  assert.match(taskWorkspace, /type="date"/);
  assert.match(taskWorkspace, /filter === "all" && !advancedFiltersActive/);
  assert.match(taskWorkspace, /لا توجد مهام مطابقة/);
  assert.match(taskWorkspace, /type TaskCreateStep = 1 \| 2 \| 3/);
  assert.match(taskWorkspace, /اكتب المطلوب مرة واحدة/);
  assert.match(taskWorkspace, /لن تُحفظ أي بيانات قبل ضغط زر الإسناد النهائي/);
  assert.match(taskWorkspace, /deriveTaskTitle/);
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
  assert.match(workspace, /كل المطلوب والروابط/);
  assert.match(commands, /update_content_request_v1/);
  assert.match(workspace, /مركز الأصول/);
  assert.match(workspace, /جولات التعديل/);
  assert.match(workspace, /functions\.invoke\("content-commands"/);
  assert.match(workspace, /taskDeliveryDeepLink/);
  assert.match(workspace, /تم التنفيذ — أضف التسليم/);
  assert.match(workspace, /تم النشر — أضف الرابط/);
  assert.doesNotMatch(workspace, /deliveryFormTaskId|submitStepDelivery/);
  assert.match(taskWorkspace, /تم تنفيذ المهمة — أضف التسليم/);
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
  assert.match(contentWorkspace, /التنفيذ والتسليم من صفحة المهمة داخل «مهامي»/);
  assert.match(contentWorkspace, /كل المطلوب والروابط/);
  assert.match(contentWorkspace, /item\.copy_brief/);
  assert.match(contentWorkspace, /item\.design_brief/);
  assert.doesNotMatch(contentWorkspace, /Social Post Brief/);
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
  assert.match(workspace, /formatPublishingCountdown/);
  assert.match(workspace, /30_000/);
  assert.match(publishingContract, /متبقي على النشر/);
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
  assert.match(contentWorkspace, /approvedBrandArticles/);
  assert.match(contentWorkspace, /مراجع البراند/);
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
  const [migration, contextMigration, scaleMigration, importMigration, importPolicyFix, edgeFunction, workspace, taskWorkspace, contract, importParser, roadmap] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260817033924_crm_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817151104_crm_contact_context_and_chat_links.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817205723_crm_search_multi_identity_owner_performance.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822165632_crm_archive_import_operations.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822184714_fix_crm_import_policy_execution.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/crm-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/crm.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/crm-import.ts", import.meta.url), "utf8"),
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
  assert.match(workspace, /ابحث بالاسم، الهاتف، البريد، TradingView، Telegram/);
  assert.match(workspace, /أداء مسؤولي العملاء/);
  assert.match(workspace, /وسائل التواصل والحسابات — املأ واحدة أو أكثر/);
  assert.match(workspace, /crm-create-dialog-backdrop/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /functions\.invoke\("crm-commands"/);
  assert.match(taskWorkspace, /فتح العميل وتسجيل النتيجة/);
  assert.doesNotMatch(migration, /'متابعة عميل محتمل[^']*'\s*,\s*contact_full_name/);
  assert.match(contract, /allowedCrmTransitions/);
  assert.match(contract, /tradingview/);
  assert.match(importMigration, /create table public\.crm_import_batches/);
  assert.match(importMigration, /create table public\.crm_import_rows/);
  assert.match(importMigration, /enable row level security/);
  assert.match(importMigration, /function public\.search_crm_contacts_v2/);
  assert.match(importMigration, /function public\.import_telegram_indicator_batch/);
  assert.match(importMigration, /function public\.rollback_crm_import_batch/);
  assert.match(importMigration, /contact\.version = imported_row\.contact_version_at_import/);
  assert.match(importPolicyFix, /function private\.can_manage_crm_imports/);
  assert.match(importPolicyFix, /grant execute on function private\.can_manage_crm_imports\(uuid\) to authenticated/);
  assert.match(importPolicyFix, /membership\.role in \('owner', 'admin'\)/);
  assert.match(edgeFunction, /import_telegram_batch/);
  assert.match(workspace, /الأرشيف/);
  assert.match(workspace, /استيراد ومزامنة العملاء/);
  assert.match(workspace, /تحليل ومعاينة/);
  assert.match(workspace, /التراجع الآمن عن الدفعة/);
  assert.match(workspace, /crm_import_batches/);
  assert.match(importParser, /parseTelegramCustomerImport/);
  assert.match(importParser, /أيمن\|ايمن\|ayman\|aiman/);
  assert.match(importParser, /أسماء\|اسماء\|asmaa\|asma/);
  assert.match(importParser, /duplicate_count/);
  assert.match(roadmap, /Telegram scheduled publishing foundation — implemented/);
  assert.match(roadmap, /unique database claim/);
  assert.match(roadmap, /never retried automatically/);
});

test("Exness agency foundation separates owner financial data from Sales lookup", async () => {
  const [migration, edgeFunction, settingsWorkspace, crmWorkspace, roadmap] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822182732_exness_agency_integration_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/broker-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/settings/ExnessIntegrationWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/operating-roadmap.md", import.meta.url), "utf8"),
  ]);

  for (const table of ["broker_integrations", "broker_client_accounts", "broker_sync_runs"]) {
    assert.match(migration, new RegExp(`create table public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`));
    assert.doesNotMatch(migration, new RegExp(`grant (insert|update|delete) on table public\\.${table} to authenticated`, "i"));
  }
  assert.match(migration, /broker_client_accounts_owner_select/);
  assert.match(migration, /membership\.allowed_sections && array\['crm'\]/);
  assert.match(migration, /function public\.lookup_exness_account/);
  assert.match(migration, /grant execute on function public\.lookup_exness_account\(uuid, uuid, text\) to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.lookup_exness_account[^;]+to authenticated/i);
  assert.match(edgeFunction, /createSupabaseContext/);
  assert.match(edgeFunction, /auth: "user"/);
  assert.match(edgeFunction, /context\.supabaseAdmin\.rpc\("lookup_exness_account"/);
  assert.match(settingsWorkspace, /المالك فقط يرى الملف واللوتات والعمولة/);
  assert.match(crmWorkspace, /فحص سريع بدون كشف بيانات الوكالة/);
  assert.match(crmWorkspace, /لا تعتبر الحساب غير موجود قبل إكمال ربط Exness/);
  assert.match(roadmap, /live Exness adapter remains deliberately unconfigured/i);
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
  const [migration, hardening, publishingPresenceFix, selfRevisionFix, selfAssignmentFix, appShell, notificationCenter, presenceReporter, teamWorkspace, teamPage, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260819021613_team_operations_notifications_presence.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260819022259_harden_user_state_commands.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260820235016_allow_publishing_presence.sql", import.meta.url), "utf8"),
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
  assert.match(publishingPresenceFix, /'publishing'/);
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
  assert.match(notificationCenter, /notification-popover/);
  assert.match(notificationCenter, /window\.location\.assign\(notification\.url\)/);
  assert.doesNotMatch(notificationCenter, /useRouter|router\.push/);
  assert.match(presenceReporter, /60_000/);
  assert.match(presenceReporter, /\["\/publishing", "publishing"\]/);
  assert.match(presenceReporter, /addEventListener\("focus"/);
  assert.match(presenceReporter, /addEventListener\("online"/);
  assert.match(teamWorkspace, /أرقام واقعية بلا تقييم شخصي/);
  assert.match(teamWorkspace, /آخر ظهور على المنصة/);
  assert.match(teamWorkspace, /آخر حركة شغل/);
  assert.match(teamWorkspace, /آخر أسبوع/);
  assert.match(teamWorkspace, /آخر 30 يوم/);
  assert.match(teamWorkspace, /مدة محددة/);
  assert.match(teamPage, /دخول واضح، صلاحية محددة/);
});

test("Telegram workflow notifications are private, opt-in, idempotent, and open exact records", async () => {
  const [migration, publisher, webhook, notificationCenter, types, readme] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260829020019_telegram_member_workflow_notifications.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/telegram-publisher/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/telegram-webhook/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/NotificationCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table private\.telegram_notification_outbox/);
  assert.match(migration, /notification_id bigint primary key/);
  assert.match(migration, /after insert on public\.notifications/);
  assert.match(migration, /workflow_notifications_enabled boolean not null default false/);
  assert.match(migration, /connection\.workflow_notifications_enabled/);
  assert.match(migration, /membership\.user_id = connection\.user_id/);
  assert.match(migration, /network_started_at is null/);
  assert.match(migration, /target_terminal_status not in \('sent', 'failed', 'unknown'\)/);
  assert.match(migration, /target_telegram_error_code = 403 then false/);
  assert.match(migration, /on conflict \(notification_id\) do nothing/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /insert into private\.telegram_notification_outbox[\s\S]*select[\s\S]*from public\.notifications/);
  assert.doesNotMatch(migration, /grant .*telegram_notification_outbox.*authenticated/i);

  assert.match(webhook, /notify_\(\[a-f0-9\]\{36\}\)/);
  assert.match(webhook, /complete_member_telegram_link/);
  assert.match(webhook, /chat\?\.type === "private"/);
  assert.match(webhook, /\.eq\("notifications_enabled", true\)/);
  assert.match(publisher, /claim_telegram_notification_batch/);
  assert.match(publisher, /mark_telegram_notification_network_started/);
  assert.match(publisher, /response\.status === 429/);
  assert.match(publisher, /target_terminal_status: "unknown"/);
  assert.match(publisher, /https:\/\/os\.samihagwa\.com/);
  assert.match(publisher, /sendWorkflowNotifications[\s\S]*chat_id: row\.telegram_chat_id/);
  assert.doesNotMatch(publisher, /chat_id:\s*row\.telegram_username/);

  assert.match(notificationCenter, /create_member_telegram_link/);
  assert.match(notificationCenter, /set_member_telegram_workflow_notifications/);
  assert.match(notificationCenter, /teamwhalesbot\?start=notify_/);
  assert.match(notificationCenter, /لن تصلك إشعارات قديمة/);
  assert.match(types, /workflow_notifications_enabled: boolean/);
  assert.match(readme, /Old notifications are not backfilled/);
});

test("task completion and revision resolution produce one durable notification per logical cycle", async () => {
  const [migration, invariant] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260901154447_make_task_completion_notifications_idempotent.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/tests/task_notification_idempotency.sql", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /function private\.task_completion_notification_cycle/);
  assert.match(migration, /'content-revision:' \|\| revision\.id::text/);
  assert.match(migration, /'task-revision:' \|\| revision\.id::text/);
  assert.match(migration, /union all[\s\S]*order by cycle\.requested_at desc/);
  assert.match(migration, /if task_status <> 'done' then/);
  assert.match(migration, /target_action = 'resolve' and revision_record\.status = 'resolved'/);
  assert.match(migration, /new\.status is distinct from old\.status[\s\S]*new\.status = 'done'/);
  assert.match(migration, /:done:cycle:/);
  assert.match(migration, /app\.content_revision_request_id/);
  assert.match(migration, /and not is_content_revision_reopen/);
  assert.doesNotMatch(migration, /:done:v' \|\| new\.version/);
  assert.match(invariant, /UNIQUE \(dedupe_key\)/);
  assert.match(invariant, /PRIMARY KEY \(notification_id\)/);
});

test("content revisions reopen once, notify once, and share their task card read-only", async () => {
  const [migration, invariant, functional] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260901155005_simplify_content_revision_execution.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/tests/content_revision_execution_invariants.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/tests/content_revision_notification_and_shared_task_rls.sql", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /unique index if not exists content_revision_requests_one_open_per_task_idx/);
  assert.match(migration, /function private\.enforce_task_rules\(\)[\s\S]*from public\.content_revision_requests revision/);
  assert.match(migration, /revision\.content_item_id = old\.content_item_id/);
  assert.match(migration, /revision\.stage = old\.content_step/);
  assert.match(migration, /revision\.assigned_to = old\.owner_id/);
  assert.match(migration, /function public\.request_content_revision/);
  assert.match(migration, /clean_instructions is null/);
  assert.match(migration, /app\.content_revision_request_id/);
  assert.match(migration, /delivery\.submitted_at >= revision\.requested_at/);
  assert.match(migration, /function private\.guard_content_approval_revisions[\s\S]*revision\.task_id <> new\.id/);
  assert.match(migration, /function public\.change_content_revision[\s\S]*membership\.status = 'active'/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.change_content_revision[\s\S]*?\n\$\$;/)?.[0] ?? "",
    /update public\.tasks/,
  );
  assert.match(migration, /'revision:' \|\| new\.id \|\| ':requested:user:'/);
  assert.match(migration, /array\['content','tasks'\]::text\[\]/);
  assert.match(migration, /function private\.can_read_shared_content_task_actor/);
  assert.match(migration, /participant_task\.owner_id = target_user_id/);
  assert.match(migration, /participant_task\.status <> 'cancelled'/);
  assert.match(migration, /policy "tasks_select_involved_members"[\s\S]*can_read_shared_content_task_actor/);
  assert.match(invariant, /One-open-content-revision-per-task/);
  assert.match(invariant, /Content RLS was disabled/);
  assert.match(invariant, /delivery\.submitted_at >= revision\.requested_at/);
  assert.match(invariant, /Shared content-card visibility leaked into task execution policy/);
  assert.match(functional, /returned_notification_count <> 0/);
  assert.match(functional, /telegram_outbox_count > 1/);
  assert.match(functional, /Standalone task revision notification behavior changed/);
  assert.match(functional, /set local role authenticated/);
  assert.match(functional, /unauthorized_update_count <> 0/);
});

test("content caption updates are optimistic, involvement-scoped, audited, and retry-safe", async () => {
  const [migration, edge, invariant] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260901154508_add_secure_content_caption_update.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/content-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/tests/content_caption_update_invariants.sql", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /function public\.update_content_caption_v1/);
  assert.match(migration, /item_record\.version <> expected_content_version/);
  assert.match(migration, /item_record\.caption_brief = clean_caption[\s\S]*return item_record\.version/);
  assert.match(migration, /actor_is_requester[\s\S]*actor_is_step_owner[\s\S]*actor_is_content_leadership/);
  assert.match(migration, /task\.owner_id = target_user_id[\s\S]*task\.is_work_item/);
  assert.match(migration, /task\.content_step in \([\s\S]*'publishing'/);
  assert.match(migration, /task\.status <> 'cancelled'/);
  assert.match(migration, /function private\.guard_content_item_write/);
  assert.match(migration, /changed_fields <@ allowed_caption_fields[\s\S]*task\.is_work_item/);
  assert.match(migration, /array\['content'\]::text\[\]/);
  assert.match(migration, /'content\.caption_updated'/);
  assert.match(migration, /'content:' \|\| item_record\.id \|\| ':caption:v'/);
  assert.match(migration, /to service_role/);
  assert.match(edge, /body\.action === "update_content_caption"/);
  assert.match(edge, /rpc\("update_content_caption_v1"/);
  assert.match(edge, /expected_content_version: expectedVersion/);
  assert.match(edge, /changed\|refresh/);
  assert.match(invariant, /retry-idempotent/);
  assert.match(invariant, /task\.is_work_item/);
  assert.match(invariant, /task\.content_step in/);
  assert.match(invariant, /Content item RLS must remain enabled/);
});

test("member Telegram linking verifies usernames, works without publishing access, and supports a durable test", async () => {
  const [migration, notificationCenter, webhook, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260829040000_member_telegram_linking_experience.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/NotificationCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/telegram-webhook/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /workflow_expected_username/);
  assert.match(migration, /\^\[a-z0-9_\]\{5,32\}\$/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /tg_table_name <> 'publishing_admin_connections'/);
  assert.match(migration, /connection\.workflow_expected_username = normalized_username/);
  assert.match(migration, /function public\.send_member_telegram_test_notification/);
  assert.match(migration, /interval '30 seconds'/);
  assert.match(migration, /'telegram_test'/);
  assert.doesNotMatch(migration, /chat_id\s*:=\s*normalized_username/);
  assert.match(notificationCenter, /target_telegram_username: normalizedUsername/);
  assert.match(notificationCenter, /فتح البوت وعمل Start/);
  assert.match(notificationCenter, /send_member_telegram_test_notification/);
  assert.match(notificationCenter, /إرسال اختبار/);
  assert.match(webhook, /نفس @username المكتوب في المنصة/);
  assert.match(types, /workflow_expected_username: string \| null/);
  assert.match(types, /send_member_telegram_test_notification:/);
});

test("reel cover work starts beside editing while publishing keeps all final gates", async () => {
  const [migration, builder, detail, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260829033000_parallel_thumbnail_and_task_resources.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260826020205_rebuild_compact_reel_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /private\.parallelize_reel_thumbnail_dependency/);
  assert.match(migration, /dependent_task\.content_step = 'thumbnail'/);
  assert.match(migration, /prerequisite_task\.content_step = 'editing'/);
  assert.match(migration, /set status = 'ready'/);
  assert.match(migration, /return null/);
  assert.match(migration, /array\['content','tasks'\]::text\[\]/);
  assert.match(builder, /\(publishing_task_id, editing_task_id\)/);
  assert.match(builder, /\(publishing_task_id, thumbnail_task_id\)/);
  assert.match(builder, /\(publishing_task_id, caption_task_id\)/);
  assert.match(detail, /content_assets/);
  assert.match(detail, /content_step_deliveries/);
  assert.match(detail, /شرح المهمة/);
  assert.match(detail, /ملفات وروابط التنفيذ/);
  assert.match(detail, /تسليم هذه المهمة/);
  assert.match(css, /\.task-detail-instructions/);
  assert.match(css, /\.task-resource-list/);
  assert.match(css, /\.task-current-delivery/);
});

test("standalone task deliveries stay visible and editable by the assignee after completion", async () => {
  const [migration, detail, types, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260829050000_general_task_deliveries.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.task_deliveries/);
  assert.match(migration, /constraint task_deliveries_task_unique unique \(task_id\)/);
  assert.match(migration, /function public\.submit_task_delivery/);
  assert.match(migration, /task_record\.owner_id <> actor/);
  assert.match(migration, /task_record\.status = 'cancelled'/);
  assert.doesNotMatch(migration, /task_record\.status = 'done'[\s\S]*raise exception/);
  assert.match(migration, /on conflict \(task_id\) do update/);
  assert.match(migration, /grant execute on function public\.submit_task_delivery\(uuid, text, text\)[\s\S]*to authenticated/);
  assert.match(detail, /\.from\("task_deliveries"\)/);
  assert.match(detail, /rpc\("submit_task_delivery"/);
  assert.match(detail, /رابط ملف التسليم/);
  assert.match(detail, /الخانة تفضل موجودة حتى بعد اكتمال المهمة/);
  assert.match(detail, /const canSubmitDelivery = !readOnly && isAssignee/);
  assert.match(detail, /standaloneTask \|\| contentTask/);
  assert.match(types, /task_deliveries:/);
  assert.match(types, /submit_task_delivery:/);
  assert.match(css, /\.task-delivery-compose/);
});

test("task completion is atomic and board delivery actions cannot bypass the result", async () => {
  const [migration, board, detail, deepLinks] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260830181331_atomic_task_delivery_completion.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskDetailWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/deep-links.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /drop function public\.submit_task_delivery\(uuid, text, text\)/);
  assert.match(migration, /create function public\.submit_task_delivery/);
  assert.match(migration, /insert into public\.task_deliveries[\s\S]*update public\.tasks[\s\S]*set status = completion_status/);
  assert.match(migration, /when task_record\.requires_review then 'review'::public\.task_status[\s\S]*else 'done'::public\.task_status/);
  assert.match(migration, /task_record\.version <> expected_task_version[\s\S]*Task changed since this page was opened/);
  assert.match(migration, /current_delivery_version is distinct from expected_delivery_version[\s\S]*Delivery changed since this page was opened/);
  assert.match(migration, /task_record\.status = 'done' and task_record\.requires_review[\s\S]*approved delivery can only change through a new revision request/);
  assert.match(migration, /set_config\('app\.task_delivery_task_id', task_record\.id::text, true\)/);
  assert.match(migration, /old\.status = 'in_progress' and new\.status in \('review', 'done'\)[\s\S]*raise exception 'Submit the task result before completion'/);
  assert.match(migration, /grant execute on function public\.submit_task_delivery\(uuid, text, text, bigint, bigint\)[\s\S]*to authenticated/);

  assert.match(board, /taskDeliveryDeepLink/);
  assert.match(board, /const directOptions = options\.filter\(\(option\) => !\["review", "done"\]\.includes\(option\)\)/);
  assert.match(board, /<Button href=\{taskDeliveryDeepLink\(task\.id\)\}>/);
  assert.doesNotMatch(board, /changeStatus\(task, task\.requires_review \? "review" : "done"\)/);
  assert.match(detail, /rpc\("submit_task_delivery"/);
  assert.match(detail, /expected_task_version: deliverySnapshot\.taskVersion/);
  assert.match(detail, /expected_delivery_version: deliverySnapshot\.deliveryVersion/);
  assert.match(detail, /deliveryDraftStale/);
  assert.match(detail, /task\.status === "done" && !task\.requires_review/);
  assert.match(detail, /task\.requires_review \? "حفظ وإرسال للمراجعة" : "تسليم وإغلاق المهمة"/);
  assert.match(deepLinks, /export function taskDeliveryDeepLink\(taskId: string\)[\s\S]*\?action=deliver#delivery/);
});

test("weekly task templates are secured and materialize idempotently as ordinary My Work tasks", async () => {
  const [migration, workspace] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260830181350_weekly_task_routines.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.recurring_task_templates/);
  assert.match(migration, /alter table public\.recurring_task_templates enable row level security/);
  for (const policy of ["recurring_task_templates_leadership_select", "recurring_task_templates_leadership_insert", "recurring_task_templates_leadership_update"]) {
    assert.match(migration, new RegExp(`create policy "${policy}"`));
  }
  assert.match(migration, /unique \(recurring_template_id, recurrence_slot_at\)/);
  assert.match(migration, /on conflict \(recurring_template_id, recurrence_slot_at\) do nothing/);
  assert.match(migration, /insert into public\.tasks[\s\S]*estimated_minutes, is_work_item, recurring_template_id/);
  assert.match(migration, /task\.recurring_rule_created/);
  assert.match(migration, /task\.recurring_materialized[\s\S]*generated_automatically/);
  assert.match(migration, /cron\.schedule\([\s\S]*'market-whales-weekly-task-routines'[\s\S]*'17 \* \* \* \*'/);
  assert.match(migration, /Members see only the concrete task occurrences generated from them/);

  assert.match(workspace, /\.eq\("is_work_item", true\)/);
  assert.match(workspace, /\.from\("recurring_task_templates"\)/);
  assert.match(workspace, /rpc\("materialize_recurring_tasks"/);
  assert.match(workspace, /recurring_template_id/);
  assert.match(workspace, /أسبوعية ثابتة/);
  assert.match(workspace, /داخل «مهامي»/);
  assert.match(workspace, /\.eq\("version", template\.version\)[\s\S]*\.select\("id"\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(workspace, /setTaskCreateMode\("weekly"\); setCapacityWarning\(null\)/);
  assert.match(workspace, /resetTaskCreateDraft\(\); setTaskCreateMode\("weekly"\); setShowCreate\(true\)/);
  assert.match(workspace, /setTaskCreateMode\(taskSection === "schedule" \? "weekly" : "once"\)/);
});

test("My Work schedule defaults to a weekly roadmap and keeps month as a secondary view", async () => {
  const [workspace, schedule, types, css] = await Promise.all([
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TaskScheduleCalendar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /type TaskSection = "today" \| "team" \| "schedule" \| "archive"/);
  assert.match(workspace, /<TaskScheduleCalendar organizationId=/);
  assert.match(schedule, /rpc\("get_recurring_task_schedule"/);
  assert.match(schedule, /rpc\("get_team_capacity_calendar"/);
  assert.match(schedule, /timeZone: "Africa\/Cairo"/);
  assert.match(schedule, /projected: !routine\.materialized/);
  assert.match(schedule, /manager \? !ownerId \|\| task\.owner_id === ownerId : task\.owner_id === currentUserId/);
  assert.match(schedule, /entry\.taskId \? <a href=\{taskDeepLink\(entry\.taskId\)\}/);
  assert.doesNotMatch(schedule, /\.(?:insert|update|delete)\(/);
  assert.match(types, /get_recurring_task_schedule:/);
  assert.match(css, /\.task-schedule-grid\.week \{ grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.task-schedule-grid\.week, \.task-schedule-grid\.month \{ grid-template-columns: 1fr;/);
  assert.match(css, /\.task-schedule-grid\.month > article:not\(\.has-work\) \{ display: none;/);
});

test("results workspace reports only evidence-backed internal metrics and labels external data as unconnected", async () => {
  const [page, analytics, types, css] = await Promise.all([
    readFile(new URL("../app/analytics/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/analytics/AnalyticsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<AnalyticsWorkspace \/>/);
  assert.match(analytics, /rpc\("get_operational_analytics"/);
  assert.match(analytics, /\[7, 30, 90\]\.map/);
  assert.match(analytics, /normalizeSnapshot/);
  assert.match(analytics, /Instagram \/ Meta/);
  assert.match(analytics, /غير مربوط/);
  assert.doesNotMatch(analytics, /Math\.random|fetch\(\s*["'`]https?:\/\//);
  assert.match(types, /get_operational_analytics:/);
  assert.match(css, /\.analytics-kpi-grid \{[^}]*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.analytics-kpi-grid, \.analytics-source-status > div:last-child \{ grid-template-columns: 1fr;/);
});

test("task cards remain compact and visually separated without changing the design system", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.kanban-stack \{[^}]*gap: 11px/);
  assert.match(css, /\.task-card \{[^}]*border: 1px solid #b9ccca[^}]*box-shadow: 0 5px 15px/);
  assert.match(css, /\.task-card-top \{[^}]*border-bottom: 1px solid var\(--line\)/);
  assert.match(css, /\.kanban-stack > \.task-card:nth-child\(even\) \{ background: #f8fbfa/);
  assert.match(css, /\.task-card h3 \{[^}]*background: #eef6f4[^}]*font-weight: 950/);
  assert.match(css, /\.task-card::before \{[^}]*inset-inline-start: 0/);
  assert.match(css, /\.content-workflow-subtasks \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(145px, 1fr\)\)/);
  assert.match(css, /\.task-today-board \.kanban-stack, \.task-archive-board \.kanban-stack \{ grid-template-columns: repeat\(2/);
  assert.match(css, /\.task-card\.task-closed h3 \{[^}]*text-decoration: line-through/);
});

test("team onboarding is owner-controlled, email-bound, auditable, and sends nothing automatically", async () => {
  const [migration, commands, teamWorkspace, onboardingGate, appShell, joinWorkspace, joinPage, config, readme] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260821220304_team_onboarding_and_access_control.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/team-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/team/TeamWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/team/MemberOnboardingGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/team/JoinWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/join/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /create table public\.team_invitations/);
  assert.match(migration, /alter table public\.team_invitations enable row level security/);
  assert.match(migration, /team_invitations_select_owner/);
  assert.match(migration, /extensions\.digest\(plain_token, 'sha256'\)/);
  assert.doesNotMatch(migration, /plain_token\s+text[^]*create table public\.team_invitations/i);
  assert.match(migration, /email <> normalized_email/);
  assert.match(migration, /memberships_one_active_organization_per_user_idx/);
  assert.match(migration, /target_role = 'owner'/);
  assert.match(migration, /Reassign or close this member''s open tasks/);
  assert.match(migration, /Reassign or archive this member''s open scripts/);
  assert.match(migration, /team\.invitation_created/);
  assert.match(migration, /team\.invitation_accepted/);
  assert.match(migration, /team\.membership_updated/);
  for (const rpc of ["create_team_invitation", "revoke_team_invitation", "accept_team_invitation", "manage_team_membership", "acknowledge_team_onboarding"]) {
    assert.match(migration, new RegExp(`function public\\.${rpc}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`));
  }
  assert.doesNotMatch(migration, /grant execute on function public\.(create_team_invitation|revoke_team_invitation|accept_team_invitation|manage_team_membership|acknowledge_team_onboarding)[^;]+to authenticated/s);
  assert.match(commands, /createSupabaseContext/);
  assert.match(commands, /auth: "user"/);
  assert.match(commands, /randomToken/);
  assert.doesNotMatch(commands, /inviteUserByEmail|sendMessage|telegram|smtp|await\s+fetch|globalThis\.fetch/i);
  assert.match(teamWorkspace, /تم إنشاء رابط آمن فقط/);
  assert.match(teamWorkspace, /لم نرسل بريدًا أو رسالة لأي شخص/);
  assert.match(teamWorkspace, /إيقاف الوصول/);
  assert.match(teamWorkspace, /3 اتفاقات قبل استلام الشغل/);
  assert.match(onboardingGate, /3 اتفاقات قبل استلام الشغل/);
  assert.match(onboardingGate, /acknowledge_onboarding/);
  assert.match(onboardingGate, /لا يغيّر دورك أو صلاحياتك/);
  assert.match(appShell, /!membership\.onboarding_completed_at/);
  assert.match(appShell, /MemberOnboardingGate/);
  assert.match(joinWorkspace, /request-access-link/);
  assert.match(joinWorkspace, /invitation_token/);
  assert.match(joinWorkspace, /accept_invitation/);
  assert.match(joinWorkspace, /نفس البريد/);
  assert.match(joinPage, /دعوة من المالك/);
  assert.match(config, /\[functions\.team-commands\][\s\S]*verify_jwt = true/);
  assert.match(readme, /never sent automatically|never sends email/i);
});

test("workspace is invite-only, section-scoped, and enforced before rendering or direct API access", async () => {
  const [migration, functionFence, access, shell, navigation, login, join, tasks, loginFunction, teamCommands, teamWorkspace, config, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822012237_invite_only_section_access.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260822014445_section_scope_function_writes.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/access.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/auth/LoginWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/team/JoinWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/request-access-link/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/team-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/team/TeamWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /\.from\("memberships"\)/);
  assert.match(shell, /\.select\("organization_id, role, status, allowed_sections, onboarding_acknowledgements, onboarding_completed_at"\)/);
  assert.match(shell, /if \(!session\) return <LoginWorkspace/);
  assert.match(shell, /\{sectionAllowed\s*\?\s*contentSectionOpen/);
  assert.match(shell, /<SidebarNav allowedSections=\{allowedSections\}/);
  assert.match(navigation, /allowedSections: WorkspaceSection\[\]/);
  assert.match(access, /membership\.role === "owner"/);
  assert.match(access, /membership\.allowed_sections\.includes\(section\)/);
  assert.match(login, /request-access-link/);
  assert.match(login, /أي بريد غير معتمد لن يستلم شيئًا/);
  assert.doesNotMatch(`${login}\n${join}\n${tasks}`, /signInWithOtp/);
  assert.match(loginFunction, /resolve_workspace_login/);
  assert.match(loginFunction, /auth\.signInWithOtp/);
  assert.match(loginFunction, /shouldCreateUser: accessMode === "invitation"/);
  assert.match(loginFunction, /accessMode !== "existing" && accessMode !== "invitation"/);
  assert.match(loginFunction, /allowedOrigins/);
  assert.match(loginFunction, /email_delivery_rate_limited/);
  assert.match(loginFunction, /if \(accessMode === "invitation"\)/);
  assert.match(loginFunction, /prevents a false "email sent" confirmation/);

  assert.match(migration, /add column allowed_sections text\[\]/);
  assert.match(migration, /hook_restrict_market_whales_signup/);
  assert.match(migration, /to supabase_auth_admin/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /resolve_workspace_login/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /samihsmaih1234@gmail\.com/);
  assert.match(migration, /create policy "section_scope_tasks"/);
  assert.match(migration, /create policy "section_scope_scripts"/);
  assert.match(migration, /create policy "section_scope_publishing_schedules"/);
  assert.match(migration, /as restrictive/);
  assert.match(migration, /create_team_invitation_with_sections/);
  assert.match(migration, /manage_team_membership_access/);
  assert.match(functionFence, /guard_publishing_section_write/);
  assert.match(functionFence, /array\['publishing'\]::text\[\]/);
  for (const table of ["publishing_admin_connections", "publishing_channels", "publishing_controls", "publishing_occurrences", "publishing_posts", "publishing_publication_logs", "publishing_schedule_channels", "publishing_schedules", "publishing_telegram_assets"]) {
    assert.match(functionFence, new RegExp(`before insert or update or delete on public\\.${table}`));
  }
  assert.match(functionFence, /array\[target_section\]::text\[\]/);
  assert.match(functionFence, /Workspace section access is required/);
  assert.match(teamCommands, /create_team_invitation_with_sections/);
  assert.match(teamCommands, /manage_team_membership_access/);
  assert.match(teamWorkspace, /الأقسام المسموحة/);
  assert.match(teamWorkspace, /مالك \+ مدير المنصة/);
  assert.match(types, /allowed_sections: string\[\]/);
  assert.match(config, /\[functions\.request-access-link\][\s\S]*verify_jwt = false/);
});

test("team invitations accept any owner-approved valid email including public providers", async () => {
  const [migration, commands] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822015819_fix_team_invitation_email_validation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/team-commands/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /team_invitations_email_normalized/);
  assert.match(migration, /Enter a valid email address/);
  assert.match(migration, /normalized_email !~ '\^\[\^\[:space:\]@\]\+@\[\^\[:space:\]@\]\+\\\.\[\^\[:space:\]@\]\+\$'/);
  assert.match(commands, /Enter a valid email address/);
});

test("content team AI choices remain explicit, version fenced, role scoped, and non-moving", async () => {
  const [migration, aiFunction, commandFunction, workspace, config] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260821132327_content_team_ai_choices_and_research_notifications.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/script-ai/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/content-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/config.toml", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /private\.can_use_content_ai_actor/);
  assert.match(migration, /task\.owner_id = target_user_id/);
  assert.match(migration, /membership\.role in \('owner', 'admin', 'manager'\)/);
  assert.match(migration, /item_record\.version <> expected_content_version/);
  assert.match(migration, /content\.ai_choice_selected/);
  assert.match(migration, /content_brief_updated/);
  assert.match(migration, /get_content_ai_provider_runtime/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.apply_content_ai_choice[^;]+authenticated/s);
  assert.match(aiFunction, /content_id/);
  assert.match(aiFunction, /get_content_ai_context/);
  assert.match(aiFunction, /get_content_ai_provider_runtime/);
  assert.match(aiFunction, /selectableProductionScopes\.has\(scope\)/);
  assert.match(aiFunction, /cta: rawScript\.cta/);
  assert.match(aiFunction, /brand_notes: rawScript\.brand_notes/);
  assert.match(commandFunction, /apply_ai_choice/);
  assert.match(commandFunction, /apply_content_ai_choice/);
  assert.match(workspace, /3 اقتراحات كابشن بالـAI/);
  assert.match(workspace, /3 اقتراحات غلاف/);
  assert.match(workspace, /لا يُحفظ اقتراح قبل اختيارك/);
  assert.match(workspace, /expected_content_version/);
  assert.match(config, /\[functions\.script-ai\][\s\S]*verify_jwt = true/);
  assert.doesNotMatch(migration, /status\s*=\s*'done'/);
});

test("entity links open the exact card across notifications, tasks, revisions, campaigns, chat, and AI", async () => {
  const [migration, taskDetailMigration, deepLinks, tasks, content, crm, scripts, publishing, campaigns, chat, team, assistant] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822233859_canonical_deep_links_and_whales_zone_routing.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260825160911_task_detail_revision_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/deep-links.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/tasks/TasksWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/content/ContentWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/publishing/PublishingWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/campaigns/CampaignsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/chat/ChatWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/team/TeamWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/workspace-assistant/index.ts", import.meta.url), "utf8"),
  ]);

  for (const entity of ["task", "crm_contact", "content_item", "content_revision", "script", "script_research", "publishing_occurrence", "launch", "launch_deliverable", "membership"]) {
    assert.match(migration, new RegExp(`when '${entity}' then`));
  }
  assert.match(migration, /before insert or update of entity_type, entity_id, url on public\.notifications/);
  assert.match(migration, /update public\.notifications notification set url = notification\.url/);
  assert.match(migration, /source_system = 'google_sheet_whales_zone'/);
  assert.match(migration, /follow_up_required = false/);
  assert.match(migration, /crm_lead_routing_members/);
  assert.match(migration, /private\.pick_crm_lead_route/);

  assert.match(taskDetailMigration, /when 'task' then[\s\S]*new\.url := '\/tasks\/' \|\| new\.entity_id/);
  assert.match(deepLinks, /\/tasks\/\$\{id\}/);
  for (const workspace of [tasks, content, crm, scripts, publishing, campaigns, chat, team]) {
    assert.match(workspace, /data-direct-target/);
  }
  assert.match(tasks, /taskDomId\(task\.id\)/);
  assert.match(content, /revision-\$\{revision\.id\}/);
  assert.match(crm, /crm-\$\{contact\.id\}/);
  assert.match(scripts, /research-\$\{item\.id\}/);
  assert.match(publishing, /occurrence-\$\{occurrence\.id\}/);
  assert.match(campaigns, /deliverable-\$\{deliverable\.id\}/);
  assert.match(chat, /message-\$\{message\.id\}/);
  assert.match(team, /member-\$\{person\.id\}/);
  assert.match(assistant, /\/tasks\/\$\{id\}/);
  assert.match(assistant, /دي المهام المفتوحة المسندة مباشرة لحسابك فقط/);
});

test("CRM customer files save communication results atomically and create the next follow-up task", async () => {
  const [migration, edge, workspace, listWorkspace, deepLinks, types] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260823004942_crm_customer_workspace_and_follow_up_atomicity.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/crm-commands/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmCustomerWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/deep-links.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /function public\.record_crm_activity_v2/);
  assert.match(migration, /contact_record\.version <> expected_contact_version/);
  assert.match(migration, /follow_up_required = active_follow_up/);
  assert.match(migration, /insert into public\.crm_activities/);
  assert.match(migration, /insert into public\.tasks/);
  assert.match(migration, /returning id into follow_up_task_id/);
  assert.match(migration, /'crm\.follow_up_recorded'/);
  assert.match(migration, /crm_sales_profiles_select_contact_access/);
  assert.match(migration, /section_scope_crm_sales_profiles/);
  assert.match(migration, /when 'crm_contact' then[\s\S]*'\/crm\/' \|\| new\.entity_id/);

  assert.match(edge, /rpc\("record_crm_activity_v2"/);
  assert.match(edge, /expected_contact_version: expectedVersion/);
  assert.match(edge, /action === "save_sales_profile"/);
  assert.match(edge, /action === "add_conversation_link"/);
  assert.match(workspace, /expected_version: data\.contact\.version/);
  assert.match(workspace, /حفظ النتيجة والمتابعة/);
  assert.match(workspace, /taskDeepLink\(task\.id\)/);
  assert.match(workspace, /ملخص السيلز/);
  assert.match(listWorkspace, /expected_version: contact\.version/);
  assert.match(listWorkspace, /crmContactDeepLink\(contact\.id\)/);
  assert.match(deepLinks, /return `\/crm\/\$\{id\}`/);
  assert.match(types, /crm_sales_profiles:/);
  assert.match(types, /record_crm_activity_v2:/);
});

test("CRM customer directory keeps every source filter permission-scoped and links exact records", async () => {
  const [migration, directoryMigration, directory, page, nav, crmContract, types, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260823014440_crm_customer_directory_sources.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831134800_crm_sales_directory_and_schedule.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmCustomerDirectory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/crm/customers/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/crm/CrmSectionNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/crm.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/database.types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const source of ["market_whales_dashboard", "harmonic_book", "facebook", "whatsapp", "email"]) {
    assert.match(migration, new RegExp(`'${source}'`));
  }
  for (const source of ["market_whales_dashboard", "market_whales_app", "harmonic_book", "facebook", "whatsapp", "email"]) {
    assert.match(crmContract, new RegExp(`${source}:`));
    assert.match(types, new RegExp(`"${source}"`));
  }
  assert.match(migration, /function public\.search_crm_contacts_v3/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /target_source is null or contact\.source = target_source/);
  assert.match(migration, /target_view = 'all'/);
  assert.match(migration, /grant execute on function public\.search_crm_contacts_v3[\s\S]*to authenticated/);
  assert.match(directoryMigration, /function public\.search_crm_contacts_v4/);
  assert.match(directoryMigration, /target_interest is null or contact\.interest = target_interest/);
  assert.match(directoryMigration, /result_limit is null or result_offset is null/);
  assert.match(directoryMigration, /grant execute on function public\.search_crm_contacts_v4[\s\S]*to authenticated/);
  assert.match(directory, /rpc\("search_crm_contacts_v4"/);
  assert.match(directory, /const PAGE_SIZE = 25/);
  assert.match(directory, /crmContactDeepLink\(contact\.id\)/);
  assert.match(directory, /taskDeepLink\(openTask\.id\)/);
  assert.match(directory, /crmSourceConfig\[contact\.source\]\.label/);
  assert.match(page, /دليل موحّد لكل العملاء/);
  assert.match(nav, /href: "\/crm\/customers"/);
  assert.match(css, /\.crm-directory-table-wrap \{[^}]+overflow: auto/);
});

test("production reset starts clean while preserving scripts, customers, publishing, and team access", async () => {
  const [reset, crmMigration, edge] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260831134801_production_operational_reset.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260831134800_crm_sales_directory_and_schedule.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/crm-commands/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reset, /reset_cutoff constant timestamptz/);
  assert.match(reset, /task_count_before <> 64/);
  assert.match(reset, /historical_reclassified <> 115/);
  assert.match(reset, /A protected data set changed during the reset/);
  assert.match(reset, /system\.production_operational_reset/);
  assert.match(reset, /linked_script_content_archived/);
  assert.match(crmMigration, /from public\.crm_lead_routing_members route/);
  assert.match(crmMigration, /activity\.actor_id as owner_id/);
  assert.match(crmMigration, /task\.crm_work_kind = 'follow_up'/);
  assert.match(crmMigration, /save_crm_sales_setup/);
  assert.match(edge, /action === "save_sales_setup"/);
  assert.match(edge, /membership\.role !== "owner" && !sections\.includes\("crm"\)/);
});
