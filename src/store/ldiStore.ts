import { create } from "zustand";
import type { Breakpoint } from "./breakpointStore";
import { choicesForConfig, resolveSpec } from "./buildStore";
import { useSolution } from "./solutionStore";
import { useLinkedWindows } from "./linkedWindowsStore";
import { usePreferences } from "./preferencesStore";

export interface LdiBlue {
  file: string; line: number; originLabel: string; partnerLabel: string;
  partnerWindowId: number; entryPoint: string; landing: "automatic-entry" | "red";
  library: string; method: string;
  mode: "scalar" | "typed-interposer"; locals: [string, string];
  condition: string | null;
  warning: string | null; nativePoints: Breakpoint[];
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
  phase: string; error: string | null;
}
export const useLdi = create<{ blues: LdiBlue[]; session: LdiSession | null }>(() => ({ blues: [], session: null }));

export async function refreshLdiBlues() {
  const { invoke } = await import("@tauri-apps/api/core");
  const blues = await invoke<LdiBlue[]>("get_ldi_blues");
  useLdi.setState({ blues });
}
export async function setLdiBlue(file: string, line: number, partnerLabel: string, condition?: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_ldi_blue", { file, line, partnerLabel, condition: condition ?? null });
  await refreshLdiBlues();
}
export async function listLdiCallSites(file: string, partnerLabels: string[]): Promise<LdiCallSite[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LdiCallSite[]>("list_ldi_call_sites", { file, partnerLabels, previewConfigs: ldiPreviewConfigs() });
}

function waitForNativeWindow(label: string, configName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => useLinkedWindows.getState().windows.some((item) =>
      item.windowLabel === label && item.ldiRole === "native-library"
      && item.selectedConfigName === configName && !item.restoring);
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
  if (existing) { await setLdiBlue(file, line, existing.windowLabel); return; }
  const key = `${clnPath}\u0000${configName}`;
  let opening = openingNativeWindows.get(key);
  if (!opening) {
    opening = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const label = await invoke<string>("open_workspace_window", { entry: {
        path: clnPath, kind: "solution", name: solution.name, windowLabel: "", selectedConfigName: configName,
        startHidden: yellowRing && usePreferences.getState().ldiDuplicateMode === "hide",
      } });
      await waitForNativeWindow(label, configName);
      return label;
    })();
    openingNativeWindows.set(key, opening);
    void opening.finally(() => openingNativeWindows.delete(key)).catch(() => {});
  }
  const label = await opening;
  await setLdiBlue(file, line, label);
}
export async function removeLdiBlue(file: string, line: number) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_ldi_blue", { file, line });
  await refreshLdiBlues();
}
export async function reconcileLdiBluesOnSave(file: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("reconcile_ldi_blues_on_save", { file });
  } finally {
    await refreshLdiBlues();
  }
}
export async function abandonLdi(token: string, partnerLabel?: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("abandon_ldi_reproduction", { token, partnerLabel });
}
export async function listenToLdi(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  let disposed = false;
  let queued = false;
  const refresh = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) void refreshLdiBlues().catch((error) => console.error("[LDI]", error));
    });
  };
  const cleanups = await Promise.all([
    getCurrentWebviewWindow().listen<LdiSession>("craidd:ldi-state", ({ payload }) => useLdi.setState({ session: payload })),
    listen("craidd:ldi-blues", refresh), listen("craidd:breakpoints-changed", refresh),
    getCurrentWebviewWindow().listen("craidd:linked-state", refresh),
  ]);
  refresh();
  return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); };
}
