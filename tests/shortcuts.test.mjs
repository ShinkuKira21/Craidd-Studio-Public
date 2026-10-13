import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/shortcuts.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
const { SHORTCUTS, matchShortcut, isChordPrefix, focusAreaOf } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, ...mods });

test("debug keys map to the Visual Studio layout", () => {
  assert.equal(matchShortcut(key("F5"), "other"), "debugOrContinue");
  assert.equal(matchShortcut(key("F5", { ctrlKey: true }), "other"), "run");
  assert.equal(matchShortcut(key("F5", { shiftKey: true }), "other"), "stop");
  assert.equal(matchShortcut(key("F6"), "editor"), "pause");
  assert.equal(matchShortcut(key("F10"), "editor"), "stepOver");
  assert.equal(matchShortcut(key("F11"), "editor"), "stepInto");
  assert.equal(matchShortcut(key("F11", { shiftKey: true }), "editor"), "stepOut");
  assert.equal(matchShortcut(key("F9"), "editor"), "toggleBreakpoint");
});

test("Ctrl+Shift+F5 no longer starts Run", () => {
  assert.equal(matchShortcut(key("F5", { ctrlKey: true, shiftKey: true }), "other"), null);
});

test("held keys do not start a second action, but steps repeat", () => {
  assert.equal(matchShortcut(key("F5", { repeat: true }), "other"), null);
  assert.equal(matchShortcut(key("b", { ctrlKey: true, shiftKey: true, repeat: true }), "other"), null);
  assert.equal(matchShortcut(key("F10", { repeat: true }), "editor"), "stepOver");
});

test("typing in a dialog field keeps its own editing keys", () => {
  for (const k of [key("F2"), key("w", { ctrlKey: true }), key("b", { ctrlKey: true }), key("j", { ctrlKey: true }), key("z", { altKey: true }), key("F9")]) {
    assert.equal(matchShortcut(k, "text"), null, k.key);
  }
  assert.equal(matchShortcut(key("s", { ctrlKey: true }), "text"), "save");
  assert.equal(matchShortcut(key("F5"), "text"), "debugOrContinue");
});

test("F2 and Ctrl+Shift+O belong to Monaco inside the editor", () => {
  assert.equal(matchShortcut(key("F2"), "editor"), null);
  assert.equal(matchShortcut(key("F2"), "other"), "rename");
  assert.equal(matchShortcut(key("O", { ctrlKey: true, shiftKey: true }), "editor"), null);
  assert.equal(matchShortcut(key("O", { ctrlKey: true, shiftKey: true }), "other"), "openSolution");
});

test("Ctrl+K Ctrl+O opens a folder only as a chord", () => {
  assert.ok(isChordPrefix(key("k", { ctrlKey: true })));
  assert.equal(matchShortcut(key("o", { ctrlKey: true }), "editor", true), "openFolder");
  assert.equal(matchShortcut(key("o", { ctrlKey: true }), "editor", false), null);
  assert.equal(matchShortcut(key("s", { ctrlKey: true }), "editor", true), null);
});

test("each key resolves to at most one shortcut", () => {
  const probes = ["F2", "F5", "F6", "F9", "F10", "F11", "b", "j", "o", "p", "q", "s", "w", "z", "=", "-", "0", ","];
  const combos = [{}, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }];
  for (const k of probes) for (const mods of combos) {
    const hits = SHORTCUTS.filter((item) => !item.labelOnly && !item.chord && item.match(key(k, mods)));
    assert.ok(hits.length <= 1, `${JSON.stringify(mods)}+${k}: ${hits.map((h) => h.id).join(", ")}`);
  }
});

test("the menu shows only labels from the shortcut table", async () => {
  const menu = await readFile(new URL("../src/components/menu/MenuBar.tsx", import.meta.url), "utf8");
  assert.deepEqual([...menu.matchAll(/shortcut:\s*"([^"]+)"/g)].map((m) => m[1]), []);
  const ids = new Set(SHORTCUTS.map((item) => item.id));
  for (const [, id] of menu.matchAll(/shortcut:\s*key\("([^"]+)"\)/g)) assert.ok(ids.has(id), id);
});

test("Monaco's textarea counts as the editor", () => {
  const el = (tag, inMonaco) => ({ tagName: tag, isContentEditable: false, closest: (sel) => (sel === ".monaco-editor" && inMonaco ? {} : null) });
  assert.equal(focusAreaOf(el("TEXTAREA", true)), "editor");
  assert.equal(focusAreaOf(el("INPUT", false)), "text");
  assert.equal(focusAreaOf(el("DIV", false)), "other");
  assert.equal(focusAreaOf(null), "other");
});
