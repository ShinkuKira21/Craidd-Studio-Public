import { create } from "zustand";

export interface Breakpoint { file: string; line: number; scope: string }

interface BreakpointState {
  solutionPath: string | null;
  points: Breakpoint[];
  load: (solutionPath: string | null) => Promise<void>;
  toggle: (file: string, line: number, scope?: string) => Promise<void>;
  setScope: (file: string, line: number, scope: string) => Promise<void>;
  remove: (file: string, line: number) => Promise<void>;
  moveLines: (file: string, moves: { from: number; to: number }[]) => Promise<void>;
  movePath: (oldPath: string, newPath: string) => Promise<void>;
}

async function persist(solutionPath: string, points: Breakpoint[]) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_breakpoints", { solutionPath, breakpoints: points });
}

export const useBreakpoints = create<BreakpointState>((set, get) => ({
  solutionPath: null,
  points: [],
  load: async (solutionPath) => {
    if (!solutionPath) { set({ solutionPath: null, points: [] }); return; }
    const { invoke } = await import("@tauri-apps/api/core");
    const points = await invoke<Breakpoint[]>("load_breakpoints", { solutionPath });
    set({ solutionPath, points });
  },
  toggle: async (file, line, scope = "all") => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    const next = points.some((point) => point.file === file && point.line === line)
      ? points.filter((point) => point.file !== file || point.line !== line)
      : [...points, { file, line, scope }];
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
  setScope: async (file, line, scope) => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    const next = points.map((point) => point.file === file && point.line === line ? { ...point, scope } : point);
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
  remove: async (file, line) => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    const next = points.filter((point) => point.file !== file || point.line !== line);
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
  moveLines: async (file, moves) => {
    const { solutionPath, points } = get();
    if (!solutionPath || moves.length === 0) return;
    const byLine = new Map(moves.map((move) => [move.from, move.to]));
    const next = points.map((point) => point.file === file && byLine.has(point.line)
      ? { ...point, line: byLine.get(point.line)! } : point);
    if (next.every((point, index) => point.line === points[index].line)) return;
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
  movePath: async (oldPath, newPath) => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    const next = points.map((point) => point.file === oldPath || point.file.startsWith(`${oldPath}/`)
      ? { ...point, file: newPath + point.file.slice(oldPath.length) } : point);
    if (next.every((point, index) => point.file === points[index].file)) return;
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
}));

export async function listenForBreakpointChanges(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ solutionPath: string; breakpoints: Breakpoint[] }>("craidd:breakpoints-changed", (event) => {
    const current = useBreakpoints.getState().solutionPath;
    if (current === event.payload.solutionPath) {
      useBreakpoints.setState({ points: event.payload.breakpoints });
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("update_debug_breakpoints", { breakpoints: event.payload.breakpoints })
      ).catch((error) => console.error("[craidd] Could not update live breakpoints:", error));
    }
  });
}
