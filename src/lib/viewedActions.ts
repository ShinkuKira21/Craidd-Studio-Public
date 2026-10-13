import { choicesForConfig, selectConfiguration, useBuild } from "../store/buildStore";
import { useDebug } from "../store/debugStore";
import { dispatchLinkedWindowCommand, useLinkedWindows } from "../store/linkedWindowsStore";
import { useSolution } from "../store/solutionStore";
import { controlNativeInspection, currentNativeInspection } from "../store/nativeDebugStore";

type Action = "build" | "run" | "debug";
type DebugControl = "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "stop";

function viewedHiddenWindow() {
  const linked = useLinkedWindows.getState();
  return linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel
    && item.windowLabel !== linked.ownWindowLabel && !item.visible && !item.restoring);
}

export async function selectViewedConfiguration(name: string): Promise<void> {
  const remote = viewedHiddenWindow();
  if (remote) {
    await dispatchLinkedWindowCommand(remote.windowLabel, "select_config", name);
  } else {
    const solution = useSolution.getState().solution;
    if (solution) selectConfiguration(solution, name);
  }
}

export async function selectViewedProfile(name: string | null): Promise<void> {
  const remote = viewedHiddenWindow();
  if (remote) await dispatchLinkedWindowCommand(remote.windowLabel, "select_profile", name ?? undefined);
  else useBuild.getState().setSelectedProfile(name);
}

export async function startViewedAction(action: Action, configName?: string): Promise<void> {
  if (currentNativeInspection()) throw new Error("This Native window is inspecting the Rust process. Stop that debug session before rebuilding or launching here.");
  const remote = viewedHiddenWindow();
  if (!remote) { await useBuild.getState().start(action, configName); return; }
  if (["starting", "building", "running", "paused"].includes(remote.status)) {
    throw new Error("The hidden process is already active. Stop it before starting another action.");
  }
  if (useSolution.getState().tabs.some((tab) => tab.dirty)) {
    throw new Error("Save this window's edited files before starting the hidden process.");
  }
  if (remote.dirtyCount > 0) throw new Error("The hidden window has unsaved files. Show it and save them first.");
  if (configName) {
    const solution = useSolution.getState().solution;
    const configs = [...(solution?.inferredConfigs ?? []), ...(solution?.configs ?? [])];
    const selected = configs.find((item) => item.name === remote.selectedConfigName);
    const currentChoice = selected && solution ? choicesForConfig(solution, selected)[action] : null;
    if (configName !== currentChoice) {
      await dispatchLinkedWindowCommand(remote.windowLabel, "select_config", configName);
    }
  }
  await dispatchLinkedWindowCommand(remote.windowLabel, `start_${action}`);
}

export async function stopViewedAction(): Promise<void> {
  if (currentNativeInspection()) { await controlNativeInspection("stop"); return; }
  const linked = useLinkedWindows.getState();
  const targetLabel = linked.viewedWindowLabel ?? linked.ownWindowLabel;
  if (linked.activeAction && targetLabel && linked.members.some((member) => member.windowLabel === targetLabel)) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_linked_member", { targetLabel });
    return;
  }
  const remote = viewedHiddenWindow();
  if (remote) { await dispatchLinkedWindowCommand(remote.windowLabel, "stop"); return; }
  if (["building", "starting", "running", "paused"].includes(useDebug.getState().status)) {
    await useDebug.getState().control("stop");
  } else {
    await useBuild.getState().stop();
  }
}

export async function controlViewedDebug(action: DebugControl): Promise<void> {
  if (currentNativeInspection()) { await controlNativeInspection(action); return; }
  const remote = viewedHiddenWindow();
  if (remote) await dispatchLinkedWindowCommand(remote.windowLabel, "debug_control", action);
  else await useDebug.getState().control(action);
}

/** Debug status of the session the keys act on: native inspection, a hidden viewed window, or this window. */
export function viewedDebugStatus(): string {
  const native = currentNativeInspection();
  if (native) return native.status;
  const remote = viewedHiddenWindow();
  if (remote) return remote.status;
  return useDebug.getState().status;
}

/** F5 starts debugging, or continues when the viewed session is paused. Keys never start a second session. */
export async function debugOrContinueViewed(): Promise<void> {
  const status = viewedDebugStatus();
  if (status === "paused") { await controlViewedDebug("continue"); return; }
  if (["building", "starting", "running"].includes(status)) return;
  const local = !currentNativeInspection() && !viewedHiddenWindow();
  if (local && ["building", "starting", "running", "paused"].includes(useBuild.getState().status)) return;
  await startViewedAction("debug");
}

/** Pause and step keys apply only in the state where they mean something. */
export async function debugKeyViewed(action: "pause" | "stepOver" | "stepInto" | "stepOut"): Promise<void> {
  const status = viewedDebugStatus();
  if (action === "pause" ? status !== "running" : status !== "paused") return;
  await controlViewedDebug(action);
}
