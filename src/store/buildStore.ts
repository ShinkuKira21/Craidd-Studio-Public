import { create } from "zustand";
import { useSolution } from "./solutionStore";

type Profile = "debug" | "release";
type Status = "idle" | "starting" | "running" | "success" | "failed" | "cancelled";

interface BuildEvent {
  sessionId: number;
  kind: "start" | "output" | "artifact" | "finish" | "cancelled" | "error";
  text: string | null;
  exitCode: number | null;
}

interface BuildState {
  projectPath: string | null;
  profile: Profile;
  status: Status;
  activeId: number | null;
  output: string;
  artifact: string | null;
  action: "build" | "run" | null;
  setProjectPath: (path: string) => void;
  setProfile: (profile: Profile) => void;
  start: (action: "build" | "run") => Promise<void>;
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
        if (message.kind === "cancelled") return { activeId: null, status: "cancelled", output: state.output + "Cancelled.\n" };
        if (message.kind === "error") return { activeId: null, status: "failed", output: state.output + `Error: ${message.text}\n` };
        return {
          activeId: null,
          status: message.exitCode === 0 ? "success" : "failed",
          output: state.output + `Process exited with code ${message.exitCode ?? "unknown"}.\n`,
        };
      });
    })
  ).then(() => undefined).catch((error) => { eventListener = null; throw error; });
  return eventListener;
}

export const useBuild = create<BuildState>((set, get) => ({
  projectPath: null,
  profile: "debug",
  status: "idle",
  activeId: null,
  output: "",
  artifact: null,
  action: null,
  setProjectPath: (projectPath) => set({ projectPath }),
  setProfile: (profile) => set({ profile }),
  start: async (action) => {
    const { solution, rootPath } = useSolution.getState();
    const current = get();
    const path = current.projectPath ?? solution?.defaultProject ?? solution?.projects.find((p) => p.language === "rust")?.path;
    const project = solution?.projects.find((p) => p.path === path);
    if (!rootPath || !project || project.language !== "rust") {
      set({ status: "failed", output: "Select a declared Rust project before building.\n" });
      return;
    }
    if (current.activeId !== null || current.status === "starting") return;
    set({ status: "starting", action, artifact: null, output: "Starting Cargo…\n" });
    try {
      await ensureEvents();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<number>("start_cargo", { root: rootPath, project: project.path, profile: current.profile, action });
    } catch (error) {
      set({ status: "failed", activeId: null, output: `Could not ${action}: ${String(error)}\n` });
    }
  },
  stop: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_cargo");
    } catch (error) { set((state) => ({ output: state.output + `Stop failed: ${String(error)}\n` })); }
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
