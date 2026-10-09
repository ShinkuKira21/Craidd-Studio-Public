import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/pathActions.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
const { relativePath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("Copy Relative Path is relative to the solution or folder root", () => {
  assert.equal(relativePath("/lab", "/lab/src/main.rs"), "src/main.rs");
  assert.equal(relativePath("/lab/", "/lab/src"), "src");
  assert.equal(relativePath("/lab", "/lab"), ".");
});

test("paths outside the root, or with no root, stay absolute", () => {
  assert.equal(relativePath("/lab", "/laboratory/x"), "/laboratory/x");
  assert.equal(relativePath("/lab", "/other/x"), "/other/x");
  assert.equal(relativePath(null, "/other/x"), "/other/x");
});
