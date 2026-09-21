import { create } from "zustand";
import type { CraiddSolution } from "../types/project";
import { choicesForConfig, resolveSpec, selectConfiguration, useBuild } from "./buildStore";
import { useSolution } from "./solutionStore";
import type { BuildProblem } from "../lib/buildDiagnostics";
import { useDebug, type DebugFrame, type DebugVariable } from "./debugStore";

type Action = "build" | "run" | "debug";

export interface LinkedSnapshot {
  sequence: number;
  linked: boolean;
  members: LinkedMember[];
  windows: LinkedMember[];
  canBuild: boolean;
  canRun: boolean;
  canDebug: boolean;
  busy: boolean;
  activeAction: Action | null;
  problems: (BuildProblem & { windowLabel: string; projectName: string })[];
}

export interface LinkedMember {
  windowLabel: string;
  windowId: number;
  instanceId: string;
  projectName: string;
  status: string;
  visible: boolean;
  restoring: boolean;
  selectedConfigName: string | null;
  selectedProfileName: string | null;
  activeFile: { path: string; name: string; language: string; content: string; dirty: boolean; truncated: boolean } | null;
  tabs: { path: string; name: string; dirty: boolean }[];
  output: string;
  dirtyCount: number;
  pausedLine: number | null;
  pauseReason: string | null;
  failureMessage: string | null;
  debugFrames: DebugFrame[];
  debugVariables: DebugVariable[];
}

interface LinkedView {
  ownWindowLabel: string | null;
  ownInstanceId: string | null;
  viewedWindowLabel: string | null;
  selectWindow: (label: string) => Promise<void>;
}

const empty: LinkedSnapshot = {
  sequence: 0, linked: false, members: [], windows: [], canBuild: false,
  canRun: false, canDebug: false, busy: false, activeAction: null,
  problems: [],
};

export const useLinkedWindows = create<LinkedSnapshot & LinkedView>((set) => ({
  ...empty, ownWindowLabel: null, ownInstanceId: null, viewedWindowLabel: null,
  selectWindow: async (label) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const state = useLinkedWindows.getState();
    const target = state.windows.find((item) => item.windowLabel === label);
    if (target && target.visible && !target.restoring && label !== state.ownWindowLabel) {
      try {
        await invoke("focus_linked_window", { targetLabel: label });
      } catch (cause) {
        console.error("[craidd] Could not focus linked window:", cause);
      }
      return;
    }
    try {
      const snapshot = await invoke<LinkedSnapshot>("view_linked_window", { targetLabel: label });
      set({ viewedWindowLabel: label });
      applySnapshot(snapshot);
    } catch (cause) {
      const message = String(cause);
      if (message.includes("visible-elsewhere:")) {
        const other = message.split("visible-elsewhere:")[1].split('"')[0].trim();
        try { await invoke("focus_linked_window", { targetLabel: other }); } catch { /* best effort */ }
        return;
      }
      throw cause;
    }
  },
}));

export function setWindowInstanceId(id: string): void {
  useLinkedWindows.setState({ ownInstanceId: id });
}

function applySnapshot(snapshot: LinkedSnapshot) {
  if (snapshot.sequence >= useLinkedWindows.getState().sequence) {
    const state = useLinkedWindows.getState();
    const viewedWindowLabel = state.viewedWindowLabel && snapshot.windows.some((item) => item.windowLabel === state.viewedWindowLabel)
      ? state.viewedWindowLabel : state.ownWindowLabel;
    useLinkedWindows.setState({ ...snapshot, viewedWindowLabel });
  }
}

let revision = 0;
const rendererId = crypto.randomUUID();
const cancelledActions = new Set<number>();

function actionStatus(action: Action): string {
  if (action === "debug") return useDebug.getState().status;
  return useBuild.getState().status;
}

export async function publishLinkedWindow(solution: CraiddSolution | null, clnPath: string | null): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const build = useBuild.getState();
  const debug = useDebug.getState();
  const configs = [...(solution?.inferredConfigs ?? []), ...(solution?.configs ?? [])];
  const selected = configs.find((config) => config.name === build.selectedConfigName);
  const debugChoice = configs.find((config) => config.name === build.mainChoices.debug);
  const project = solution?.projects.find((candidate) => candidate.path === selected?.target);
  const currentRevision = ++revision;
  const solutionState = useSolution.getState();
  const activeTab = solutionState.tabs.find((tab) => tab.fileId === solutionState.activeFileId);
  const specs: Record<string, NonNullable<ReturnType<typeof resolveSpec>>> = {};
  if (solution && solutionState.rootPath) {
    for (const action of ["build", "run", "debug"] as const) {
      const config = configs.find((item) => item.name === build.mainChoices[action] && item.kind === action);
      if (config) {
        const spec = resolveSpec(config, solutionState.rootPath, solution, build.selectedProfileName);
        if (spec) specs[action] = spec;
      }
    }
  }
  const snapshot = await invoke<LinkedSnapshot>("update_linked_window", { update: {
    solutionPath: clnPath,
    instanceId: useLinkedWindows.getState().ownInstanceId,
    projectPath: project?.path ?? null,
    projectName: project?.name ?? null,
    projectKind: project?.kind ?? null,
    canBuild: Boolean(build.mainChoices.build),
    canRun: Boolean(build.mainChoices.run),
    canDebug: debugChoice?.kind === "debug" && debugChoice.method === "cargo",
    status: ["building", "running", "paused"].includes(debug.status) ? debug.status : build.status,
    selectedConfigName: build.selectedConfigName,
    selectedProfileName: build.selectedProfileName,
    activeFile: activeTab ? { path: activeTab.fileId, name: activeTab.name,
      language: activeTab.monacoLanguage, content: activeTab.content.slice(0, 80_000),
      dirty: activeTab.dirty, truncated: activeTab.content.length > 80_000 } : null,
    tabs: solutionState.tabs.map((tab) => ({ path: tab.fileId, name: tab.name, dirty: tab.dirty })),
    output: (debug.status !== "idle" && debug.status !== "terminated" ? debug.output : build.output).slice(-16_000),
    dirtyCount: solutionState.tabs.filter((tab) => tab.dirty).length,
    debugFrames: debug.frames,
    debugVariables: debug.variables,
    revision: currentRevision,
    rendererId,
    problems: build.problems,
    specs,
  } });
  applySnapshot(snapshot);
}

export async function startLinkedAction(action: Action): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("start_linked_action", { action });
}

export async function stopLinkedAction(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_linked_action");
}

export async function listenToLinkedWindows(): Promise<() => void> {
  const { emitTo } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const currentWindow = getCurrentWebviewWindow();
  const ownWindowLabel = currentWindow.label;
  useLinkedWindows.setState((state) => ({ ownWindowLabel, viewedWindowLabel: ownWindowLabel,
    ownInstanceId: state.ownInstanceId ?? crypto.randomUUID() }));
  const unlistenState = await currentWindow.listen<LinkedSnapshot>("craidd:linked-state", (event) => applySnapshot(event.payload));
  const unlistenTitle = await currentWindow.listen<{ title: string }>("craidd:linked-title", (event) => {
    void currentWindow.setTitle(event.payload.title).catch(() => { /* best effort */ });
  });
  const unlistenCommand = await currentWindow.listen<{ kind: "start" | "stop"; action: Action | null; actionId: number }>(
    "craidd:linked-command", (event) => {
      const command = event.payload;
      if (command.kind === "stop") {
        cancelledActions.add(command.actionId);
        void (["building", "running", "paused"].includes(useDebug.getState().status)
          ? useDebug.getState().control("stop") : useBuild.getState().stop());
        return;
      }
      if (command.action) {
        if (cancelledActions.has(command.actionId)) {
          void invoke("acknowledge_linked_action", { actionId: command.actionId, status: actionStatus(command.action) });
          return;
        }
        // Always ack, whether start succeeds or throws. If start throws
        // synchronously or rejects, we still want the backend to know.
        let acked = false;
        const ack = (status: string) => {
          if (acked) return;
          acked = true;
          void invoke("acknowledge_linked_action", { actionId: command.actionId, status })
            .catch((error) => console.error("[craidd] Linked action acknowledgement failed:", error));
        };
        Promise.resolve()
          .then(() => useBuild.getState().start(command.action!))
          .then(() => ack(actionStatus(command.action!)))
          .catch((error) => {
            console.error("[craidd] Linked action start failed:", error);
            ack("failed");
          });
      }
    },
  );
  const unlistenReveal = await currentWindow.listen<{ file: string; line: number; column: number }>(
    "craidd:linked-reveal", (event) => {
      const { file, line, column } = event.payload;
      void useSolution.getState().revealFile(file, line, column);
    },
  );
  const unlistenTarget = await currentWindow.listen<{ kind: string; value: string | null }>(
    "craidd:linked-target-command", (event) => {
      const { kind, value } = event.payload;
      if (kind === "stop") void (["building", "running", "paused"].includes(useDebug.getState().status)
        ? useDebug.getState().control("stop") : useBuild.getState().stop());
      else if (kind === "debug_control" && value && ["continue", "pause", "stepOver", "stepInto", "stepOut", "stop"].includes(value))
        void useDebug.getState().control(value as "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "stop");
      else if (kind === "select_config" && value) {
        const solution = useSolution.getState().solution;
        if (solution) selectConfiguration(solution, value);
      } else if (kind === "select_profile") useBuild.getState().setSelectedProfile(value);
      else if (kind === "reveal_file" && value) {
        try {
          const location = JSON.parse(value) as { file: string; line: number };
          if (typeof location.file === "string" && Number.isInteger(location.line) && location.line > 0) {
            void useSolution.getState().revealFile(location.file, location.line, 1);
          }
        } catch { /* Stale navigation request. */ }
      }
      else if (kind === "select_tab" && value && useSolution.getState().tabs.some((tab) => tab.fileId === value)) {
        useSolution.getState().setActiveFile(value);
      }
      else if (kind.startsWith("start_")) {
        const action = kind.slice(6);
        if (action === "build" || action === "run" || action === "debug") void useBuild.getState().start(action, value ?? undefined);
      }
    },
  );
  const unlistenPrepare = await currentWindow.listen<{ requestId: string; replyLabel: string; decision: "save" | "discard" | "inspect"; solutionPath: string }>(
    "craidd:linked-prepare", (event) => {
      const { requestId, replyLabel, decision, solutionPath } = event.payload;
      void (async () => {
        let error: string | null = null;
        try {
          if (useSolution.getState().clnPath !== solutionPath) throw new Error("The solution changed before the window could be prepared");
          if (decision !== "inspect") await prepareOwnWindow(decision);
          await publishLinkedWindow(useSolution.getState().solution, useSolution.getState().clnPath);
        } catch (cause) { error = String(cause); }
        await emitTo(replyLabel, "craidd:linked-prepare-result", { requestId, error,
          dirtyCount: useSolution.getState().tabs.filter((tab) => tab.dirty).length });
      })();
    },
  );
  // Publish after both listeners exist, so a new window receives the first snapshot.
  void publishLinkedWindow(useSolution.getState().solution, useSolution.getState().clnPath)
    .then(() => invoke("show_main_window"))
    .then(() => invoke("mark_linked_window_ready"))
    .catch((error) => console.error("[craidd] Could not register linked window:", error));
  return () => { unlistenState(); unlistenCommand(); unlistenReveal(); unlistenTarget(); unlistenPrepare(); unlistenTitle(); };
}

async function prepareOwnWindow(decision: "save" | "discard"): Promise<void> {
  const dirty = useSolution.getState().tabs.filter((tab) => tab.dirty);
  for (const tab of dirty) {
    if (decision === "discard") {
      useSolution.getState().discardTab(tab.fileId);
    } else {
      const result = await useSolution.getState().saveFile(tab.fileId);
      if (result !== "saved") throw new Error(`${result === "conflict" ? "Disk conflict" : "Could not save"}: ${tab.name}`);
    }
  }
}

export async function prepareLinkedWindow(targetLabel: string, decision: "save" | "discard" | "inspect"): Promise<number> {
  const { ownWindowLabel, windows } = useLinkedWindows.getState();
  const solutionPath = useSolution.getState().clnPath;
  if (!ownWindowLabel || !solutionPath || !windows.some((item) => item.windowLabel === targetLabel)) {
    throw new Error("That IDE window is no longer linked to this solution");
  }
  if (targetLabel === ownWindowLabel) {
    if (decision !== "inspect") await prepareOwnWindow(decision);
    await publishLinkedWindow(useSolution.getState().solution, solutionPath);
    return useSolution.getState().tabs.filter((tab) => tab.dirty).length;
  }
  const { emitTo } = await import("@tauri-apps/api/event");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const requestId = crypto.randomUUID();
  return new Promise<number>(async (resolve, reject) => {
    let done = false;
    let unlisten: (() => void) | null = null;
    const finish = (error: string | null, dirtyCount = 0) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      unlisten?.();
      if (error) reject(new Error(error)); else resolve(dirtyCount);
    };
    const timer = window.setTimeout(() => finish("The IDE window did not respond"), 30_000);
    try {
      unlisten = await getCurrentWebviewWindow().listen<{ requestId: string; error: string | null; dirtyCount: number }>("craidd:linked-prepare-result", (event) => {
        if (event.payload.requestId === requestId) finish(event.payload.error, event.payload.dirtyCount);
      });
      await emitTo(targetLabel, "craidd:linked-prepare", { requestId, replyLabel: ownWindowLabel, decision, solutionPath });
    } catch (cause) { finish(String(cause)); }
  });
}

export async function setLinkedWindowVisible(targetLabel: string, visible: boolean): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await invoke("set_linked_window_visible", { targetLabel, visible });
      return;
    } catch (error) {
      if (!visible || !String(error).includes("still closing") || attempt === 9) throw error;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
    }
  }
}

export async function focusLinkedWindow(targetLabel: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("focus_linked_window", { targetLabel });
}

export function waitForLinkedWindowReady(targetLabel: string): Promise<void> {
  if (useLinkedWindows.getState().windows.some((item) => item.windowLabel === targetLabel && item.visible && !item.restoring)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { unsubscribe(); reject(new Error("The linked IDE window did not finish opening")); }, 30_000);
    const unsubscribe = useLinkedWindows.subscribe((state) => {
      if (state.windows.some((item) => item.windowLabel === targetLabel && item.visible && !item.restoring)) {
        window.clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export async function dispatchLinkedWindowCommand(targetLabel: string, kind: string, value?: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const target = useLinkedWindows.getState().windows.find((item) => item.windowLabel === targetLabel);
  if (target && !target.visible && (kind === "select_config" || kind === "select_profile")) {
    const solutionState = useSolution.getState();
    const solution = solutionState.solution;
    if (!solution || !solutionState.rootPath) throw new Error("No solution is open");
    const configs = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
    const configName = kind === "select_config" ? value : target.selectedConfigName;
    const selected = configs.find((config) => config.name === configName);
    if (!selected) throw new Error("Configuration is no longer available");
    const profileName = kind === "select_profile" ? value ?? null : null;
    const choices = choicesForConfig(solution, selected);
    const specs: Record<string, NonNullable<ReturnType<typeof resolveSpec>>> = {};
    for (const action of ["build", "run", "debug"] as const) {
      const config = configs.find((item) => item.name === choices[action] && item.kind === action);
      if (config) {
        const spec = resolveSpec(config, solutionState.rootPath, solution, profileName);
        if (spec) specs[action] = spec;
      }
    }
    const project = solution.projects.find((candidate) => candidate.path === selected.target);
    const debugChoice = configs.find((config) => config.name === choices.debug);
    await invoke("update_parked_window_configuration", { targetLabel, update: {
      selectedConfigName: selected.name, selectedProfileName: profileName,
      projectPath: project?.path ?? null, projectName: project?.name ?? null, projectKind: project?.kind ?? null,
      canBuild: Boolean(choices.build), canRun: Boolean(choices.run),
      canDebug: debugChoice?.kind === "debug" && debugChoice.method === "cargo", specs,
    } });
    return;
  }
  await invoke("dispatch_linked_window_command", { targetLabel, kind, value: value ?? null });
}

export async function revealLinkedProblem(ownerLabel: string, problem: BuildProblem): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_linked_problem", {
    ownerLabel,
    location: { file: problem.file, line: problem.line, column: problem.column },
  });
}
