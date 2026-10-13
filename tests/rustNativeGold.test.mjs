import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const zustand = import.meta.resolve("zustand");
const name = "__craiddRustNativeGoldTest";
const state = globalThis[name] = { calls: [] };
globalThis.window = { setTimeout, clearTimeout };

const build = url(`import {create} from ${JSON.stringify(zustand)};
export const useBuild=create(()=>({async start(kind){globalThis.${name}.calls.push(['start',kind]); globalThis.${name}.debug.setState({status:'building'});}}));
export const choicesForConfig=(_,config)=>config.slots ?? {};
export const resolveSpec=(config)=>({label:config.name});`);
const debug = url(`import {create} from ${JSON.stringify(zustand)};
export const useDebug=create(()=>({status:'idle'}));`);
const linked = url(`import {create} from ${JSON.stringify(zustand)};
export const useLinkedWindows=create(()=>({windows:[],ownWindowLabel:'A',linked:false,activeAction:null}));
export async function focusLinkedWindow(label){globalThis.${name}.calls.push(['focus',label]); return true;}
export async function setLinkedWindowVisible(label,visible){globalThis.${name}.calls.push(['visible',label,visible]);
  useLinkedWindows.setState(s=>({windows:s.windows.map(w=>w.windowLabel===label?{...w,visible,restoring:true}:w)}));
  setTimeout(()=>useLinkedWindows.setState(s=>({windows:s.windows.map(w=>w.windowLabel===label?{...w,restoring:false}:w)})),10);}
export async function waitForLinkedWindowReady(label){globalThis.${name}.calls.push(['wait-ready',label]);
  if(useLinkedWindows.getState().windows.some(w=>w.windowLabel===label&&w.visible&&!w.restoring))return;
  await new Promise(resolve=>{const off=useLinkedWindows.subscribe(s=>{
    if(s.windows.some(w=>w.windowLabel===label&&w.visible&&!w.restoring)){off();resolve();}
  });});}
export async function dispatchLinkedWindowCommand(label,kind){globalThis.${name}.calls.push(['dispatch',label,kind]);}`);
const solution = url(`import {create} from ${JSON.stringify(zustand)};
export const useSolution=create(()=>({solution:{inferredConfigs:[],configs:[
  {name:'Native',slots:{build:'Native Build'}},{name:'Native Build',kind:'build'}]},rootPath:'/lab',clnPath:'/lab/thread-control.cln'}));`);
const ldi = url(`import {create} from ${JSON.stringify(zustand)};
export const useLdi=create(()=>({blues:[]}));
export const ldiPreviewConfigs=()=>globalThis.${name}.configs.map(name=>({name}));
export async function listLdiCallSites(){return [{line:31,entryPoint:'step_pair_cpp',configNames:globalThis.${name}.configs}];}
export async function setupLdiBlue(file,line,config){globalThis.${name}.calls.push(['open-and-pair',config]);
  globalThis.${name}.linked.setState(s=>({windows:[...s.windows,{windowLabel:'B2',ldiRole:'native-library',selectedConfigName:config,
    solutionPath:'/lab/thread-control.cln',visible:true,restoring:false,dirtyCount:0}]}));
  useLdi.setState(s=>({blues:s.blues.map(b=>({...b,partnerLabel:'B2',warning:null}))}));}
export async function refreshLdiBlues(){globalThis.${name}.calls.push(['refresh-blues']);
  const ready=globalThis.${name}.linked.getState().windows.some(w=>w.windowLabel==='B'&&w.visible&&!w.restoring);
  if(ready)useLdi.setState(s=>({blues:s.blues.map(b=>b.partnerLabel==='B'?{...b,warning:null}:b)}));}`);

const source = await readFile(new URL("../src/lib/rustNativeGold.ts", import.meta.url), "utf8");
let { outputText } = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} });
for (const [path, replacement] of Object.entries({
  "../store/buildStore": build, "../store/debugStore": debug, "../store/ldiStore": ldi,
  "../store/linkedWindowsStore": linked, "../store/solutionStore": solution,
})) outputText = outputText.replaceAll(JSON.stringify(path), JSON.stringify(replacement));
const gold = await import(url(outputText));
const { useLinkedWindows } = await import(linked);
const { useLdi } = await import(ldi);
const { useDebug } = await import(debug);
const { useSolution } = await import(solution);
state.linked = useLinkedWindows;
state.debug = useDebug;

const owner = { windowLabel:"A", ldiRole:"live-native", canDebug:true, visible:true, restoring:false, status:"idle" };
const native = { windowLabel:"B", ldiRole:"native-library", selectedConfigName:"Native",
  solutionPath:"/lab/thread-control.cln", visible:true, restoring:false, dirtyCount:0 };
const blue = { file:"/lab/Rust/main.rs", line:31, entryPoint:"step_pair_cpp", library:"Native Build",
  originLabel:"A", partnerLabel:"B", mode:"live-native", warning:null, unreachable:null };

beforeEach(() => {
  state.calls = []; state.configs = ["Native"];
  useLinkedWindows.setState({ windows:[owner,native], ownWindowLabel:"A", linked:false, activeAction:null });
  useLdi.setState({ blues:[blue] });
  useDebug.setState({ status:"idle" });
  useSolution.setState({solution:{inferredConfigs:[],configs:[
    {name:"Native",slots:{build:"Native Build"}},{name:"Native Build",kind:"build"}]}});
});

test("Gold for a Rust and Native pair starts only the Rust debugger", async () => {
  assert.equal(gold.rustNativeGoldOwner(useLinkedWindows.getState(), useLdi.getState().blues), "A");
  await gold.startRustNativeGold("A");
  assert.deepEqual(state.calls, [["refresh-blues"],["focus","A"],["start","debug"]]);
});

test("Gold reopens a closed native partner before the one Rust launch", async () => {
  useLinkedWindows.setState({ windows:[owner] });
  useLdi.setState({ blues:[{...blue,warning:"Debugging window is no longer open"}] });
  await gold.startRustNativeGold("A");
  assert.deepEqual(state.calls, [["open-and-pair","Native"],["refresh-blues"],["focus","A"],["start","debug"]]);
  assert.equal(useLdi.getState().blues[0].partnerLabel,"B2");
});

test("an ambiguous Native config asks for a choice before launching", async () => {
  useLinkedWindows.setState({ windows:[owner] });
  useLdi.setState({ blues:[{...blue,library:"Old Native Build",warning:"Debugging window is no longer open"}] });
  state.configs = ["Native", "Other Native"];
  await assert.rejects(gold.startRustNativeGold("A"), (error) => error instanceof gold.NativeConfigChoiceNeeded
    && error.choices.length === 2);
  assert.equal(state.calls.some(([kind]) => kind === "start"), false);
});

test("ordinary linked groups and managed LDI retain their existing Gold route", () => {
  assert.equal(gold.rustNativeGoldOwner({...useLinkedWindows.getState(),linked:true}, [blue]), null);
  assert.equal(gold.rustNativeGoldOwner({...useLinkedWindows.getState(),windows:[{...owner,ldiRole:"managed"},native]},
    [{...blue,mode:"scalar"}]), null);
});

test("a Rust and Native pair offers Gold guidance before its first Blue", () => {
  assert.equal(gold.rustNativeGoldOwner(useLinkedWindows.getState(), []), "A");
  assert.equal(gold.rustNativeGoldOwner({...useLinkedWindows.getState(), windows:[owner,native,
    {windowLabel:"C",ldiRole:null,canDebug:true}]}, []), null);
});

test("Gold shows a hidden native partner and starts in one click", async () => {
  useLinkedWindows.setState({ windows:[owner,{...native,visible:false}] });
  useLdi.setState({ blues:[{...blue,warning:"Show the Native window before starting Rust Native Debugging"}] });
  await gold.startRustNativeGold("A");
  assert.deepEqual(state.calls.map(([kind]) => kind), ["visible","wait-ready","refresh-blues","focus","start"]);
  assert.equal(useLdi.getState().blues[0].warning, null);
});
