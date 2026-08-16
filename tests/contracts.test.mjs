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
  for (const table of ["audit_events", "memberships", "organizations", "profiles"]) {
    assert.match(types, new RegExp(`${table}:`));
  }
});
