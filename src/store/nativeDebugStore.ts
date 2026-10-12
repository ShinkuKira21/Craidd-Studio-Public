import { create } from "zustand";
import { hasDebugSourceLine } from "./debugStore";
import type { DebugFrame, DebugThread, DebugVariable } from "./debugStore";
import { revealDebugSource } from "../lib/debugSource";
import { useLinkedWindows } from "./linkedWindowsStore";

/** A debug-only subscription, deliberately separate from build/config/editor
 * ownership and from hidden-window adoption. */
export interface NativeDebugContext {
  token: string;
  originLabel: string;
  partnerLabel: string;
  entryPoint: string;
  callFile: string;
  callLine: number;
  status: "running" | "paused";
  nativeStop: boolean;
  selectedThreadId: number | null;
  file: string | null;
  line: number | null;
  frames: DebugFrame[];
  variables: DebugVariable[];
}
export interface NativeThreadSnapshot {
  token: string;
  sessionKey: string;
  selectedThreadId: number | null;
  threads: DebugThread[];
  stale: boolean;
  allThreadsStopped: boolean;
  nativeSingleStep: boolean;
  stepPending: boolean;
}
export const useNativeDebug = create<{ context: NativeDebugContext | null; threads: NativeThreadSnapshot | null }>(() => ({ context: null, threads: null }));
type NativeDebugNotice = NativeDebugContext | (Omit<NativeDebugContext, "status"> & { status: "detached" }) | null;

export function currentNativeInspection(): NativeDebugContext | null {
  const linked = useLinkedWindows.getState();
  const context = useNativeDebug.getState().context;
  return context && context.partnerLabel === linked.ownWindowLabel
    && (!linked.viewedWindowLabel || linked.viewedWindowLabel === linked.ownWindowLabel) ? context : null;
}
export async function controlNativeInspection(action: string): Promise<void> {
  const context = currentNativeInspection();
  if (!context) throw new Error("Native inspection ended or changed");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("native_debug_control", { token: context.token, action });
}
export async function refreshNativeThreads(): Promise<void> {
  const context = currentNativeInspection();
  if (!context) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const snapshot = await invoke<Omit<NativeThreadSnapshot, "token">>("native_debug_threads", { token: context.token });
  if (currentNativeInspection()?.token === context.token) {
    useNativeDebug.setState({ threads: { ...snapshot, token: context.token,
      threads: snapshot.threads.map((thread) => ({ ...thread, receivedAt: performance.now() })) } });
  }
}
export async function selectNativeThread(threadId: number): Promise<void> {
  const context = currentNativeInspection();
  if (!context || context.status !== "paused") throw new Error("Pause the shared Rust debugger before selecting a thread");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("native_debug_select_thread", { token: context.token, threadId });
  await refreshNativeThreads();
}
export async function stepNativeThreadOnly(): Promise<void> {
  const context = currentNativeInspection();
  const snapshot = useNativeDebug.getState().threads;
  const thread = snapshot?.threads.find((item) => item.id === snapshot.selectedThreadId);
  if (!context || !snapshot || snapshot.token !== context.token || context.status !== "paused"
    || !context.nativeStop || !hasDebugSourceLine(context.frames[0])
    || (context.selectedThreadId != null && context.selectedThreadId !== thread?.id)
    || !snapshot.nativeSingleStep || snapshot.stale || !snapshot.allThreadsStopped || snapshot.stepPending
    || !thread || thread.state !== "paused") {
    throw new Error("Select a paused native thread at a source line after all threads have stopped");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("native_debug_step_thread_only", { token: context.token, sessionKey: snapshot.sessionKey,
    threadId: thread.id, incarnation: thread.incarnation });
  await refreshNativeThreads();
}
export async function listenToNativeDebug(): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { invoke } = await import("@tauri-apps/api/core");
  let disposed = false;
  let received = false;
  const apply = (notice: NativeDebugNotice) => {
    if (disposed) return;
    const previous = useNativeDebug.getState().context;
    if (notice && notice.partnerLabel !== getCurrentWebviewWindow().label) return;
    if (notice?.status === "detached" && previous && notice.token.split(":")[0] !== previous.token.split(":")[0]) return;
    const context = notice?.status === "detached" ? null : notice;
    useNativeDebug.setState({ context, threads: context && previous?.token === context.token
      ? useNativeDebug.getState().threads : null });
    if (context?.nativeStop && context.status === "paused" && context.file && context.line
      && (previous?.token !== context.token || previous.file !== context.file || previous.line !== context.line)) {
      void revealDebugSource(context.file, context.line, 1, () => !disposed
        && useNativeDebug.getState().context?.token === context.token
        && useNativeDebug.getState().context?.file === context.file)
        .catch((error) => console.error("[native debug] Could not reveal native stop:", error));
    }
  };
  const cleanup = await getCurrentWebviewWindow().listen<NativeDebugNotice>("craidd:native-debug-context", ({ payload }) => {
    received = true; apply(payload);
  });
  try {
    const context = await invoke<NativeDebugContext | null>("get_native_debug_context");
    if (!received) apply(context);
  } catch (error) { console.error("[native debug] Could not restore inspection:", error); }
  return () => { disposed = true; cleanup(); useNativeDebug.setState({ context: null, threads: null }); };
}
