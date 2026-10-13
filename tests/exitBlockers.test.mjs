import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/exitBlockers.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
const { planExit, unregisteredBlocker } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const probe = (label, extra = {}) => ({ label, name: `${label}: CS1`, restoring: false, dirty: 0, ...extra });

test("clean windows exit with no prompt", () => {
  assert.deepEqual(planExit([probe("A"), probe("B")]), { queue: [], blockers: [] });
});

test("unsaved files are queued for Save All, not blockers", () => {
  assert.deepEqual(planExit([probe("A", { dirty: 2 }), probe("B")]), { queue: ["A"], blockers: [] });
});

test("stale opening and unresponsive windows become named blockers", () => {
  const plan = planExit([probe("A", { restoring: true, dirty: 4 }), probe("B", { dirty: null, error: "The IDE window did not respond" }), probe("C", { dirty: 1 })]);
  assert.deepEqual(plan.queue, ["C"]);
  assert.deepEqual(plan.blockers, ["A: CS1 is still opening.", "B: CS1 did not respond (The IDE window did not respond)."]);
});

test("an unregistered window blocks only when it has unsaved tabs", () => {
  assert.equal(unregisteredBlocker(0), null);
  assert.match(unregisteredBlocker(1), /1 unsaved file and is not registered/);
});
