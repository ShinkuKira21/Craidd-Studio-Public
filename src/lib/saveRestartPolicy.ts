import type { CraiddSolution, ConfigEntry } from "../types/project";
import type { LinkedMember, LinkedSnapshot } from "../store/linkedWindowsStore";

export type RestartAction = "run" | "debug";
export interface RestartTarget {
  windowLabel: string;
  instanceId: string;
  configName: string | null;
  profileName: string | null;
  action: RestartAction;
}
export interface SaveRestartPlan {
  scope: "gold" | "white";
  actionId: number | null;
  targets: RestartTarget[];
  affected: string[];
  reason: string;
}

function path(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}
function within(file: string, root: string): boolean { return file === root || file.startsWith(root + "/"); }
function folder(root: string, relative: string): string {
  return path(relative.startsWith("/") ? relative : `${root}/${relative}`);
}
function sourceRoots(solution: CraiddSolution, config: ConfigEntry, action: RestartAction): string[] {
  const configs = [...solution.inferredConfigs, ...solution.configs];
  const roots = new Set<string>();
  const visited = new Set<string>();
  const visit = (current: ConfigEntry) => {
    if (visited.has(current.name)) return;
    visited.add(current.name);
    const project = solution.projects.find((item) => item.path === current.target);
    if (project) roots.add(folder(solution.root, project.folder));
    else if (current.target === "." && current.method !== "plan" && !current.slots) roots.add(path(solution.root));
    if (current.cwd) roots.add(folder(solution.root, current.cwd));
    const references = [current.slots?.build, current.slots?.[action], current.order?.before,
      ...(current.order?.steps ?? []).flatMap((step) => step.kind === "install"
        ? [step.configuration, step.destination] : [step.configuration])];
    for (const name of references) {
      const next = configs.find((item) => item.name === name);
      if (next) visit(next);
    }
  };
  visit(config);
  return [...roots];
}
function target(item: LinkedMember, action: RestartAction): RestartTarget {
  return { windowLabel: item.windowLabel, instanceId: item.instanceId,
    configName: item.selectedConfigName, profileName: item.selectedProfileName, action };
}

/** Source ownership and explicit build dependencies determine restart scope.
 * Readiness relationships do not make a client own its server's source. */
export function saveRestartPlan(file: string, solution: CraiddSolution, linked: LinkedSnapshot): SaveRestartPlan | null {
  if (/\.(md|rst)$/i.test(file)) return null;
  const source = path(file);
  const configs = [...solution.inferredConfigs, ...solution.configs];
  const owningRoots = solution.projects.map((item) => folder(solution.root, item.folder))
    .filter((root) => within(source, root));
  const ownerLength = Math.max(0, ...owningRoots.map((root) => root.length));
  const live = (item: LinkedMember) => ["waiting", "starting", "building", "running", "paused"].includes(item.status);
  const groupAction = linked.activeAction;
  const inGroup = (item: LinkedMember) => linked.members.some((member) =>
    member.windowLabel === item.windowLabel && member.instanceId === item.instanceId);
  const liveManagedPair = groupAction === "debug" && linked.activeActionId !== null
    && linked.windows.some((item) => item.ldiRole === "managed" && live(item) && inGroup(item));
  // A native driver is transient: completion or White Stop B must not detach
  // its source from the still-live Gold LDI session between Blue hits.
  const active = linked.windows.filter((item) => live(item)
    || (liveManagedPair && item.ldiRole === "native-library" && inGroup(item)));
  const actionFor = (item: LinkedMember): RestartAction | null => {
    const action = item.activeAction ?? (item.debugging ? "debug"
      : inGroup(item) ? groupAction : null);
    return action === "run" || action === "debug" ? action : null;
  };
  const affected = active.filter((item) => {
    const action = actionFor(item);
    const config = configs.find((entry) => entry.name === item.selectedConfigName);
    if (!action || !config) return false;
    if (source.endsWith(".cln") && within(source, path(solution.root))) return true;
    return sourceRoots(solution, config, action).some((root) => root.length >= ownerLength && within(source, root));
  });
  if (!affected.length) return null;
  const grouped = affected.every(inGroup);
  const ldi = groupAction === "debug" && linked.members.some((item) => item.ldiRole === "native-library")
    && linked.members.some((item) => item.ldiRole === "managed")
    && affected.some((item) => item.ldiRole === "managed" || item.ldiRole === "native-library");
  const startup = affected.some((item) => ["waiting", "starting", "building"].includes(item.status));
  if (grouped && (groupAction === "run" || groupAction === "debug") && (ldi || affected.length > 1 || startup)) {
    return { scope: "gold", actionId: linked.activeActionId,
      targets: linked.members.map((item) => target(item, groupAction)), affected: affected.map((item) => item.windowLabel),
      reason: ldi ? "This file belongs to an LDI pair. Gold restart rebuilds and rearms the linked debug session."
        : startup ? "Linked startup is still in progress. Gold restart preserves launch order and readiness checks."
          : "This file is used by several linked processes. Gold restart applies it to the linked session." };
  }
  return { scope: "white", actionId: linked.activeActionId,
    targets: affected.map((item) => target(item, actionFor(item)!)), affected: affected.map((item) => item.windowLabel),
    reason: affected.length === 1 ? "Only this process uses the edited file. Other windows keep running."
      : "Restart the processes using this file; other windows keep running." };
}

export function restartLabel(plan: SaveRestartPlan): string {
  const actions = [...new Set(plan.targets.map((item) => item.action))];
  const action = actions.length === 1 ? actions[0] === "debug" ? "Debug" : "Run" : "Processes";
  return plan.scope === "gold" ? `Gold Restart ${action}`
    : plan.targets.length === 1 ? `White Restart ${action}` : `Restart ${plan.targets.length} Processes`;
}
