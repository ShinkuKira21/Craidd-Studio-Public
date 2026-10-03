import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/duplicateWindowPolicy.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
const { shouldShowDuplicate } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("ordinary duplication shows only while below the visible-window limit", () => {
  assert.equal(shouldShowDuplicate("limit", 1, 3), true);
  assert.equal(shouldShowDuplicate("limit", 2, 3), true);
  assert.equal(shouldShowDuplicate("limit", 3, 3), false);
  assert.equal(shouldShowDuplicate("limit", 8, 8), false);
});

test("explicit show and hide choices override the visible-window count", () => {
  assert.equal(shouldShowDuplicate("show", 8, 3), true);
  assert.equal(shouldShowDuplicate("hide-and-view", 1, 3), false);
});
