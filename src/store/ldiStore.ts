import { create } from "zustand";
import type { Breakpoint } from "./breakpointStore";
import { choicesForConfig, resolveSpec } from "./buildStore";
import { useSolution } from "./solutionStore";
import { publishLinkedWindow, useLinkedWindows } from "./linkedWindowsStore";
import { usePreferences } from "./preferencesStore";
import { showSessionNotice } from "./sessionFeedbackStore";

export interface LdiBlue {
  file: string; line: number; originLabel: string; partnerLabel: string;
  partnerWindowId: number; entryPoint: string; landing: "automatic-entry" | "red";
  library: string; method: string;
  mode: "scalar" | "typed-interposer" | "live-native"; locals: [string, string];
  condition: string | null;
  warning: string | null; nativePoints: Breakpoint[];
  pendingRestart: boolean;
}
export interface LdiCallSite {
  line: number;
  entryPoint: string;
  partnerLabels: string[];
  configNames: string[];
}
interface LdiPreviewConfig { name: string; cwd: string; args: string[] }
const openingNativeWindows = new Map<string, Promise<string>>();

export function ldiPreviewConfigs(): LdiPreviewConfig[] {
  const { solution, rootPath, clnPath } = useSolution.getState();
  if (!solution || !rootPath) return [];
  const configs = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  return configs.flatMap((config) => {
    if (!config.slots?.build) return [];
    const project = solution.projects.find((item) => item.path === config.target);
    if (project?.kind !== "library" || project.language !== "cpp") return [];
    const buildName = choicesForConfig(solution, config).build;
    const build = configs.find((item) => item.name === buildName && item.kind === "build");
    if (!build) return [];
    const spec = resolveSpec(build, rootPath, solution, null, clnPath);
    if (!spec || spec.program !== "cmake") return [];
    return [{ name: config.name, cwd: spec.cwd, args: spec.args }];
  });
}
export interface LdiSession {
  originLabel: string; partnerLabel: string; partnerWindowId: number;
  file: string; line: number; entryPoint: string; landing: "automatic-entry" | "red";
  nativeFile: string; nativeLine: number;
  mode: "scalar" | "typed-interposer"; locals: [string, string];
  values: [number, number] | null; token: string; held: boolean;
  phase: string; error: string | null; originThreadId: number; originThreadName: string | null;
}
export const useLdi = create<{ blues: LdiBlue[]; session: LdiSession | null; nativeSourceVersion: number }>(() => ({ blues: [], session: null, nativeSourceVersion: 0 }));
let refreshSequence = 0;
let mutationVersion = 0;

export async function refreshLdiBlues() {
  const sequence = ++refreshSequence;
  const version = mutationVersion;
  const { invoke } = await import("@tauri-apps/api/core");
  const blues = await invoke<LdiBlue[]>("get_ldi_blues");
  if (sequence === refreshSequence && version === mutationVersion) useLdi.setState({ blues });
}
export async function setLdiBlue(file: string, line: number, partnerLabel: string, condition?: string) {
  ++mutationVersion;
  // Config selection publishes asynchronously. Bind what the user sees now,
  // not the registry's previous selection after a quick switch/duplicate.
  const current = useSolution.getState();
  await publishLinkedWindow(current.solution, current.clnPath);
  const { invoke } = await import("@tauri-apps/api/core");
  const blue = await invoke<LdiBlue>("set_ldi_blue", { file, line, partnerLabel, condition: condition ?? null });
  ++mutationVersion;
  useLdi.setState((state) => ({ blues: [...state.blues.filter((point) =>
    point.originLabel !== blue.originLabel || point.file !== blue.file || point.line !== blue.line), blue] }));
  void refreshLdiBlues().catch((error) => console.error("[LDI]", error));
  if (blue.mode === "live-native") {
    if (blue.pendingRestart) notifyRustRestart();
  } else if (blue.pendingRestart || useLinkedWindows.getState().activeAction === "debug") notifyLdiRestart();
}
export async function listLdiCallSites(file: string, partnerLabels: string[]): Promise<LdiCallSite[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LdiCallSite[]>("list_ldi_call_sites", { file, partnerLabels, previewConfigs: ldiPreviewConfigs() });
}

function waitForNativeWindow(label: string, configName: string, visible = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => useLinkedWindows.getState().windows.some((item) =>
      item.windowLabel === label && item.ldiRole === "native-library"
      && item.selectedConfigName === configName && !item.restoring
      && Boolean(item.instanceId) && (!visible || item.visible));
    if (ready()) { resolve(); return; }
    const unsubscribe = useLinkedWindows.subscribe(() => { if (ready()) finish(); });
    const timer = window.setTimeout(() => finish(new Error(`The ${configName} window did not finish opening`)), 20_000);
    const finish = (error?: Error) => {
      window.clearTimeout(timer); unsubscribe();
      if (error) reject(error); else resolve();
    };
    if (ready()) finish();
  });
}

export async function setupLdiBlue(file: string, line: number, configName: string, yellowRing = false): Promise<void> {
  const { clnPath, solution } = useSolution.getState();
  if (!clnPath || !solution || !ldiPreviewConfigs().some((item) => item.name === configName)) {
    throw new Error(`Native library Power Config ${configName} is no longer available`);
  }
  const existing = useLinkedWindows.getState().windows.find((item) =>
    item.solutionPath === clnPath && item.ldiRole === "native-library" && item.selectedConfigName === configName);
  if (existing) {
    if (file.endsWith(".rs") && !existing.visible) {
      throw new Error("Show the existing Native window from the Window Manager before pairing Rust Native Debugging");
    }
    await waitForNativeWindow(existing.windowLabel, configName, file.endsWith(".rs"));
    await setLdiBlue(file, line, existing.windowLabel); return;
  }
  const key = `${clnPath}\u0000${configName}`;
  let opening = openingNativeWindows.get(key);
  if (!opening) {
    opening = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const label = await invoke<string>("open_workspace_window", { entry: {
        path: clnPath, kind: "solution", name: solution.name, windowLabel: "", selectedConfigName: configName,
        startHidden: !file.endsWith(".rs") && yellowRing && usePreferences.getState().ldiDuplicateMode === "hide",
      } });
      await waitForNativeWindow(label, configName, file.endsWith(".rs"));
      return label;
    })();
    openingNativeWindows.set(key, opening);
    void opening.finally(() => openingNativeWindows.delete(key)).catch(() => {});
  }
  const label = await opening;
  await setLdiBlue(file, line, label);
}
export async function removeLdiBlue(file: string, line: number) {
  ++mutationVersion;
  const { invoke } = await import("@tauri-apps/api/core");
  const restart = await invoke<boolean>("remove_ldi_blue", { file, line });
  ++mutationVersion;
  useLdi.setState((state) => ({ blues: state.blues.filter((point) =>
    point.originLabel !== useLinkedWindows.getState().ownWindowLabel || point.file !== file || point.line !== line) }));
  void refreshLdiBlues().catch((error) => console.error("[LDI]", error));
  if (restart) { if (file.endsWith(".rs")) notifyRustRestart(); else notifyLdiRestart(); }
}
function notifyRustRestart() {
  showSessionNotice({ key: `rust-native-next-launch:${Date.now()}`,
    message: "Rust Native Breakpoint changes apply on the next Rust Debug launch. The running process keeps its original bindings; Stop and start Rust White Debug to rearm them." });
}
function notifyLdiRestart() {
  const linked = useLinkedWindows.getState();
  if (linked.activeAction !== "debug" || linked.activeActionId === null) return;
  const id = linked.activeActionId;
  showSessionNotice({ key: `ldi-next-launch:${id}`,
    message: "Blue breakpoint changes are saved for the next launch. Restart Gold Debug to apply them.",
    actionLabel: "Gold Restart Debug",
    action: async () => {
      const current = useLinkedWindows.getState();
      if (current.activeActionId !== id || current.activeAction !== "debug") throw new Error("The debug session changed. Use the Gold Debug button to start the current setup.");
      const { restartSessions } = await import("../lib/sessionRestart");
      await restartSessions({ scope: "gold", actionId: id,
        targets: current.members.map((item) => ({ windowLabel: item.windowLabel, instanceId: item.instanceId,
          configName: item.selectedConfigName, profileName: item.selectedProfileName, action: "debug" })),
        affected: [], reason: "Apply the configured Blue breakpoints." });
    },
  });
}
export async function reconcileLdiBluesOnSave(file: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const restart = await invoke<boolean>("reconcile_ldi_blues_on_save", { file });
    if (restart && file.endsWith(".rs")) notifyRustRestart();
  } finally {
    await refreshLdiBlues();
  }
}
export async function abandonLdi(token: string, partnerLabel?: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("abandon_ldi_reproduction", { token, partnerLabel });
}
export async function listenToLdi(): Promise<() => void> {
  const { listenToNativeDebug } = await import("./nativeDebugStore");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  let disposed = false;
  let queued = false;
  let selectionKey = "";
  const refresh = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) void refreshLdiBlues().catch((error) => console.error("[LDI]", error));
    });
  };
  const cleanups = await Promise.all([
    listenToNativeDebug(),
    getCurrentWebviewWindow().listen<LdiSession>("craidd:ldi-state", ({ payload }) => useLdi.setState({ session: payload })),
    listen("craidd:ldi-blues", refresh), listen("craidd:breakpoints-changed", refresh),
    listen<string>("craidd:native-source-saved", ({ payload }) => {
      const root = useSolution.getState().rootPath?.replace(/\/+$/, "");
      if (root && payload.startsWith(root + "/")) {
        useLdi.setState((state) => ({ nativeSourceVersion: state.nativeSourceVersion + 1 }));
        refresh();
      }
    }),
    getCurrentWebviewWindow().listen<{ windows: { windowLabel: string; instanceId: string; selectedConfigName: string | null; selectedProfileName: string | null; ldiRole: string | null; visible: boolean; restoring: boolean; dirtyCount: number }[] }>("craidd:linked-state", ({ payload }) => {
      const key = JSON.stringify(payload.windows.map((item) => [item.windowLabel, item.instanceId,
        item.selectedConfigName, item.selectedProfileName, item.ldiRole, item.visible, item.restoring, item.dirtyCount]));
      if (key !== selectionKey) { selectionKey = key; refresh(); }
    }),
  ]);
  refresh();
  return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); };
}
