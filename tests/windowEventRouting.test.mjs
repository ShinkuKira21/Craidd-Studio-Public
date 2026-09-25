import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("per-window runtime and linked events use WebviewWindow-scoped listeners", async () => {
  const [build, debug, linked] = await Promise.all([
    read("../src/store/buildStore.ts"),
    read("../src/store/debugStore.ts"),
    read("../src/store/linkedWindowsStore.ts"),
  ]);

  assert.match(build, /getCurrentWebviewWindow\(\)\.listen<BuildEvent>/);
  assert.match(debug, /getCurrentWebviewWindow\(\)\.listen<DebugEvent>/);
  assert.match(linked, /currentWindow\.listen<LinkedSnapshot>/);
  assert.match(linked, /currentWindow\.listen<\{ kind: "start" \| "stop"/);

  assert.doesNotMatch(build, /@tauri-apps\/api\/event/);
  assert.doesNotMatch(debug, /@tauri-apps\/api\/event/);
  assert.doesNotMatch(linked, /\{ listen, emitTo \}/);
});

test("dirty close flows select a prompt target and close the initiator last", async () => {
  const manager = await read("../src/components/layout/WindowManager.tsx");

  assert.equal((manager.match(/await promptNext\(/g) ?? []).length, 5);
  assert.match(manager, /Number\(a === args\.initiator\) - Number\(b === args\.initiator\)/);
  assert.doesNotMatch(manager, /Number\(b === args\.initiator\) - Number\(a === args\.initiator\)/);
});
