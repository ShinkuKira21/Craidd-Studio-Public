import { publishLinkedWindow, prepareLinkedWindow, useLinkedWindows } from "../store/linkedWindowsStore";
import { useSolution } from "../store/solutionStore";
import { saveRestartPlan, type SaveRestartPlan } from "./saveRestartPolicy";

export async function planFileRestart(file: string): Promise<SaveRestartPlan | null> {
  const { solution, clnPath } = useSolution.getState();
  if (!solution || !clnPath) return null;
  await publishLinkedWindow(solution, clnPath);
  return saveRestartPlan(file, solution, useLinkedWindows.getState());
}

export async function restartSessions(plan: SaveRestartPlan): Promise<void> {
  // Normal launch already saves dirty files. Prepare every window being
  // restarted before stopping any process, so a conflict cannot leave half
  // the linked application shut down.
  for (const target of plan.targets) {
    const item = useLinkedWindows.getState().windows.find((window) => window.windowLabel === target.windowLabel);
    if (!item || item.instanceId !== target.instanceId) throw new Error("A window changed; review the restart again.");
    if (item.visible) await prepareLinkedWindow(target.windowLabel, "save");
    else if (item.dirtyCount > 0) throw new Error(`Save the edited files in CS${item.windowId} before restarting.`);
  }
  const { solution, clnPath } = useSolution.getState();
  await publishLinkedWindow(solution, clnPath);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("restart_linked_sessions", { request: plan });
}
