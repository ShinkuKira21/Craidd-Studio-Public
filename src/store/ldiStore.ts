import { create } from "zustand";
import type { Breakpoint } from "./breakpointStore";

export interface LdiBlue {
  file: string; line: number; originLabel: string; partnerLabel: string;
  partnerWindowId: number; entryPoint: string; locals: [string, string];
  condition: string | null;
  warning: string | null; nativePoints: Breakpoint[];
}
export interface LdiSession {
  originLabel: string; partnerLabel: string; partnerWindowId: number;
  file: string; line: number; entryPoint: string; locals: [string, string];
  values: [number, number] | null; token: string; held: boolean;
  phase: string; error: string | null;
}
export const useLdi = create<{ blues: LdiBlue[]; session: LdiSession | null }>(() => ({ blues: [], session: null }));

export async function refreshLdiBlues() {
  const { invoke } = await import("@tauri-apps/api/core");
  const blues = await invoke<LdiBlue[]>("get_ldi_blues");
  useLdi.setState({ blues });
}
export async function setLdiBlue(file: string, line: number, partnerLabel: string, condition?: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_ldi_blue", { file, line, partnerLabel, condition: condition ?? null });
  await refreshLdiBlues();
}
export async function removeLdiBlue() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("remove_ldi_blue");
  await refreshLdiBlues();
}
export async function abandonLdi(token: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("abandon_ldi_reproduction", { token });
}
export async function listenToLdi(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  let disposed = false;
  let queued = false;
  const refresh = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) void refreshLdiBlues().catch((error) => console.error("[LDI]", error));
    });
  };
  const cleanups = await Promise.all([
    getCurrentWebviewWindow().listen<LdiSession>("craidd:ldi-state", ({ payload }) => useLdi.setState({ session: payload })),
    listen("craidd:ldi-blues", refresh), listen("craidd:breakpoints-changed", refresh),
    getCurrentWebviewWindow().listen("craidd:linked-state", refresh),
  ]);
  refresh();
  return () => { disposed = true; cleanups.forEach((cleanup) => cleanup()); };
}
