import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/windowAttention.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { windowAttention } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const member = (windowLabel, status, failureMessage = null) => ({ windowLabel, status, failureMessage, restoring: false });

test("independent linked windows retain their own paused and error attention", () => {
  const windows = [member("server", "running"), member("client-a", "running"),
    member("client-b", "paused"), member("client-c", "failed", "Native process crashed"),
    member("client-d", "paused")];
  assert.deepEqual(windows.map((item) => windowAttention(item, [])), [null, null, "paused", "error", "paused"]);
});

test("a compiler problem is red, and an observed pause without errors is yellow", () => {
  const native = member("native", "paused");
  const problems = [{ windowLabel: "native", severity: "error" }];
  assert.equal(windowAttention(native, problems), "error");
  assert.equal(windowAttention(native, []), "paused");
  assert.equal(windowAttention({ ...native, restoring: true }, []), null);
});
