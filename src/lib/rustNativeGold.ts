import { choicesForConfig, resolveSpec } from "../store/buildStore";
import { ldiPreviewConfigs, listLdiCallSites, setupLdiBlue, refreshLdiBlues, useLdi, type LdiBlue } from "../store/ldiStore";
import { dispatchLinkedWindowCommand, focusLinkedWindow, setLinkedWindowVisible, useLinkedWindows, waitForLinkedWindowReady, type LinkedSnapshot } from "../store/linkedWindowsStore";
import { useSolution } from "../store/solutionStore";

const active = new Set(["building", "starting", "running", "paused"]);

/** Gold can orchestrate one Rust process and its Native inspector without
 * claiming that the library is a second debuggee. Ordinary linked groups keep
 * their existing Gold launch path. */
export function rustNativeGoldOwner(linked: LinkedSnapshot, blues: LdiBlue[]): string | null {
  if (linked.linked || linked.activeAction) return null;
  const owners = linked.windows.filter((item) => item.ldiRole === "live-native" && item.canDebug);
  if (owners.length !== 1) return null;
  if (linked.windows.some((item) => item.windowLabel !== owners[0].windowLabel
    && item.ldiRole !== "native-library" && item.canDebug)) return null;
  const hasNativeView = linked.windows.some((item) => item.ldiRole === "native-library");
  const hasSavedBlue = blues.some((blue) => blue.mode === "live-native" && blue.originLabel === owners[0].windowLabel);
  return hasNativeView || hasSavedBlue ? owners[0].windowLabel : null;
}

export async function nativeConfigChoices(blue: LdiBlue): Promise<string[]> {
  const sites = await listLdiCallSites(blue.file, []);
  const site = sites.find((item) => item.line === blue.line && item.entryPoint === blue.entryPoint);
  const names = new Set(ldiPreviewConfigs().map((item) => item.name));
  return (site?.configNames ?? []).filter((name) => names.has(name));
}

function preferredConfig(blue: LdiBlue, candidates: string[]): string | null {
  const { solution, rootPath, clnPath } = useSolution.getState();
  if (!solution || !rootPath) return null;
  const configs = [...solution.inferredConfigs, ...solution.configs];
  const matching = candidates.filter((name) => {
    const config = configs.find((item) => item.name === name);
    const buildName = config && choicesForConfig(solution, config).build;
    const build = configs.find((item) => item.name === buildName && item.kind === "build");
    return build && resolveSpec(build, rootPath, solution, null, clnPath)?.label === blue.library;
  });
  return matching.length === 1 ? matching[0] : null;
}

export class NativeConfigChoiceNeeded extends Error {
  constructor(public readonly blue: LdiBlue, public readonly choices: string[]) {
    super(`Choose the Native Power Config for ${blue.entryPoint}`);
  }
}

/** Restore a closed or hidden Native view for the next Rust launch. A live
 * session keeps its frozen bindings, so this never claims to rearm it mid-run. */
export async function openNativeViewForBlue(blue: LdiBlue, selectedConfig?: string, focus = true): Promise<void> {
  const linked = useLinkedWindows.getState();
  const partner = linked.windows.find((item) => item.windowLabel === blue.partnerLabel);
  if (partner?.ldiRole === "native-library") {
    if (partner.restoring) throw new Error("Wait for the Native window to finish opening");
    if (partner.dirtyCount > 0) throw new Error("Save the Native window's edits before debugging");
    if (!partner.visible) {
      await setLinkedWindowVisible(partner.windowLabel, true);
      await waitForLinkedWindowReady(partner.windowLabel);
    }
    if (focus) await focusLinkedWindow(partner.windowLabel);
    return;
  }
  const choices = await nativeConfigChoices(blue);
  if (choices.length === 0) throw new Error(`No Native Power Config currently resolves ${blue.entryPoint} at this Rust call site`);
  const config = selectedConfig ?? preferredConfig(blue, choices) ?? (choices.length === 1 ? choices[0] : null);
  if (!config || !choices.includes(config)) throw new NativeConfigChoiceNeeded(blue, choices);
  await setupLdiBlue(blue.file, blue.line, config);
  if (focus) {
    const opened = useLinkedWindows.getState().windows.find((item) => item.ldiRole === "native-library"
      && item.selectedConfigName === config && item.solutionPath === useSolution.getState().clnPath);
    if (opened) await focusLinkedWindow(opened.windowLabel);
  }
}

/** Prepare every eligible saved Blue before launching. The first qualified
 * native stop then focuses B through the existing backend stop router. */
export async function startRustNativeGold(ownerLabel: string, selected?: { blue: LdiBlue; config: string }): Promise<void> {
  const linked = useLinkedWindows.getState();
  const owner = linked.windows.find((item) => item.windowLabel === ownerLabel);
  if (!owner || owner.ldiRole !== "live-native" || !owner.canDebug) throw new Error("Select one Rust Debug Power Config");
  if (active.has(owner.status)) throw new Error("Stop the current Rust debugger before starting Gold Debug");
  if (owner.restoring || !owner.visible) throw new Error("Show the Rust window before starting Debug");
  const blues = useLdi.getState().blues.filter((blue) => blue.mode === "live-native"
    && blue.originLabel === ownerLabel && !blue.unreachable);
  if (blues.length === 0) throw new Error("Set a reachable Blue Native Breakpoint on a Rust call first");
  const preparedPartners = new Set<string>();
  for (const blue of blues) {
    if (preparedPartners.has(blue.partnerLabel)) continue;
    if (blue.warning && !blue.warning.includes("no longer open") && !blue.warning.includes("Show the Native window")) continue;
    await openNativeViewForBlue(blue, selected?.blue.file === blue.file && selected.blue.line === blue.line ? selected.config : undefined, false);
    preparedPartners.add(blue.partnerLabel);
  }
  await refreshLdiBlues();
  const current = useLdi.getState().blues.filter((blue) => blue.mode === "live-native"
    && blue.originLabel === ownerLabel && !blue.unreachable && !blue.warning);
  if (current.length === 0) throw new Error("No Blue Native Breakpoint is ready. Review the Native Power Config and the marker warning.");
  await focusLinkedWindow(ownerLabel);
  if (ownerLabel === linked.ownWindowLabel) {
    const { useBuild } = await import("../store/buildStore");
    await useBuild.getState().start("debug");
    const { useDebug } = await import("../store/debugStore");
    const status = useDebug.getState().status;
    if (!active.has(status)) throw new Error("Rust Debug could not start. Check the Output panel in the Rust window.");
  } else {
    await dispatchLinkedWindowCommand(ownerLabel, "start_debug");
    await waitForOwnerLaunch(ownerLabel);
  }
}

function waitForOwnerLaunch(ownerLabel: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      unsubscribe(); window.clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      const owner = useLinkedWindows.getState().windows.find((item) => item.windowLabel === ownerLabel);
      if (!owner) finish(new Error("The Rust window closed before Debug started"));
      else if (active.has(owner.status)) finish();
      else if (owner.status === "error" || owner.status === "failed") finish(new Error("Rust Debug could not start. Check the Output panel in the Rust window."));
    };
    const unsubscribe = useLinkedWindows.subscribe(check);
    const timer = window.setTimeout(() => finish(new Error("Rust Debug did not report a launch. Check the Rust window's Output panel.")), 15_000);
    check();
  });
}
