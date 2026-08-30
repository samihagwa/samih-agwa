import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("viewers are read-only in scripts and workflow assignees must have Tasks access", async () => {
  const [migration, workspace, editor, planning] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260830162703_enforce_viewer_read_only_scripts.sql", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/planning/PlanningWorkspace.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(migration, /membership\.role <> 'viewer'/);
  assert.match(migration, /membership\.allowed_sections && array\['scripts'\]::text\[\]/);
  assert.match(migration, /revoke all on function private\.is_active_script_actor/);

  assert.match(workspace, /canWriteScripts = Boolean\(workspace && workspace\.membership\.role !== "viewer"\)/);
  assert.match(workspace, /readOnly=!canWriteScripts|readOnly=\{!canWriteScripts\}/);
  assert.match(editor, /canWriteScript = assignedWriter && workspace\?\.membership\.role !== "viewer"/);
  assert.match(editor, /person\.role !== "viewer" && \(person\.role === "owner" \|\| person\.allowedSections\.includes\("tasks"\)\)/);
  assert.match(editor, /assignablePeople\.map/);

  assert.match(planning, /select\("user_id, role, allowed_sections"\)/);
  assert.match(planning, /row\.role !== "viewer" && \(row\.role === "owner" \|\| row\.allowed_sections\.includes\("tasks"\)\)/);
  assert.match(planning, /اختر عضوًا نشطًا لديه صلاحية المهام لكل مسؤولية/);
});
