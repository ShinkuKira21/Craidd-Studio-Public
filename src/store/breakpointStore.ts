import { create } from "zustand";

export interface Breakpoint { file: string; line: number; scope: string; condition?: string | null }

// Older versions saved one record per linked window. A breakpoint now belongs
// to the solution, so preserve each location once when reading legacy data.
export function normalizeBreakpoints(points: Breakpoint[]): Breakpoint[] {
  const seen = new Set<string>();
  return points.filter((point) => {
    const key = point.file + "\0" + point.line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((point) => ({ file: point.file, line: point.line, scope: "all", condition: point.condition?.trim() || null }));
}

interface BreakpointState {
  solutionPath: string | null;
  points: Breakpoint[];
  load: (solutionPath: string | null) => Promise<void>;
  toggle: (file: string, line: number) => Promise<void>;
  setCondition: (file: string, line: number, condition: string) => Promise<void>;
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
    const points = normalizeBreakpoints(await invoke<Breakpoint[]>("load_breakpoints", { solutionPath }));
    set({ solutionPath, points });
  },
  toggle: async (file, line) => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    const next = points.some((point) => point.file === file && point.line === line)
      ? points.filter((point) => point.file !== file || point.line !== line)
      : [...points, { file, line, scope: "all", condition: null }];
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
  setCondition: async (file, line, condition) => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    if (!points.some((point) => point.file === file && point.line === line)) throw new Error("Add the red breakpoint first");
    const next = points.map((point) => point.file === file && point.line === line
      ? { ...point, condition: condition.trim() || null } : point);
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
    const next = normalizeBreakpoints(points.map((point) => point.file === file && byLine.has(point.line)
      ? { ...point, line: byLine.get(point.line)! } : point));
    if (next.length === points.length && next.every((point, index) => point.line === points[index].line)) return;
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
  movePath: async (oldPath, newPath) => {
    const { solutionPath, points } = get();
    if (!solutionPath) return;
    const next = normalizeBreakpoints(points.map((point) => point.file === oldPath || point.file.startsWith(oldPath + "/")
      ? { ...point, file: newPath + point.file.slice(oldPath.length) } : point));
    if (next.length === points.length && next.every((point, index) => point.file === points[index].file)) return;
    set({ points: next });
    try { await persist(solutionPath, next); } catch (error) { set({ points }); throw error; }
  },
}));

export async function listenForBreakpointChanges(): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<{ solutionPath: string; breakpoints: Breakpoint[] }>("craidd:breakpoints-changed", (event) => {
    const current = useBreakpoints.getState().solutionPath;
    if (current === event.payload.solutionPath) {
      useBreakpoints.setState({ points: normalizeBreakpoints(event.payload.breakpoints) });
    }
  });
}
