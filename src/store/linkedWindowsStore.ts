import { create } from "zustand";
import type { CraiddSolution } from "../types/project";
import { selectConfiguration, useBuild } from "./buildStore";
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
  instanceId: string;
  projectName: string;
  status: string;
  visible: boolean;
  selectedConfigName: string | null;
  selectedProfileName: string | null;
  activeFile: { path: string; name: string; language: string; content: string; dirty: boolean } | null;
  tabs: { path: string; name: string; dirty: boolean }[];
  output: string;
  dirtyCount: number;
  pausedLine: number | null;
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

export const useLinkedWindows = create<LinkedSnapshot & LinkedView>((set, get) => ({
  ...empty, ownWindowLabel: null, ownInstanceId: null, viewedWindowLabel: null,
  selectWindow: async (label) => {
    const previous = get().viewedWindowLabel;
    set({ viewedWindowLabel: label });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("view_linked_window", { targetLabel: label });
    } catch (error) { set({ viewedWindowLabel: previous }); throw error; }
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
      language: activeTab.monacoLanguage, content: activeTab.content, dirty: activeTab.dirty } : null,
    tabs: solutionState.tabs.map((tab) => ({ path: tab.fileId, name: tab.name, dirty: tab.dirty })),
    output: (debug.status !== "idle" && debug.status !== "terminated" ? debug.output : build.output).slice(-50_000),
    dirtyCount: solutionState.tabs.filter((tab) => tab.dirty).length,
    debugFrames: debug.frames,
    debugVariables: debug.variables,
    revision: currentRevision,
    problems: build.problems,
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
  const { listen, emitTo } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const ownWindowLabel = getCurrentWindow().label;
  useLinkedWindows.setState((state) => ({ ownWindowLabel, viewedWindowLabel: ownWindowLabel,
    ownInstanceId: state.ownInstanceId ?? crypto.randomUUID() }));
  const unlistenState = await listen<LinkedSnapshot>("craidd:linked-state", (event) => applySnapshot(event.payload));
  const unlistenCommand = await listen<{ kind: "start" | "stop"; action: Action | null; actionId: number }>(
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
        void useBuild.getState().start(command.action).finally(() => {
          if (cancelledActions.has(command.actionId)) {
            void (["building", "running", "paused"].includes(useDebug.getState().status)
              ? useDebug.getState().control("stop") : useBuild.getState().stop());
          }
          void invoke("acknowledge_linked_action", { actionId: command.actionId, status: actionStatus(command.action!) })
            .catch((error) => console.error("[craidd] Linked action acknowledgement failed:", error));
        });
      }
    },
  );
  const unlistenReveal = await listen<{ file: string; line: number; column: number }>(
    "craidd:linked-reveal", (event) => {
      const { file, line, column } = event.payload;
      void useSolution.getState().revealFile(file, line, column);
    },
  );
  const unlistenTarget = await listen<{ kind: string; value: string | null }>(
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
  const unlistenPrepare = await listen<{ requestId: string; replyLabel: string; decision: "save" | "discard"; solutionPath: string }>(
    "craidd:linked-prepare", (event) => {
      const { requestId, replyLabel, decision, solutionPath } = event.payload;
      void (async () => {
        let error: string | null = null;
        try {
          if (useSolution.getState().clnPath !== solutionPath) throw new Error("The solution changed before the window could be prepared");
          await prepareOwnWindow(decision);
          await publishLinkedWindow(useSolution.getState().solution, useSolution.getState().clnPath);
        } catch (cause) { error = String(cause); }
        await emitTo(replyLabel, "craidd:linked-prepare-result", { requestId, error });
      })();
    },
  );
  // Publish after both listeners exist, so a new window receives the first snapshot.
  void publishLinkedWindow(useSolution.getState().solution, useSolution.getState().clnPath)
    .catch((error) => console.error("[craidd] Could not register linked window:", error));
  return () => { unlistenState(); unlistenCommand(); unlistenReveal(); unlistenTarget(); unlistenPrepare(); };
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

export async function prepareLinkedWindow(targetLabel: string, decision: "save" | "discard"): Promise<void> {
  const { ownWindowLabel, windows } = useLinkedWindows.getState();
  const solutionPath = useSolution.getState().clnPath;
  if (!ownWindowLabel || !solutionPath || !windows.some((item) => item.windowLabel === targetLabel)) {
    throw new Error("That IDE window is no longer linked to this solution");
  }
  if (targetLabel === ownWindowLabel) {
    await prepareOwnWindow(decision);
    await publishLinkedWindow(useSolution.getState().solution, solutionPath);
    return;
  }
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  const requestId = crypto.randomUUID();
  await new Promise<void>(async (resolve, reject) => {
    let done = false;
    let unlisten: (() => void) | null = null;
    const finish = (error: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      unlisten?.();
      if (error) reject(new Error(error)); else resolve();
    };
    const timer = window.setTimeout(() => finish("The IDE window did not respond"), 30_000);
    try {
      unlisten = await listen<{ requestId: string; error: string | null }>("craidd:linked-prepare-result", (event) => {
        if (event.payload.requestId === requestId) finish(event.payload.error);
      });
      await emitTo(targetLabel, "craidd:linked-prepare", { requestId, replyLabel: ownWindowLabel, decision, solutionPath });
    } catch (cause) { finish(String(cause)); }
  });
}

export async function setLinkedWindowVisible(targetLabel: string, visible: boolean): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_linked_window_visible", { targetLabel, visible });
}

export async function dispatchLinkedWindowCommand(targetLabel: string, kind: string, value?: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("dispatch_linked_window_command", { targetLabel, kind, value: value ?? null });
}

export async function startViewedAction(action: Action): Promise<void> {
  const state = useLinkedWindows.getState();
  const target = state.viewedWindowLabel;
  if (target && target !== state.ownWindowLabel) {
    await dispatchLinkedWindowCommand(target, `start_${action}`);
  } else {
    await useBuild.getState().start(action);
  }
}

export async function stopViewedAction(): Promise<void> {
  const state = useLinkedWindows.getState();
  const target = state.viewedWindowLabel;
  if (target && target !== state.ownWindowLabel) {
    await dispatchLinkedWindowCommand(target, "stop");
  } else if (["building", "running", "paused"].includes(useDebug.getState().status)) {
    await useDebug.getState().control("stop");
  } else {
    await useBuild.getState().stop();
  }
}

export async function revealLinkedProblem(ownerLabel: string, problem: BuildProblem): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_linked_problem", {
    ownerLabel,
    location: { file: problem.file, line: problem.line, column: problem.column },
  });
}
