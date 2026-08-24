import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared navigation covers every primary route", async () => {
  const source = await readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8");
  for (const route of ["/tasks", "/content", "/planning", "/scripts", "/publishing", "/brand", "/campaigns", "/crm", "/analytics", "/chat", "/team", "/settings"]) {
    assert.match(source, new RegExp(`href(?::|=)\\s*["']${route}`));
  }
});

test("internal navigation remains usable when the experimental client router fails", async () => {
  const sources = await Promise.all([
    "../app/page.tsx",
    "../components/layout/SidebarNav.tsx",
    "../components/ui/Button.tsx",
    "../components/content/ContentWorkspace.tsx",
    "../components/planning/PlanningWorkspace.tsx",
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
  assert.match(editor, /const readOnly = !assignedWriter/);

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
  assert.match(editor, /تسليم لمصنع المحتوى/);
  assert.match(editor, /حذف نهائي/);
  assert.match(editor, /إما تُنشأ كل المهام معًا/);
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
  assert.match(content, /مسودة مختارة من استوديو الاسكريبتات/);
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
  const [migration, indexes, planning, dashboard, navigation, presence, types, packageJson] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260821230406_team_readiness_reminders_and_planning.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260821232458_content_planning_fk_indexes.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/planning/PlanningWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard/LeadershipDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8"),
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
  assert.match(planning, /ربط بمصنع المحتوى/);
  assert.match(dashboard, /بوابة حقيقية من البيانات/);
  assert.match(dashboard, /قرار إدخال الفريق يعتمد على البيانات أعلاه/);
  assert.match(dashboard, /تكامل Exness ليس شرطًا/);
  assert.match(navigation, /href: "\/planning"/);
  assert.match(presence, /\["\/planning", "planning"\]/);
  assert.match(packageJson, /"lint": "eslint/);
  assert.match(packageJson, /"typecheck": "tsc --noEmit"/);
  assert.match(packageJson, /"test": "pnpm run build/);
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
  assert.match(taskWorkspace, /فتح ملف العميل وتسجيل النتيجة/);
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
  assert.match(shell, /sectionAllowed \? children/);
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
  const [migration, deepLinks, tasks, content, crm, scripts, publishing, campaigns, chat, team, assistant] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260822233859_canonical_deep_links_and_whales_zone_routing.sql", import.meta.url), "utf8"),
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

  assert.match(deepLinks, /\/tasks\?task=\$\{id\}#task-\$\{id\}/);
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
  assert.match(assistant, /\/tasks\?task=\$\{id\}#task-\$\{id\}/);
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
  const [migration, directory, page, nav, crmContract, types, css] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260823014440_crm_customer_directory_sources.sql", import.meta.url), "utf8"),
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
  assert.match(directory, /rpc\("search_crm_contacts_v3"/);
  assert.match(directory, /crmContactDeepLink\(contact\.id\)/);
  assert.match(directory, /taskDeepLink\(openTask\.id\)/);
  assert.match(directory, /crmSourceConfig\[contact\.source\]\.label/);
  assert.match(page, /دليل موحّد لكل العملاء/);
  assert.match(nav, /href: "\/crm\/customers"/);
  assert.match(css, /\.crm-directory-table-wrap \{[^}]+overflow: auto/);
});
