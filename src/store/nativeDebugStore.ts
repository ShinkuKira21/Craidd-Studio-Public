import { create } from "zustand";
import type { DebugFrame, DebugVariable } from "./debugStore";
import { useSolution } from "./solutionStore";
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
  file: string | null;
  line: number | null;
  frames: DebugFrame[];
  variables: DebugVariable[];
}
export const useNativeDebug = create<{ context: NativeDebugContext | null }>(() => ({ context: null }));
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
    useNativeDebug.setState({ context });
    if (context?.status === "paused" && context.file && context.line
      && (previous?.token !== context.token || previous.file !== context.file || previous.line !== context.line)) {
      void useSolution.getState().revealFile(context.file, context.line, 1)
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
  return () => { disposed = true; cleanup(); useNativeDebug.setState({ context: null }); };
}
