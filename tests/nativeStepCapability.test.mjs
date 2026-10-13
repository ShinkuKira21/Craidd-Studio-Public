import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = await readFile(new URL("../src/store/debugStore.ts", import.meta.url), "utf8");
let { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
const listener = { callback: null, calls: [] };
const modules = {
  zustand: import.meta.resolve("zustand"),
  "../lib/debugSource": url("export async function revealDebugSource() {}"),
  "./breakpointStore": url("export const useBreakpoints={getState:()=>({points:[]})};"),
  "./solutionStore": url("export const useSolution={getState:()=>({clnPath:null})};"),
  "../lib/outputPresentation": url("export const appendOutput=(before,text)=>before+text;"),
  "@tauri-apps/api/core": url("export async function invoke(command,args){globalThis.__nativeStepListener.calls.push({command,args});}"),
  "@tauri-apps/api/webviewWindow": url("export function getCurrentWebviewWindow(){return {listen:async (_name,callback)=>{globalThis.__nativeStepListener.callback=callback;return ()=>{globalThis.__nativeStepListener.callback=null;};}};}"),
};
globalThis.__nativeStepListener = listener;
for (const [name, replacement] of Object.entries(modules)) {
  outputText = outputText.replaceAll(JSON.stringify(name), JSON.stringify(replacement));
}
const { useDebug, listenToDebug } = await import(url(outputText));

test("native capability remains in the same session across LLDB's later starting update", async () => {
  listener.calls.length = 0;
  const unlisten = await listenToDebug();
  const emit = (payload) => listener.callback({ payload });
  const sessionKey = "28030:100";
  emit({ status: "building" });
  emit({ status: "starting" });
  emit({ status: "capabilities", sessionKey, nativeSingleStep: true });
  assert.equal(useDebug.getState().nativeSingleStepSessionKey, sessionKey);
  emit({ status: "starting", text: "Debugger connected; waiting for native execution" });
  emit({ status: "threads", sessionKey, threads: [], allThreadsStopped: false });
  emit({ status: "threads", sessionKey, threads: [{ id: 123, name: "rust step 1", state: "paused", incarnation: 1 }],
    stale: false, allThreadsStopped: true });
  emit({ status: "paused", reason: "breakpoint", threadId: 123 });
  emit({ status: "inspection", sessionKey, threadId: 123, selectionEpoch: 0,
    frames: [{ id: 1, name: "worker", line: 21, source: { path: "/lab/main.rs" }, craiddSourceAvailable: true }] });
  assert.equal(useDebug.getState().threadSessionKey, sessionKey);
  assert.equal(useDebug.getState().nativeSingleStepSessionKey, sessionKey);
  assert.equal(useDebug.getState().allThreadsStopped, true);
  await useDebug.getState().stepNativeThreadOnly();
  assert.deepEqual(listener.calls, [{ command: "debug_step_native_thread_only",
    args: { sessionKey, threadId: 123, incarnation: 1 } }]);
  emit({ status: "terminated" });
  assert.equal(useDebug.getState().nativeSingleStepSessionKey, null);
  unlisten();
});

test("managed experiment capability survives startup and dispatches its own thread step", async () => {
  listener.calls.length = 0;
  const unlisten = await listenToDebug();
  const emit = (payload) => listener.callback({ payload });
  const sessionKey = "28031:101";
  emit({ status: "building" });
  emit({ status: "starting" });
  emit({ status: "capabilities", sessionKey, language: "csharp", nativeSingleStep: false,
    exclusiveNext: true, exclusiveMethod: "experimentalManaged" });
  emit({ status: "starting", text: "Debugger connected" });
  emit({ status: "threads", sessionKey, threads: [{ id: 30192, name: "exclusive worker 2", state: "paused", incarnation: 2 }],
    stale: false, allThreadsStopped: true });
  emit({ status: "paused", reason: "breakpoint", threadId: 30192 });
  emit({ status: "inspection", sessionKey, threadId: 30192, selectionEpoch: 0,
    frames: [{ id: 2, name: "worker", line: 21, source: { path: "/lab/Program.cs" }, craiddSourceAvailable: true }] });
  assert.equal(useDebug.getState().exclusiveNextSessionKey, sessionKey);
  assert.equal(useDebug.getState().nativeSingleStepSessionKey, null);
  await useDebug.getState().stepThreadOnly();
  assert.deepEqual(listener.calls, [{ command: "debug_step_thread_only",
    args: { sessionKey, threadId: 30192, incarnation: 2 } }]);
  emit({ status: "terminated" });
  assert.equal(useDebug.getState().exclusiveNextSessionKey, null);
  unlisten();
});

test("a debugger-generated libc location is not a source step target", async () => {
  listener.calls.length = 0;
  const unlisten = await listenToDebug();
  const emit = (payload) => listener.callback({ payload });
  const sessionKey = "28032:102";
  emit({ status: "building" });
  emit({ status: "capabilities", sessionKey, nativeSingleStep: true });
  emit({ status: "threads", sessionKey, threads: [{ id: 441, name: "main", state: "paused", incarnation: 1 }],
    stale: false, allThreadsStopped: true });
  emit({ status: "paused", reason: "breakpoint", threadId: 441 });
  emit({ status: "inspection", sessionKey, threadId: 441, selectionEpoch: 0,
    frames: [{ id: 3, name: "libc.so.6`syscall", line: 15,
      source: { path: "/usr/lib/libc.so.6" }, craiddSourceAvailable: false }] });
  await assert.rejects(useDebug.getState().stepNativeThreadOnly(), /source line/);
  assert.deepEqual(listener.calls, []);
  unlisten();
});
