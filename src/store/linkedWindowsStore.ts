import { create } from "zustand";
import type { CraiddSolution } from "../types/project";
import { useBuild } from "./buildStore";
import { useSolution } from "./solutionStore";
import type { BuildProblem } from "../lib/buildDiagnostics";

type Action = "build" | "run" | "debug";

export interface LinkedSnapshot {
  sequence: number;
  linked: boolean;
  members: { windowLabel: string; projectName: string }[];
  canBuild: boolean;
  canRun: boolean;
  canDebug: boolean;
  busy: boolean;
  activeAction: Action | null;
  problems: (BuildProblem & { windowLabel: string; projectName: string })[];
}

const empty: LinkedSnapshot = {
  sequence: 0, linked: false, members: [], canBuild: false,
  canRun: false, canDebug: false, busy: false, activeAction: null,
  problems: [],
};

export const useLinkedWindows = create<LinkedSnapshot>(() => empty);

function applySnapshot(snapshot: LinkedSnapshot) {
  if (snapshot.sequence >= useLinkedWindows.getState().sequence) {
    useLinkedWindows.setState(snapshot);
  }
}

let revision = 0;
const cancelledActions = new Set<number>();

export async function publishLinkedWindow(solution: CraiddSolution | null, clnPath: string | null): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  const build = useBuild.getState();
  const configs = [...(solution?.inferredConfigs ?? []), ...(solution?.configs ?? [])];
  const selected = configs.find((config) => config.name === build.selectedConfigName);
  const project = solution?.projects.find((candidate) => candidate.path === selected?.target);
  const currentRevision = ++revision;
  const snapshot = await invoke<LinkedSnapshot>("update_linked_window", { update: {
    solutionPath: clnPath,
    projectPath: project?.path ?? null,
    projectName: project?.name ?? null,
    projectKind: project?.kind ?? null,
    canBuild: Boolean(build.mainChoices.build),
    canRun: Boolean(build.mainChoices.run),
    status: build.status,
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
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const unlistenState = await listen<LinkedSnapshot>("craidd:linked-state", (event) => applySnapshot(event.payload));
  const unlistenCommand = await listen<{ kind: "start" | "stop"; action: Action | null; actionId: number }>(
    "craidd:linked-command", (event) => {
      const command = event.payload;
      if (command.kind === "stop") {
        cancelledActions.add(command.actionId);
        void useBuild.getState().stop();
        return;
      }
      if (command.action) {
        if (cancelledActions.has(command.actionId)) {
          void invoke("acknowledge_linked_action", { actionId: command.actionId, status: useBuild.getState().status });
          return;
        }
        void useBuild.getState().start(command.action).finally(() => {
          if (cancelledActions.has(command.actionId)) void useBuild.getState().stop();
          void invoke("acknowledge_linked_action", { actionId: command.actionId, status: useBuild.getState().status })
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
  // Publish after both listeners exist, so a new window receives the first snapshot.
  void publishLinkedWindow(useSolution.getState().solution, useSolution.getState().clnPath)
    .catch((error) => console.error("[craidd] Could not register linked window:", error));
  return () => { unlistenState(); unlistenCommand(); unlistenReveal(); };
}

export async function revealLinkedProblem(ownerLabel: string, problem: BuildProblem): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("reveal_linked_problem", {
    ownerLabel,
    location: { file: problem.file, line: problem.line, column: problem.column },
  });
}
