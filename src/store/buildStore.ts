import { create } from "zustand";
import { useSolution } from "./solutionStore";
import { decodeBuildLine, type BuildProblem } from "../lib/buildDiagnostics";

type Profile = "debug" | "release";
type Status = "idle" | "starting" | "running" | "success" | "failed" | "cancelled";

interface BuildEvent {
  sessionId: number;
  kind: "start" | "output" | "artifact" | "finish" | "cancelled" | "error" | "crashed";
  text: string | null;
  exitCode: number | null;
}

interface MainChoices {
  build: string | null;
  run: string | null;
  debug: string | null;
}

interface BuildState {
  projectPath: string | null;
  selectedConfigName: string | null;
  selectedProfileName: string | null;
  activeConfigName: string | null;
  mainChoices: MainChoices;
  setSelectedProfile: (name: string | null) => void;
  profile: Profile;
  status: Status;
  activeId: number | null;
  output: string;
  artifact: string | null;
  problems: BuildProblem[];
  activeCwd: string | null;
  action: "build" | "run" | "debug" | null;
  setProjectPath: (path: string) => void;
  setProfile: (profile: Profile) => void;
  start: (action: "build" | "run" | "debug", configName?: string) => Promise<void>;
  stop: () => Promise<void>;
  saveDefault: () => Promise<void>;
}

let eventListener: Promise<void> | null = null;

async function ensureEvents() {
  if (eventListener) return eventListener;
  eventListener = import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) =>
    // The module-level event.listen() target is Any, so every renderer accepted
    // every window's targeted runner events. Scope the subscription itself to
    // this WebviewWindow; session ids are only meaningful within their owner.
    getCurrentWebviewWindow().listen<BuildEvent>("craidd:build", (event) => {
      const message = event.payload;
      useBuild.setState((state) => {
        if (message.kind !== "start" && state.activeId !== message.sessionId) return state;
        if (message.kind === "start") return { activeId: message.sessionId, status: "running", output: `${message.text ?? "Cargo started"}\n` };
        if (message.kind === "output") {
          const decoded = decodeBuildLine(message.text ?? "", state.activeCwd ?? "");
          return {
            output: decoded.display === null ? state.output : (state.output + decoded.display + "\n").slice(-150_000),
            artifact: decoded.artifact ?? state.artifact,
            problems: decoded.problem ? [...state.problems, decoded.problem].slice(-500) : state.problems,
          };
        }
        if (message.kind === "artifact") return { artifact: message.text, output: state.output + `Artifact: ${message.text}\n` };
        if (message.kind === "cancelled") return { activeId: null, status: "cancelled", activeConfigName: null, output: state.output + "Cancelled.\n" };
        if (message.kind === "crashed") return { activeId: null, status: "failed", activeConfigName: null, output: state.output + (message.text ?? "Process crashed.\n") + "\n" };
        if (message.kind === "error") return { activeId: null, status: "failed", activeConfigName: null, output: state.output + `Error: ${message.text}\n` };
        return {
          activeId: null,
          status: message.exitCode === 0 ? "success" : "failed",
          activeConfigName: null,
          output: state.output + `Process exited with code ${message.exitCode ?? "unknown"}.\n`,
        };
      });
    })
  ).then(() => undefined).catch((error) => { eventListener = null; throw error; });
  return eventListener;
}

export function listenToBuildEvents(): Promise<void> { return ensureEvents(); }


import type { ConfigEntry, CraiddSolution } from "../types/project";

export interface RunSpec {
  label: string;
  program: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  linked?: ConfigEntry["linked"];
}

/**
 * Resolve a Configuration to a RunSpec. This is the minimal resolver
 * for Stage C.3. It handles:
 *   - config.command: a literal shell-style command line.
 *   - config.method: a tool-category guess, matched against the
 *     project's folder for a reasonable cwd.
 *
 * Later stages will move this to Rust and enrich it (toolchain path
 * lookup, profile application, composed step expansion). For now it
 * is deliberately small and honest: it either knows what to do, or
 * it returns null and the toolbar shows a failure message.
 */
export function resolveSpec(
  config: ConfigEntry,
  solutionRoot: string,
  solution: CraiddSolution,
  selectedProfileName: string | null,
): RunSpec | null {
  const root = solutionRoot.replace(/\/+$/, "");

  // Target folder: either the whole solution or a specific project.
  let cwd = root;
  if (config.target && config.target !== ".") {
    const project = solution.projects.find((p) => p.path === config.target);
    if (project) {
      const folder = project.folder === "." || project.folder === ""
        ? ""
        : "/" + project.folder.replace(/^\/+/, "");
      cwd = root + folder;
    }
  }
  if (config.cwd) {
    cwd = root + "/" + config.cwd.replace(/^\/+/, "");
  }

  // Profile env (from the selected profile, if any).
  const profiles = config.profiles ?? [];
  const chosen = profiles.find((p) => p.name === selectedProfileName)
    ?? profiles.find((p) => p.name === config.defaultProfile)
    ?? profiles[0];
  const env: Record<string, string> = { ...(chosen?.env ?? {}) };
  const profileArgs = chosen?.args ?? [];

  // Explicit command wins.
  if (config.command && config.command.trim()) {
    const parts = parseCommandLine(config.command.trim());
    if (parts.length === 0) return null;
    const [program, ...rest] = parts;
    const cargoJson = config.origin === "inferred" && config.method === "cargo"
      && config.kind === "build" && (rest[0] === "build" || rest[0] === "check")
      && !rest.some((arg) => arg.startsWith("--message-format"));
    const args = [...rest, ...profileArgs, ...(cargoJson ? ["--message-format=json"] : [])];
    return {
      label: [program, ...args].join(" "),
      program,
      args,
      env,
      cwd,
      linked: config.linked,
    };
  }

  // Method-based fallback for the cases we know.
  switch (config.method) {
    case "cargo":
      return {
        label: `cargo ${config.kind === "run" ? "run" : "build"}${profileArgs.length ? " " + profileArgs.join(" ") : ""}${config.kind === "build" ? " --message-format=json" : ""}`,
        program: "cargo",
        args: [config.kind === "run" ? "run" : "build", ...profileArgs,
          ...(config.kind === "build" ? ["--message-format=json"] : [])],
        env,
        cwd,
        linked: config.linked,
      };
    case "npm":
      return { label: "npm run dev", program: "npm", args: ["run", "dev", ...profileArgs], env, cwd, linked: config.linked };
    case "dotnet":
      return {
        label: `dotnet ${config.kind === "run" ? "run" : "build"}${profileArgs.length ? " " + profileArgs.join(" ") : ""}`,
        program: "dotnet",
        args: [config.kind === "run" ? "run" : "build", ...profileArgs],
        env,
        cwd,
        linked: config.linked,
      };
    case "cmake":
      return { label: "cmake --build build", program: "cmake", args: ["--build", "build", ...profileArgs], env, cwd, linked: config.linked };
    case "shell":
      return null; // shell method requires config.command, which was absent above
    default:
      return null;
  }
}

/** Very small argv parser: whitespace-separated, respects single and
 *  double quotes. Not a full shell parser — the user's command is a
 *  literal, not a script. */
function parseCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}


/**
 * Resolve which configuration each toolbar button should fire when
 * `selected` is the current chip choice.
 *
 * Two cases:
 *
 *   1. best_fit entries carry `relatedProjects` — the list of project
 *      paths whose configs form this family. Look up siblings by
 *      related_projects, not by target. This is why "Tauri Dev"
 *      lights up Build, Run, and Debug at once even though its own
 *      target is only the frontend.
 *
 *   2. A project config has no related_projects. Its siblings are the
 *      other configs of the same target (the existing lookup).
 */
export function choicesForConfig(solution: CraiddSolution, selected: ConfigEntry): MainChoices {
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];

  if (selected.slots) {
    const resolve = (kind: keyof MainChoices) => {
      const name = selected.slots?.[kind];
      return all.find((candidate) => candidate.name === name && candidate.kind === kind && !candidate.slots)?.name ?? null;
    };
    return { build: resolve("build"), run: resolve("run"), debug: resolve("debug") };
  }

  if (selected.bestFit && (selected.relatedProjects?.length ?? 0) > 0) {
    const family = new Set(selected.relatedProjects);
    const inFamily = all.filter((c) =>
      c.bestFit &&
      c.relatedProjects?.length === family.size &&
      c.relatedProjects.every((project) => family.has(project))
    );
    const choose = (kind: keyof MainChoices) => {
      if (selected.kind === kind) return selected.name;
      const hit = inFamily.find((c) => c.kind === kind);
      return hit?.name ?? null;
    };
    return { build: choose("build"), run: choose("run"), debug: choose("debug") };
  }

  const forTarget = all.filter((candidate) => candidate.target === selected.target && !candidate.bestFit);
  const choose = (kind: keyof MainChoices) => {
    if (selected.kind === kind) return selected.name;
    return (forTarget.find((candidate) => candidate.kind === kind && candidate.origin === "user")
      ?? forTarget.find((candidate) => candidate.kind === kind))?.name ?? null;
  };
  return { build: choose("build"), run: choose("run"), debug: choose("debug") };
}

export function selectConfiguration(solution: CraiddSolution, name: string): void {
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  const selected = all.find((candidate) => candidate.name === name);
  if (!selected) return;
  useBuild.setState({
    selectedConfigName: selected.name,
    selectedProfileName: null,
    mainChoices: choicesForConfig(solution, selected),
  });
}

/** Keep the current project's actions in sync after configurations are edited. */
export function syncMainChoices(solution: CraiddSolution): void {
  const selectedName = useBuild.getState().selectedConfigName;
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  const selected = all.find((candidate) => candidate.name === selectedName);
  if (!selected) {
    seedMainChoices(solution);
    return;
  }
  const next = choicesForConfig(solution, selected);
  const current = useBuild.getState().mainChoices;
  if (next.build !== current.build || next.run !== current.run || next.debug !== current.debug) {
    useBuild.setState({ mainChoices: next });
  }
}

/** Establish this window's context from an explicit solution default, then inference. */
export function seedMainChoices(solution: CraiddSolution): void {
  useBuild.setState({ problems: [], activeCwd: null });
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  const preferred = all.find((candidate) => candidate.name === solution.defaultConfig)
    ?? all.find((candidate) => candidate.target === solution.defaultProject && candidate.kind === "run")
    ?? all.find((candidate) => candidate.target === solution.defaultProject)
    ?? all.find((candidate) => candidate.bestFit && candidate.kind === "run")
    ?? all.find((candidate) => candidate.kind === "run")
    ?? all[0];
  if (preferred) selectConfiguration(solution, preferred.name);
  else useBuild.setState({ selectedConfigName: null, selectedProfileName: null,
    mainChoices: { build: null, run: null, debug: null } });
}

export const useBuild = create<BuildState>((set, get) => ({
  projectPath: null,
  selectedConfigName: null,
  selectedProfileName: null,
  activeConfigName: null,
  mainChoices: { build: null, run: null, debug: null },
  setSelectedProfile: (name) => set({ selectedProfileName: name }),
  profile: "debug",
  status: "idle",
  activeId: null,
  output: "",
  artifact: null,
  problems: [],
  activeCwd: null,
  action: null,
  setProjectPath: (projectPath) => set({ projectPath }),
  setProfile: (profile) => set({ profile }),
  start: async (action, configName) => {
    const state = get();
    const { solution, rootPath } = useSolution.getState();
    if (!solution || !rootPath) {
      set({ status: "failed", output: "No solution is open.\n" });
      return;
    }

    const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];

    // A chevron fires once. The main button only uses this window's selected project.
    let chosen: typeof all[number] | null = null;
    if (configName) {
      chosen = all.find((c) => c.name === configName) ?? null;
    } else {
      const main = state.mainChoices[action];
      if (main) chosen = all.find((c) => c.name === main) ?? null;
    }

    if (!chosen) {
      const msg = configName
        ? `Configuration not found: ${configName}\n`
        : `No ${action} configuration available.\n`;
      set({ status: "failed", output: msg });
      return;
    }

    if (chosen.kind !== action) {
      set({
        status: "failed",
        output: `"${chosen.name}" is a ${chosen.kind} configuration — cannot ${action} it.\n`,
      });
      return;
    }

    if (state.activeId !== null || state.status === "starting") return;

    // The launched program must match the source currently visible in the
    // editor. A conflict blocks launch instead of overwriting another view.
    for (const tab of useSolution.getState().tabs.filter((tab) => tab.dirty)) {
      const result = await useSolution.getState().saveFile(tab.fileId);
      if (result !== "saved") {
        set({ status: "failed", output: `${result === "conflict" ? "Disk conflict" : "Could not save"}: ${tab.name}. Resolve it before ${action}.\n` });
        if (result === "conflict") useSolution.getState().setPendingSave({ fileId: tab.fileId, kind: "newer" });
        return;
      }
    }

    const spec = resolveSpec(chosen, rootPath, solution, state.selectedProfileName);
    if (!spec) {
      set({ status: "failed", output: `Could not resolve a command for "${chosen.name}".\n` });
      return;
    }

    if (action === "debug") {
      if (chosen.method !== "cargo" && chosen.method !== "dotnet" && chosen.method !== "cmake") {
        set({ status: "failed", output: `Debugging is available for Cargo, .NET, and CMake configurations.\n` });
        return;
      }
      const { useDebug } = await import("./debugStore");
      const profile = state.selectedProfileName
        ?? chosen.defaultProfile
        ?? (chosen.method === "cargo" ? "debug" : "Debug");
      set({ action: "debug", activeConfigName: chosen.name, output: `${chosen.method} debug session starting…\n` });
      await useDebug.getState().start(
        chosen.method,
        spec.cwd,
        profile,
        spec.args,
        spec.env,
      );
      return;
    }

    set({
      status: "starting",
      action,
      artifact: null,
      problems: [],
      activeCwd: spec.cwd,
      output: `Starting ${spec.label}\u2026\n`,
      activeConfigName: chosen.name,
    });

    try {
      await ensureEvents();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<number>("start_config", { spec });
    } catch (error) {
      set({
        status: "failed",
        activeId: null,
        activeConfigName: null,
        output: `Could not ${action}: ${String(error)}\n`,
      });
    }
  },
  stop: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_config");
    } catch (error) {
      set((s) => ({ output: s.output + `Stop failed: ${String(error)}\n` }));
    }
  },
  saveDefault: async () => {
    const { solution, clnPath } = useSolution.getState();
    const { projectPath, profile } = get();
    if (!solution || !clnPath || !projectPath) throw new Error("Open a solution and select a project first.");
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_solution_build_defaults", { clnPath, project: projectPath, profile });
    useSolution.setState({ solution: { ...solution, defaultProject: projectPath, defaultBuild: profile } });
  },
}));
