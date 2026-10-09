import { create } from "zustand";
import { revealDebugSource } from "../lib/debugSource";
import { useBreakpoints } from "./breakpointStore";
import { useSolution } from "./solutionStore";
import type { OrderRequest } from "../types/project";
import { appendOutput } from "../lib/outputPresentation";

type DebugStatus = "idle" | "building" | "starting" | "running" | "paused" | "terminated" | "error";
export interface DebugFrame { id: number; name: string; line: number; source?: { path?: string; name?: string } }
export interface DebugVariable { name: string; value: string; type?: string; variablesReference: number }
export interface DebugThread { id: number; name: string; state: "running" | "paused" | "unknown"; reason?: string | null; incarnation: number; observedMs: number; ranMs: number; runObserved: boolean; receivedAt?: number }
export interface CompletedDebugThread { id: number; name: string; incarnation: number; observedMs: number; ranMs: number; runObserved: boolean }
interface DebugEvent {
  status: DebugStatus | "output" | "scopes" | "variables" | "threads" | "threadSelected" | "inspection" | "capabilities" | "nativeStepRejected" | "nativeHoldsReleased" | "nativeReleaseFailed";
  text?: string;
  reason?: string;
  file?: string;
  line?: number;
  frames?: DebugFrame[];
  variables?: DebugVariable[];
  nativeRouted?: boolean;
  threadId?: number;
  sessionKey?: string;
  selectionEpoch?: number;
  threads?: DebugThread[];
  completed?: CompletedDebugThread[];
  stale?: boolean;
  error?: string;
  allThreadsStopped?: boolean;
  nativeSingleStep?: boolean;
  retryable?: boolean;
}

interface DebugState {
  status: DebugStatus;
  output: string;
  reason: string | null;
  file: string | null;
  line: number | null;
  frames: DebugFrame[];
  variables: DebugVariable[];
  threads: DebugThread[];
  completedThreads: CompletedDebugThread[];
  threadsStale: boolean;
  allThreadsStopped: boolean;
  threadSessionKey: string | null;
  nativeSingleStepSessionKey: string | null;
  nativeStepTarget: { sessionKey: string; id: number; name: string } | null;
  nativeStepOutcome: string | null;
  nativeReleaseFailed: boolean;
  nativeCanRetryRelease: boolean;
  selectedThreadId: number | null;
  selectionEpoch: number;
  inspectionError: string | null;
  start: (method: "cargo" | "dotnet" | "cmake", cwd: string, profile: string, commandArgs?: string[], env?: Record<string, string>, order?: OrderRequest) => Promise<void>;
  control: (action: "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "stop") => Promise<void>;
  selectThread: (threadId: number) => Promise<void>;
  refreshThreads: () => Promise<void>;
  stepNativeThreadOnly: () => Promise<void>;
  releaseNativeHolds: () => Promise<void>;
}

export const useDebug = create<DebugState>((set, get) => ({
  status: "idle", output: "", reason: null, file: null, line: null, frames: [], variables: [],
  threads: [], completedThreads: [], threadsStale: false, allThreadsStopped: false, threadSessionKey: null, nativeSingleStepSessionKey: null,
  nativeStepTarget: null, nativeStepOutcome: null, nativeReleaseFailed: false, nativeCanRetryRelease: false,
  selectedThreadId: null, selectionEpoch: 0, inspectionError: null,
  start: async (method, cwd, profile, commandArgs = [], env = {}, order) => {
    if (["building", "starting", "running", "paused"].includes(get().status)) return;
    const language = method === "cargo" ? "Rust" : method === "dotnet" ? "C#" : "C++";
    set({ status: "building", output: `Building a debuggable ${language} executable…\n`, frames: [], variables: [], file: null, line: null,
      threads: [], completedThreads: [], threadsStale: false, allThreadsStopped: false, threadSessionKey: null,
      nativeSingleStepSessionKey: null, nativeStepTarget: null, nativeStepOutcome: null, nativeReleaseFailed: false, nativeCanRetryRelease: false,
      selectedThreadId: null, selectionEpoch: 0, inspectionError: null });
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
  selectThread: async (threadId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_select_thread", { threadId });
  },
  refreshThreads: async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_refresh_threads");
  },
  stepNativeThreadOnly: async () => {
    const state = get();
    const sessionKey = state.threadSessionKey;
    const selected = state.threads.find((thread) => thread.id === state.selectedThreadId);
    if (!sessionKey || state.nativeSingleStepSessionKey !== sessionKey || state.status !== "paused"
      || state.threadsStale || !state.allThreadsStopped || state.nativeStepTarget || state.nativeReleaseFailed
      || !selected || selected.state !== "paused" || !state.frames[0]?.source?.path || !state.frames[0]?.line) {
      throw new Error("Select a paused native thread at a source line after all threads have stopped");
    }
    set({ nativeStepTarget: { sessionKey, id: selected.id, name: selected.name }, nativeStepOutcome: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("debug_step_native_thread_only", { sessionKey, threadId: selected.id, incarnation: selected.incarnation });
    } catch (error) {
      set({ nativeStepTarget: null, nativeStepOutcome: `One-thread Step failed: ${String(error)}` });
      throw error;
    }
  },
  releaseNativeHolds: async () => {
    const state = get();
    const sessionKey = state.threadSessionKey;
    if (!sessionKey || state.nativeSingleStepSessionKey !== sessionKey || state.status !== "paused"
      || state.threadsStale || !state.allThreadsStopped || (!state.nativeStepTarget && !state.nativeCanRetryRelease)) {
      throw new Error("Wait for an all-thread stop with native holds pending");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("debug_release_native_holds", { sessionKey });
  },
}));

export async function listenToDebug(): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  let disposed = false;
  let stopSerial = 0;
  const unlisten = await getCurrentWebviewWindow().listen<DebugEvent>("craidd:debug-state", (event) => {
    const message = event.payload;
    if (message.status === "output") {
      useDebug.setState((state) => ({ output: appendOutput(state.output, message.text ?? "") }));
      return;
    }
    if (message.status === "capabilities") {
      useDebug.setState((state) => {
        if (!message.sessionKey || (state.threadSessionKey && state.threadSessionKey !== message.sessionKey)) return state;
        return { threadSessionKey: message.sessionKey,
          nativeSingleStepSessionKey: message.nativeSingleStep ? message.sessionKey : null };
      });
      return;
    }
    if (message.status === "nativeStepRejected") {
      useDebug.setState((state) => message.sessionKey === state.threadSessionKey
        ? { nativeStepTarget: null, nativeReleaseFailed: false, nativeCanRetryRelease: false,
          nativeStepOutcome: `One-thread Step failed: ${message.text ?? "LLDB rejected the request"}` }
        : state);
      return;
    }
    if (message.status === "nativeHoldsReleased") {
      useDebug.setState((state) => message.sessionKey === state.threadSessionKey
        ? { nativeStepTarget: null, nativeReleaseFailed: false, nativeCanRetryRelease: false } : state);
      return;
    }
    if (message.status === "nativeReleaseFailed") {
      useDebug.setState((state) => message.sessionKey === state.threadSessionKey
        ? { nativeStepTarget: null, nativeReleaseFailed: true, nativeCanRetryRelease: message.retryable === true,
          nativeStepOutcome: `Native hold release is unverified: ${message.text ?? "LLDB did not confirm release"}. ${message.retryable ? "Retry release or Stop." : "Stop this debugger session."}` }
        : state);
      return;
    }
    if (message.status === "threads") {
      const receivedAt = performance.now();
      useDebug.setState((state) => ({
        threadSessionKey: message.sessionKey ?? state.threadSessionKey,
        threads: (message.threads ?? []).map((thread) => ({ ...thread, receivedAt })),
        completedThreads: message.completed ?? [],
        threadsStale: message.stale ?? false,
        allThreadsStopped: message.allThreadsStopped ?? false,
        selectedThreadId: state.selectedThreadId != null && (message.threads ?? []).some((thread) => thread.id === state.selectedThreadId)
          ? state.selectedThreadId : null,
        ...((state.selectedThreadId != null && !(message.threads ?? []).some((thread) => thread.id === state.selectedThreadId))
          ? { frames: [], variables: [], file: null, line: null } : {}),
      }));
      return;
    }
    if (message.status === "threadSelected") {
      if (message.sessionKey !== useDebug.getState().threadSessionKey) return;
      useDebug.setState({ selectedThreadId: message.threadId ?? null,
        selectionEpoch: message.selectionEpoch ?? 0, frames: [], variables: [], file: null, line: null,
        inspectionError: null });
      return;
    }
    if (message.status === "inspection") {
      const state = useDebug.getState();
      if (message.threadId !== state.selectedThreadId || message.selectionEpoch !== state.selectionEpoch
        || message.sessionKey !== state.threadSessionKey) return;
      const first = message.frames?.[0];
      useDebug.setState({
        ...(message.frames ? { frames: message.frames, file: first?.source?.path ?? null, line: first?.line ?? null } : {}),
        ...(message.variables ? { variables: message.variables } : {}),
        inspectionError: message.error ?? null,
      });
      if (first?.source?.path && first.line) {
        void revealDebugSource(first.source.path, first.line, 1, () => !disposed
          && useDebug.getState().selectedThreadId === message.threadId
          && useDebug.getState().selectionEpoch === message.selectionEpoch);
      }
      return;
    }
    if (message.status === "scopes") return;
    if (message.status === "variables") {
      useDebug.setState({ variables: message.variables ?? [] });
      return;
    }
    const active = message.status === "paused";
    const serial = ++stopSerial;
    useDebug.setState((state) => ({
      status: message.status as DebugStatus,
      reason: active ? message.nativeRouted ? "Paused in native code · inspect the paired Native window" : message.reason ?? state.reason : null,
      file: active ? message.file ?? state.file : null,
      line: active ? message.line ?? state.line : null,
      frames: active ? message.frames ?? state.frames : [],
      variables: active ? state.variables : [],
      threads: ["terminated", "error", "building", "starting"].includes(message.status) ? [] : state.threads,
      completedThreads: ["terminated", "error", "building", "starting"].includes(message.status) ? [] : state.completedThreads,
      threadsStale: ["terminated", "error", "building", "starting"].includes(message.status) ? false : state.threadsStale,
      allThreadsStopped: ["terminated", "error", "building", "starting"].includes(message.status) ? false : state.allThreadsStopped,
      threadSessionKey: ["terminated", "error", "building", "starting"].includes(message.status) ? null : state.threadSessionKey,
      nativeSingleStepSessionKey: ["terminated", "error", "building", "starting"].includes(message.status) ? null : state.nativeSingleStepSessionKey,
      nativeStepTarget: ["terminated", "error", "building", "starting"].includes(message.status) ? null : state.nativeStepTarget,
      nativeReleaseFailed: ["terminated", "error", "building", "starting"].includes(message.status) ? false : state.nativeReleaseFailed,
      nativeCanRetryRelease: ["terminated", "error", "building", "starting"].includes(message.status) ? false : state.nativeCanRetryRelease,
      nativeStepOutcome: active && state.nativeStepTarget?.sessionKey === state.threadSessionKey
        && (message.reason === "step" || message.reason === "pause" || message.reason === "exception"
          || (message.reason === "breakpoint" && message.threadId === state.nativeStepTarget.id))
        ? message.threadId === state.nativeStepTarget.id && message.reason === "step"
          ? null
          : `One-thread Step requested ${state.nativeStepTarget.name} #${state.nativeStepTarget.id}, but stopped on #${message.threadId ?? "?"} (${message.reason ?? "stop"}).`
        : ["terminated", "error", "building", "starting"].includes(message.status) ? null : state.nativeStepOutcome,
      selectedThreadId: active ? message.threadId ?? state.selectedThreadId : null,
      inspectionError: null,
      output: message.text ? appendOutput(state.output, message.text) : state.output,
    }));
    if (message.status === "paused" && message.file && message.line && !message.nativeRouted) {
      void revealDebugSource(message.file, message.line, 1, () => !disposed && serial === stopSerial);
    }
  });
  return () => { disposed = true; unlisten(); };
}
