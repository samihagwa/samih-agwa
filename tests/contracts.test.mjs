import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared navigation covers every primary route", async () => {
  const source = await readFile(new URL("../components/layout/SidebarNav.tsx", import.meta.url), "utf8");
  for (const route of ["/tasks", "/content", "/campaigns", "/crm", "/analytics", "/team", "/settings"]) {
    assert.match(source, new RegExp(`href(?::|=)\\s*["']${route}`));
  }
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
  for (const table of ["audit_events", "content_items", "memberships", "organizations", "profiles", "task_dependencies", "tasks", "task_events"]) {
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
