import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared navigation covers every primary route", async () => {
  const source = await readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8");
  for (const route of ["/tasks", "/content", "/campaigns", "/crm", "/analytics", "/team", "/settings"]) {
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
  for (const table of ["audit_events", "content_items", "launch_content_items", "launches", "memberships", "organizations", "profiles", "task_dependencies", "tasks", "task_events"]) {
    assert.match(types, new RegExp(`${table}:`));
  }
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

test("application shell does not impersonate an authenticated owner", async () => {
  const source = await readFile(new URL("../components/layout/AppShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /سميح عجوة/);
  assert.match(source, /SessionChip/);
});

test("launch workflow uses guarded gates, shared tasks, and reversible content links", async () => {
  const [launchContract, migration, detachMigration, targetMigration, edgeFunction, workspace, taskWorkspace, indexMigration] = await Promise.all([
    readFile(new URL("../lib/launches.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817002626_campaign_launch_pipeline.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817003302_campaign_launch_detach_content.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260817004019_campaign_launch_positive_target.sql", import.meta.url), "utf8"),
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
  assert.match(edgeFunction, /createSupabaseContext/);
  assert.match(edgeFunction, /auth: "user"/);
  assert.match(edgeFunction, /attach_content/);
  assert.match(edgeFunction, /detach_content/);
  assert.match(workspace, /functions\.invoke\("launch-commands"/);
  assert.match(workspace, /8 بوابات مترابطة/);
  assert.match(workspace, /الفعلي غير مربوط بعد/);
  assert.match(taskWorkspace, /launchGateConfig/);
});
