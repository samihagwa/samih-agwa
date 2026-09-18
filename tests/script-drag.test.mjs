import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../components/scripts/useScriptBoardDrag.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/import[^;]+from "react";/, "const useRef = (value) => ({current:value}); const useState = (value) => [value,()=>{}]; const useEffect = () => {};");
const { useScriptBoardDrag: createDragUnit } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
function harness({ touch = false, handle = false, destination = "draft", allowed = true } = {}) {
  const moves = []; const captures = [];
  const column = { dataset: { stage: destination } };
  const board = { current: { contains: (value) => value === column } };
  globalThis.document = { elementFromPoint: () => ({ closest: () => column }) };
  const drag = createDragUnit(board, () => allowed, (item, stage) => moves.push([item.id, stage]));
  const event = (x) => ({ isPrimary: true, button: 0, pointerId: 1, pointerType: touch ? "touch" : "mouse", clientX: x, clientY: 120, preventDefault() {}, currentTarget: { setPointerCapture: (id) => captures.push(id) }, target: { closest: (selector) => selector === ".script-drag-handle" && handle ? {} : null } });
  return { drag, moves, captures, event };
}
test("mouse body drag captures pointer, commits once and suppresses accidental navigation", () => {
  const h = harness(); h.drag.start(h.event(100), { id: "s1", title: "Test" }); h.drag.move(h.event(160)); h.drag.end(h.event(160)); h.drag.end(h.event(160));
  assert.deepEqual(h.moves, [["s1", "draft"]]); assert.deepEqual(h.captures, [1]); assert.equal(h.drag.suppressClick(), true);
});
test("touch drag from handle commits, while touch on body keeps native scrolling", () => {
  for (const handle of [false, true]) {
    const h = harness({ touch: true, handle }); h.drag.start(h.event(100), { id: "s1", title: "Test" }); h.drag.move(h.event(160)); h.drag.end(h.event(160));
    assert.equal(h.moves.length, handle ? 1 : 0);
  }
});
test("tap does not move a script or suppress normal opening", () => {
  const h = harness(); h.drag.start(h.event(100), { id: "s1", title: "Test" }); h.drag.move(h.event(103)); h.drag.end(h.event(103));
  assert.equal(h.moves.length, 0); assert.equal(h.drag.suppressClick(), false);
});
test("cancelled or unauthorized drops never change status", () => {
  for (const allowed of [true, false]) {
    const h = harness({ allowed }); h.drag.start(h.event(100), { id: "s1", title: "Test" }); h.drag.move(h.event(160));
    if (allowed) h.drag.cancel(); else h.drag.end(h.event(160));
    assert.equal(h.moves.length, 0);
  }
});
