import { create } from "zustand";
import { useBreakpoints } from "./breakpointStore";
import { useSolution } from "./solutionStore";
import type { OrderRequest } from "../types/project";
import { appendOutput } from "../lib/outputPresentation";

type DebugStatus = "idle" | "building" | "running" | "paused" | "terminated" | "error";
export interface DebugFrame { id: number; name: string; line: number; source?: { path?: string; name?: string } }
export interface DebugVariable { name: string; value: string; type?: string; variablesReference: number }
interface DebugEvent {
  status: DebugStatus | "output" | "scopes" | "variables";
  text?: string;
  reason?: string;
  file?: string;
  line?: number;
  frames?: DebugFrame[];
  variables?: DebugVariable[];
  nativeRouted?: boolean;
}

interface DebugState {
  status: DebugStatus;
  output: string;
  reason: string | null;
  file: string | null;
  line: number | null;
  frames: DebugFrame[];
  variables: DebugVariable[];
  start: (method: "cargo" | "dotnet" | "cmake", cwd: string, profile: string, commandArgs?: string[], env?: Record<string, string>, order?: OrderRequest) => Promise<void>;
  control: (action: "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "stop") => Promise<void>;
}

export const useDebug = create<DebugState>((set, get) => ({
  status: "idle", output: "", reason: null, file: null, line: null, frames: [], variables: [],
  start: async (method, cwd, profile, commandArgs = [], env = {}, order) => {
    if (["building", "running", "paused"].includes(get().status)) return;
    const language = method === "cargo" ? "Rust" : method === "dotnet" ? "C#" : "C++";
    set({ status: "building", output: `Building a debuggable ${language} executable…\n`, frames: [], variables: [], file: null, line: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const solutionPath = useSolution.getState().clnPath;
      if (!solutionPath) throw new Error("Open a solution before starting the debugger");
      await invoke("start_debug", { requestSpec: { cwd, method, profile, solutionPath, commandArgs, env, order,
        breakpoints: useBreakpoints.getState().points } });
    } catch (error) {
      const cancelled = String(error).includes("Debug build cancelled") || String(error).includes("Build order cancelled");
      set({ status: cancelled ? "terminated" : "error", output: get().output.trimEnd().endsWith(String(error)) ? get().output : appendOutput(get().output, String(error)) });
    }
  },
  control: async (action) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("debug_control", { action });
    } catch (error) { set({ output: get().output + `Debug ${action} failed: ${String(error)}\n` }); }
  },
}));

export async function listenToDebug(): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().listen<DebugEvent>("craidd:debug-state", (event) => {
    const message = event.payload;
    if (message.status === "output") {
      useDebug.setState((state) => ({ output: appendOutput(state.output, message.text ?? "") }));
      return;
    }
    if (message.status === "scopes") return;
    if (message.status === "variables") {
      useDebug.setState({ variables: message.variables ?? [] });
      return;
    }
    const active = message.status === "paused";
    useDebug.setState((state) => ({
      status: message.status as DebugStatus,
      reason: active ? message.nativeRouted ? "Paused in native code · inspect the paired Native window" : message.reason ?? state.reason : null,
      file: active ? message.file ?? state.file : null,
      line: active ? message.line ?? state.line : null,
      frames: active ? message.frames ?? state.frames : [],
      variables: active ? state.variables : [],
      output: message.text ? appendOutput(state.output, message.text) : state.output,
    }));
    if (message.status === "paused" && message.file && message.line && !message.nativeRouted) {
      void useSolution.getState().revealFile(message.file, message.line, 1);
    }
  });
}
