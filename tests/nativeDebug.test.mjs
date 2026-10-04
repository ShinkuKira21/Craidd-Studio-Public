import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Execute the real stores/actions/components, replacing only desktop IPC and
// unrelated stores. This is not a substitute for the two native-window check.
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const zustand = import.meta.resolve("zustand");
const mockName = "__craiddNativeDebugTest";
const mocks = globalThis[mockName] = {};
Error.stackTraceLimit = 0; // Transpiled data URLs otherwise dump entire modules on failure.
globalThis.window = { setTimeout, clearTimeout };
const core = url(`export async function invoke(command,args) {
  const g=globalThis.${mockName}; g.calls.push({command,args});
  if(command === 'get_native_debug_context') { g.queryStarted=true; return g.restore ?? null; }
  if(command === 'native_debug_control' && g.rejectedToken === args.token) throw new Error('Native inspection changed');
  if(command === 'stat_files') return [{exists:!g.missingSource,readable:!g.missingSource}];
  if(command === 'get_ldi_blues') return g.refreshQueue?.shift() ?? (g.blue ? [g.blue] : []);
  if(command === 'set_ldi_blue') return g.blue;
  if(command === 'open_workspace_window') { g.onOpen?.(); return 'native-new'; }
}`);
const webview = url(`export function getCurrentWebviewWindow() {
  const g=globalThis.${mockName};
  return {label:g.windowLabel, async listen(name,callback) {
    g.listeners.set(name,callback); return () => g.listeners.delete(name);
  }};
}`);
const solution = url(`import {create} from ${JSON.stringify(zustand)};
export const useSolution=create(()=>({solution:null,clnPath:'/lab/solution.cln',tabs:[],
  async revealFile(...location) { globalThis.${mockName}.reveals.push(location); }
}));`);
const linked = url(`import {create} from ${JSON.stringify(zustand)};
export const useLinkedWindows=create(()=>({windows:[],members:[],ownWindowLabel:'native',viewedWindowLabel:'native',activeAction:null}));
export async function publishLinkedWindow(...args) {globalThis.${mockName}.calls.push({command:'publish-selection',args});}
export async function dispatchLinkedWindowCommand(...args) {globalThis.${mockName}.calls.push({command:'linked-command',args});}`);
const build = url(`import {create} from ${JSON.stringify(zustand)};
export const useBuild=create(()=>({selectedConfigName:'Native · Scalar',selectedProfileName:null,mainChoices:{build:'Native Build',run:null,debug:null},
  async start(...args) {globalThis.${mockName}.calls.push({command:'build-start',args});},
  async stop() {globalThis.${mockName}.calls.push({command:'build-stop'});},
  setSelectedProfile() {}
}));
export const choicesForConfig=(_,config)=>config?.slots ?? {};
export const resolveSpec=()=>({program:'cmake',cwd:'/lab/Native',args:['--build','build']});
export function syncMainChoices(){}
export function selectConfiguration(_,name){useBuild.setState({selectedConfigName:name});}`);
const breakpoints = url(`import {create} from ${JSON.stringify(zustand)};
export const useBreakpoints=create(()=>({points:[],async remove(){}}));`);

async function load(relative, replacements) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } });
  for (const [name, target] of Object.entries(replacements)) outputText = outputText.replaceAll(JSON.stringify(name), JSON.stringify(target));
  return url(outputText);
}
const feedback = url(`export function showSessionNotice(notice){globalThis.${mockName}.notices.push(notice);}`);
const sourceURL = await load("../src/lib/debugSource.ts", {
  "../store/solutionStore": solution, "../store/sessionFeedbackStore": feedback, "@tauri-apps/api/core": core,
});
const { revealDebugSource } = await import(sourceURL);
const nativeURL = await load("../src/store/nativeDebugStore.ts", {
  "../lib/debugSource": sourceURL,
  zustand, "./solutionStore": solution, "./linkedWindowsStore": linked,
  "@tauri-apps/api/core": core, "@tauri-apps/api/webviewWindow": webview,
});
const outputURL = await load("../src/lib/outputPresentation.ts", {});
const debugURL = await load("../src/store/debugStore.ts", {
  "../lib/debugSource": sourceURL,
  zustand, "./solutionStore": solution, "./breakpointStore": breakpoints, "../lib/outputPresentation": outputURL,
  "@tauri-apps/api/core": core, "@tauri-apps/api/webviewWindow": webview,
});
const actionsURL = await load("../src/lib/viewedActions.ts", {
  "../store/buildStore": build, "../store/debugStore": debugURL, "../store/solutionStore": solution,
  "../store/linkedWindowsStore": linked, "../store/nativeDebugStore": nativeURL, "@tauri-apps/api/core": core,
});
const native = await import(nativeURL);
const { useDebug, listenToDebug } = await import(debugURL);
const actions = await import(actionsURL);
const { useLinkedWindows } = await import(linked);
const { useBuild } = await import(build);
const { useSolution } = await import(solution);
const context = (extra = {}) => ({ token: "1:100:1", originLabel: "rust", partnerLabel: "native", entryPoint: "demo_add",
  callFile: "/lab/Rust/src/main.rs", callLine: 10,
  status: "paused", nativeStop: true, file: "/lab/Native/scalar.cpp", line: 13,
  frames: [{ id: 1, name: "demo_add", line: 13, source: { path: "/lab/Native/scalar.cpp", name: "scalar.cpp" } }],
  variables: [{ name: "left", value: "20", variablesReference: 0 }], ...extra });
function emit(name, payload) { const handler = mocks.listeners.get(name); assert.ok(handler, name); handler({ payload }); }
async function until(predicate) { for (let i=0; i<30; i++) { if (predicate()) return; await new Promise(setImmediate); } assert.fail("Listener did not register"); }
beforeEach(() => {
  Object.assign(mocks, { calls: [], reveals: [], notices: [], missingSource:false, blue:null,refreshQueue:[],onOpen:null,listeners: new Map(), windowLabel: "native", restore: null, rejectedToken: null, queryStarted: false });
  native.useNativeDebug.setState({ context: null });
  useDebug.setState({ status: "idle", file: null, line: null, frames: [], variables: [], output: "", reason: null });
  useLinkedWindows.setState({ ownWindowLabel: "native", viewedWindowLabel: "native", windows: [], members: [], activeAction: null });
  useBuild.setState({ selectedConfigName: "Native · Scalar" });
  useSolution.setState({solution:null,rootPath:'/lab',tabs:[]});
});

test("native starting is active and Stop routes to the debugger, not the runner", async () => {
  const cleanup = await listenToDebug();
  emit("craidd:debug-state", { status: "starting", text: "Debugger connected; waiting for native execution" });
  assert.equal(useDebug.getState().status, "starting");
  assert.match(useDebug.getState().output, /waiting for native execution/);
  await useDebug.getState().start("cargo", "/lab", "Debug");
  assert.equal(mocks.calls.length, 0, "Starting must not permit a duplicate launch");
  await actions.stopViewedAction();
  assert.deepEqual(mocks.calls, [{ command: "debug_control", args: { action: "stop" } }]);
  cleanup();
});

test("Native receives source, mixed stack and locals without adopting Rust Power Config", async () => {
  const cleanup = await native.listenToNativeDebug();
  emit("craidd:native-debug-context", context());
  await until(() => mocks.reveals.length === 1);
  assert.deepEqual(mocks.reveals, [["/lab/Native/scalar.cpp", 13, 1]]);
  assert.equal(native.useNativeDebug.getState().context.variables[0].value, "20");
  assert.equal(useBuild.getState().selectedConfigName, "Native · Scalar");
  assert.equal(useLinkedWindows.getState().viewedWindowLabel, "native");
  assert.equal(useDebug.getState().status, "idle", "Native does not own a second adapter");
  emit("craidd:native-debug-context", context({ variables: [{ name: "right", value: "22" }] }));
  assert.equal(mocks.reveals.length, 1, "Locals refresh must not repeatedly focus the editor");
  cleanup();
});

test("Native transport and Stop use token-scoped Rust inspection controls", async () => {
  native.useNativeDebug.setState({ context: context() });
  await actions.controlViewedDebug("stepOut");
  await actions.stopViewedAction();
  assert.deepEqual(mocks.calls, [
    { command: "native_debug_control", args: { token: "1:100:1", action: "stepOut" } },
    { command: "native_debug_control", args: { token: "1:100:1", action: "stop" } },
  ]);
  assert.equal(useBuild.getState().selectedConfigName, "Native · Scalar");
});

test("Native cannot rebuild the active Rust process's library from its transport view", async () => {
  native.useNativeDebug.setState({ context: context() });
  await assert.rejects(actions.startViewedAction("build"), /Stop that debug session/);
  assert.equal(mocks.calls.length, 0);
});

test("detaching clears the view; next action returns to local Native controls", async () => {
  const cleanup = await native.listenToNativeDebug();
  emit("craidd:native-debug-context", context());
  await until(() => mocks.reveals.length === 1);
  emit("craidd:native-debug-context", context({ status: "detached" }));
  assert.equal(native.currentNativeInspection(), null);
  await actions.startViewedAction("build");
  assert.equal(mocks.calls.at(-1).command, "build-start");
  cleanup();
});

test("missing Rust SDK source preserves the paused session and does not open a broken workspace file", async () => {
  mocks.missingSource = true;
  const cleanup = await listenToDebug();
  emit("craidd:debug-state", {status:"paused",file:"/usr/src/debug/rust/library/std/src/sys/backtrace.rs",line:1});
  await until(() => mocks.notices.length > 0);
  assert.equal(useDebug.getState().status,"paused");
  assert.equal(mocks.reveals.length,0);
  assert.match(mocks.notices[0].message,/source is unavailable/);
  assert.equal(await revealDebugSource("/missing.rs",1),false);
  const notices = mocks.notices.length;
  assert.equal(await revealDebugSource("/obsolete-stop.rs",1,1,()=>false),false);
  assert.equal(mocks.notices.length,notices,"A superseded stop must not show a stale source notice");
  cleanup();
});

test("Native keeps Stop across Step Out into Rust without retaining C++ locals or revealing Rust locally", async () => {
  const cleanup = await native.listenToNativeDebug();
  emit("craidd:native-debug-context", context({token:"1:100:2",nativeStop:false,file:null,line:null,frames:[],variables:[]}));
  assert.equal(native.currentNativeInspection().nativeStop,false);
  assert.equal(mocks.reveals.length,0);
  await actions.stopViewedAction();
  assert.equal(mocks.calls.at(-1).command,"native_debug_control");
  assert.equal(mocks.calls.at(-1).args.action,"stop");
  await assert.rejects(actions.startViewedAction("build"),/Stop that debug session/);
  cleanup();
});

const ldiURL = await load("../src/store/ldiStore.ts", {
  zustand,"./buildStore":build,"./solutionStore":solution,"./linkedWindowsStore":linked,
  "./preferencesStore":url("export const usePreferences={getState:()=>({ldiDuplicateMode:'hide'})};"),
  "./sessionFeedbackStore":feedback,"@tauri-apps/api/core":core,
});
const ldi = await import(ldiURL);
const nativeConfig = {name:"Native · Scalar",target:"Native/Native.craidd",slots:{build:"Native Build"}};
const labSolution = {name:"Lab",projects:[{path:"Native/Native.craidd",kind:"library",language:"cpp"}],
  inferredConfigs:[],configs:[nativeConfig,{name:"Native Build",kind:"build",method:"cmake"}]};

test("one ghost-ring click opens visible Native and sets its blue after publishing the current caller selection", async () => {
  useSolution.setState({solution:labSolution});
  useLinkedWindows.setState({ownWindowLabel:"rust",windows:[]});
  mocks.blue={file:"/lab/Rust/src/main.rs",line:10,originLabel:"rust",partnerLabel:"native-new",mode:"live-native",pendingRestart:false};
  mocks.onOpen=()=>useLinkedWindows.setState({windows:[{windowLabel:"native-new",instanceId:"new-instance",solutionPath:"/lab/solution.cln",selectedConfigName:"Native · Scalar",ldiRole:"native-library",restoring:false,visible:true}]});
  await ldi.setupLdiBlue(mocks.blue.file,10,"Native · Scalar",true);
  assert.equal(mocks.calls.filter(call=>call.command==="set_ldi_blue").length,1);
  assert.equal(mocks.calls.find(call=>call.command==="open_workspace_window").args.entry.startHidden,false);
  assert.ok(mocks.calls.findIndex(call=>call.command==="publish-selection") < mocks.calls.findIndex(call=>call.command==="set_ldi_blue"));
  assert.equal(ldi.useLdi.getState().blues[0].partnerLabel,"native-new");
});

test("late pre-click refresh cannot erase the marker accepted by the setter", async () => {
  let resolve;
  mocks.refreshQueue=[new Promise(done=>{resolve=done;})];
  const old = ldi.refreshLdiBlues();
  await until(()=>mocks.calls.some(call=>call.command==="get_ldi_blues"));
  mocks.blue={file:"/lab/Rust/src/main.rs",line:10,originLabel:"rust",partnerLabel:"native",mode:"live-native",pendingRestart:false};
  await ldi.setLdiBlue(mocks.blue.file,10,"native");
  resolve([]); await old;
  assert.equal(ldi.useLdi.getState().blues[0].partnerLabel,"native");
});

test("late old-session detach cannot erase a replacement native view", async () => {
  const cleanup = await native.listenToNativeDebug();
  emit("craidd:native-debug-context", context({ token: "2:200:1", originLabel: "new-rust" }));
  emit("craidd:native-debug-context", context({ status: "detached" }));
  assert.equal(native.currentNativeInspection().originLabel, "new-rust");
  cleanup();
});

test("initial query cannot replace a newer delivered stop", async () => {
  let resolve;
  mocks.restore = new Promise((done) => { resolve = done; });
  const pending = native.listenToNativeDebug();
  await until(() => mocks.queryStarted);
  emit("craidd:native-debug-context", context({ token: "2:200:1" }));
  resolve(context());
  const cleanup = await pending;
  assert.equal(native.currentNativeInspection().token, "2:200:1");
  cleanup();
});

test("wrong-window context cannot replace this window's inspection", async () => {
  const cleanup = await native.listenToNativeDebug();
  emit("craidd:native-debug-context", context({ partnerLabel: "other-native" }));
  assert.equal(native.currentNativeInspection(), null);
  cleanup();
});

test("backend stale-control rejection is visible and cannot fall back to Native's own debugger", async () => {
  native.useNativeDebug.setState({ context: context() }); mocks.rejectedToken = "1:100:1";
  await assert.rejects(actions.controlViewedDebug("stepOver"), /inspection changed/);
  assert.equal(mocks.calls.length, 1); assert.equal(mocks.calls[0].command, "native_debug_control");
});

test("hidden-window adoption still routes to the hidden owner, not the Native inspection", async () => {
  native.useNativeDebug.setState({ context: context() });
  useLinkedWindows.setState({ viewedWindowLabel: "hidden", windows: [{ windowLabel: "hidden", visible: false, restoring: false }] });
  await actions.controlViewedDebug("continue");
  assert.deepEqual(mocks.calls, [{ command: "linked-command", args: ["hidden", "debug_control", "continue"] }]);
});

test("Rust owner keeps its Rust editor on routed stops; ordinary red C++ stops still reveal locally", async () => {
  mocks.windowLabel = "rust";
  const cleanup = await listenToDebug();
  emit("craidd:debug-state", { status: "paused", file: "/lab/Native/scalar.cpp", line: 13, nativeRouted: true, frames: context().frames });
  assert.equal(useDebug.getState().status, "paused");
  assert.match(useDebug.getState().reason, /paired Native window/);
  assert.equal(mocks.reveals.length, 0);
  emit("craidd:debug-state", { status: "paused", file: "/lab/Native/scalar.cpp", line: 13 });
  await until(() => mocks.reveals.length === 1);
  assert.equal(mocks.reveals.length, 1);
  cleanup();
});

// SSR uses Zustand's initial (not updated) server snapshot. Read the current
// native store snapshot for this component contract test, without mocking data.
const nativeSnapshotURL = url(`import {useNativeDebug as store} from ${JSON.stringify(nativeURL)};
export const useNativeDebug=(selector)=>selector(store.getState());`);
const sidebarURL = await load("../src/components/panels/DebugSidebar.tsx", {
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../../store/debugStore": debugURL, "../../store/breakpointStore": breakpoints, "../../store/solutionStore": solution,
  "../../store/linkedWindowsStore": linked, "../../store/nativeDebugStore": nativeSnapshotURL,
  "./LdiSessionCard": url("export default function LdiSessionCard(){return null;}"),
  "../../lib/debugSource": sourceURL,
});
const { default: DebugSidebar } = await import(sidebarURL);
test("Native inspector renders real Rust-owned frames/locals while Native's adapter remains idle", () => {
  native.useNativeDebug.setState({ context: context() });
  const html = renderToStaticMarkup(createElement(DebugSidebar));
  for (const text of ["Live Rust FFI", "Rust-owned native inspection", "demo_add", "scalar.cpp", "left", "20", "Stop ends the owning Rust"]) assert.ok(html.includes(text), text);
  assert.equal(useDebug.getState().status, "idle");
  assert.equal(useSolution.getState().clnPath, "/lab/solution.cln");
});

const snapshotFacade = (module, exportName) => url(`import {${exportName} as store} from ${JSON.stringify(module)};
export function ${exportName}(selector){return selector?selector(store.getState()):store.getState();}
${exportName}.getState=store.getState;`);
const linkedSnapshot = url(`import {useLinkedWindows as store} from ${JSON.stringify(linked)};
export function useLinkedWindows(selector){return selector?selector(store.getState()):store.getState();}
export async function previewLinkedAction(){} export async function startLinkedAction(){} export async function stopLinkedAction(){}`);
const toolbarURL = await load("../src/components/layout/Toolbar.tsx", {
  react:import.meta.resolve("react"),"react/jsx-runtime":import.meta.resolve("react/jsx-runtime"),
  "../../store/solutionStore":snapshotFacade(solution,"useSolution"),
  "../../store/buildStore":build,"../../store/debugStore":snapshotFacade(debugURL,"useDebug"),
  "../../store/linkedWindowsStore":linkedSnapshot,"../../store/ldiStore":snapshotFacade(ldiURL,"useLdi"),
  "../../store/nativeDebugStore":nativeSnapshotURL,"../../lib/viewedActions":actionsURL,
  "../../lib/linkedStartup":url("export const detectLinkedStartupSuggestions=()=>[];"),
  "../dialogs/configurations/ConfigurationsDialog":url("export default function C(){return null;}"),
  "../dialogs/LinkedLaunchPlanDialog":url("export default function C(){return null;}"),
  "./WindowManager":url("export default function C(){return null;}"),
});
const {default:Toolbar}=await import(toolbarURL);
test("Native+Rust keeps disabled Gold presence and no standalone Native Debug launch", () => {
  useSolution.setState({solution:labSolution});
  useLinkedWindows.setState({windows:[{windowLabel:"native"},{windowLabel:"rust"}],linked:false,canBuild:false,canRun:false,canDebug:false});
  const html=renderToStaticMarkup(createElement(Toolbar));
  assert.ok(html.includes("2 solution windows; no eligible linked debug group"));
  assert.ok(html.includes("Debug — no debug configurations"));
});
test("Native toolbar exposes Gold Rust Stop outside native frames and only offers owner navigation while paused in Rust", () => {
  native.useNativeDebug.setState({context:context({nativeStop:false,file:null,line:null,frames:[],variables:[]})});
  const html=renderToStaticMarkup(createElement(Toolbar));
  assert.ok(html.includes("Stop linked Rust debugger"));
  assert.ok(html.includes("Stop owning Rust debugger"));
  assert.ok(html.includes("Paused in Rust · show owner"));
  assert.ok(!html.includes('aria-label="Step Into"'));
});
