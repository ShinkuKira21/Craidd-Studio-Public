import { create } from "zustand";
import { useSolution } from "./solutionStore";

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
  setSelectedConfig: (name: string | null) => void;
  setSelectedProfile: (name: string | null) => void;
  setMainChoice: (kind: keyof MainChoices, name: string) => void;
  profile: Profile;
  status: Status;
  activeId: number | null;
  output: string;
  artifact: string | null;
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
  eventListener = import("@tauri-apps/api/event").then(({ listen }) =>
    listen<BuildEvent>("craidd:build", (event) => {
      const message = event.payload;
      useBuild.setState((state) => {
        if (message.kind !== "start" && state.activeId !== message.sessionId) return state;
        if (message.kind === "start") return { activeId: message.sessionId, status: "running", output: `${message.text ?? "Cargo started"}\n` };
        if (message.kind === "output") return { output: (state.output + (message.text ?? "") + "\n").slice(-150_000) };
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


import type { ConfigEntry, CraiddSolution } from "../types/project";

interface RunSpec {
  label: string;
  program: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
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
function resolveSpec(
  config: ConfigEntry,
  solutionRoot: string,
  solution: CraiddSolution,
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
  const chosen = profiles.find((p) => p.name === config.defaultProfile) ?? profiles[0];
  const env: Record<string, string> = { ...(chosen?.env ?? {}) };
  const profileArgs = chosen?.args ?? [];

  // Explicit command wins.
  if (config.command && config.command.trim()) {
    const parts = parseCommandLine(config.command.trim());
    if (parts.length === 0) return null;
    const [program, ...rest] = parts;
    return {
      label: config.command.trim(),
      program,
      args: [...rest, ...profileArgs],
      env,
      cwd,
    };
  }

  // Method-based fallback for the cases we know.
  switch (config.method) {
    case "cargo":
      return {
        label: `cargo ${config.kind === "run" ? "run" : "build"}${profileArgs.length ? " " + profileArgs.join(" ") : ""}`,
        program: "cargo",
        args: [config.kind === "run" ? "run" : "build", ...profileArgs],
        env,
        cwd,
      };
    case "npm":
      return { label: "npm run dev", program: "npm", args: ["run", "dev", ...profileArgs], env, cwd };
    case "dotnet":
      return {
        label: `dotnet ${config.kind === "run" ? "run" : "build"}`,
        program: "dotnet",
        args: [config.kind === "run" ? "run" : "build", ...profileArgs],
        env,
        cwd,
      };
    case "cmake":
      return { label: "cmake --build build", program: "cmake", args: ["--build", "build", ...profileArgs], env, cwd };
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


/** Seed mainChoices from a freshly-loaded solution, without clobbering
 *  choices the user has already made this session. */
export function seedMainChoices(solution: CraiddSolution): void {
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  const firstOf = (kind: "build" | "run" | "debug") =>
    all.find((c) => c.kind === kind)?.name ?? null;

  const current = useBuild.getState().mainChoices;
  useBuild.setState({
    mainChoices: {
      build: current.build ?? firstOf("build"),
      run:   current.run   ?? firstOf("run"),
      debug: current.debug ?? firstOf("debug"),
    },
  });
}

export const useBuild = create<BuildState>((set, get) => ({
  projectPath: null,
  selectedConfigName: null,
  selectedProfileName: null,
  activeConfigName: null,
  mainChoices: { build: null, run: null, debug: null },
  setSelectedConfig: (name) => set({ selectedConfigName: name }),
  setSelectedProfile: (name) => set({ selectedProfileName: name }),
  setMainChoice: (kind, name) =>
    set((s) => ({ mainChoices: { ...s.mainChoices, [kind]: name } })),
  profile: "debug",
  status: "idle",
  activeId: null,
  output: "",
  artifact: null,
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

    // Two ways to pick what fires:
    //   1. configName provided  → fire exactly that (chevron one-off).
    //   2. else                  → fire mainChoices[action].
    let chosen: typeof all[number] | null = null;
    if (configName) {
      chosen = all.find((c) => c.name === configName) ?? null;
    } else {
      const main = state.mainChoices[action];
      if (main) chosen = all.find((c) => c.name === main) ?? null;
      if (!chosen) chosen = all.find((c) => c.kind === action) ?? null;
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

    const spec = resolveSpec(chosen, rootPath, solution);
    if (!spec) {
      set({ status: "failed", output: `Could not resolve a command for "${chosen.name}".\n` });
      return;
    }

    set({
      status: "starting",
      action,
      artifact: null,
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
