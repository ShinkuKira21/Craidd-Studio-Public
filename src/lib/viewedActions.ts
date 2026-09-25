import { choicesForConfig, selectConfiguration, useBuild } from "../store/buildStore";
import { useDebug } from "../store/debugStore";
import { dispatchLinkedWindowCommand, useLinkedWindows } from "../store/linkedWindowsStore";
import { useSolution } from "../store/solutionStore";

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
  const remote = viewedHiddenWindow();
  if (remote) { await dispatchLinkedWindowCommand(remote.windowLabel, "stop"); return; }
  if (["building", "running", "paused"].includes(useDebug.getState().status)) {
    await useDebug.getState().control("stop");
  } else {
    await useBuild.getState().stop();
  }
}

export async function controlViewedDebug(action: DebugControl): Promise<void> {
  const remote = viewedHiddenWindow();
  if (remote) await dispatchLinkedWindowCommand(remote.windowLabel, "debug_control", action);
  else await useDebug.getState().control(action);
}
