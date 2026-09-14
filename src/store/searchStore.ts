import { create } from "zustand";

export interface LineMatch {
  lineNumber: number;
  text: string;
}

export interface FileMatch {
  path: string;
  relPath: string;
  name: string;
  matches: LineMatch[];
  mtimeMs: number;
}

export interface FileNameMatch {
  path: string;
  relPath: string;
  name: string;
}

interface SearchState {
  query: string;
  setQuery: (q: string) => void;

  contentMatches: FileMatch[];
  fileNameMatches: FileNameMatch[];
  searching: boolean;
  error: string | null;

  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  expandPath: (path: string) => void;

  requestId: number;
  run: (query: string) => Promise<void>;
}

export const useSearch = create<SearchState>((set, get) => ({
  query: "",
  contentMatches: [],
  fileNameMatches: [],
  searching: false,
  error: null,
  expandedPaths: new Set(),
  requestId: 0,

  setQuery: (q) => set({ query: q }),

  toggleExpanded: (path) =>
    set((s) => {
      const next = new Set(s.expandedPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedPaths: next };
    }),

  expandPath: (path) =>
    set((s) => {
      if (s.expandedPaths.has(path)) return s;
      const next = new Set(s.expandedPaths);
      next.add(path);
      return { expandedPaths: next };
    }),

  run: async (query) => {
    const trimmed = query.trim();
    const id = get().requestId + 1;
    set({ requestId: id, query });

    if (!trimmed) {
      set({ contentMatches: [], fileNameMatches: [], searching: false, error: null });
      return;
    }

    // ── Filename matches (frontend only — instant) ──
    const { useSolution } = await import("./solutionStore");
    const state = useSolution.getState();
    const discovery = state.discovery;
    const root = state.rootPath;
    const lower = trimmed.toLowerCase();

    const nameHits: FileNameMatch[] = [];
    if (discovery && root) {
      const walk = (n: any) => {
        if (!n) return;
        if (n.kind === "file" && n.name.toLowerCase().includes(lower)) {
          const abs = n.path && n.path !== "."
            ? `${root.replace(/\/+$/, "")}/${n.path.replace(/^\/+/, "")}`
            : `${root.replace(/\/+$/, "")}/${n.name}`;
          nameHits.push({ path: abs, relPath: n.path, name: n.name });
        }
        if (n.children) for (const c of n.children) walk(c);
      };
      walk(discovery);
    }
    set({ fileNameMatches: nameHits });

    // ── Content matches (Rust) ──
    if (!root) {
      set({ contentMatches: [], searching: false, error: null });
      return;
    }

    set({ searching: true, error: null });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const results = await invoke<FileMatch[]>("search_in_path", {
        root,
        query: trimmed,
        maxTotal: 500,
      });
      if (get().requestId !== id) return;  // stale
      set({ contentMatches: results, searching: false });
    } catch (err) {
      if (get().requestId !== id) return;
      set({ contentMatches: [], searching: false, error: String(err) });
    }
  },
}));
