import { create } from "zustand";
import type {
  CraiddSolution,
  CraiddProject,
  FileNode,
  EditorTab,
  Language,
} from "../types/project";
import { languageFromFilename, languageMeta } from "../lib/languages";

interface SolutionState {
  rootPath: string | null;
  solution: CraiddSolution | null;
  isSolutionLoading: boolean;
  solutionError: string | null;
  discovery: FileNode | null;
  tabs: EditorTab[];
  activeFileId: string | null;

  openFolder: (path: string) => Promise<void>;
  clearSolution: () => void;
  addProject: (args: { name: string; language: Language; folder: string }) => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  openFile: (absolutePath: string, fileName: string) => Promise<void>;
  closeTab: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
}

async function loadProjectTree(
  rootPath: string,
  project: CraiddProject
): Promise<{ tree: FileNode | null; error: string | null }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const meta = languageMeta(project.language);
    const folderPath =
      project.folder && project.folder !== "."
        ? `${rootPath.replace(/\/+$/, "")}/${project.folder.replace(/^\/+/, "")}`
        : rootPath;
    const tree = await invoke<FileNode>("read_dir_tree_filtered", {
      path: folderPath,
      extensions: meta.extensions,
      wellKnownFiles: meta.wellKnownFiles,
    });
    return { tree, error: null };
  } catch (err) {
    return { tree: null, error: String(err) };
  }
}

export const useSolution = create<SolutionState>((set, get) => ({
  rootPath: null,
  solution: null,
  isSolutionLoading: false,
  solutionError: null,
  discovery: null,
  tabs: [],
  activeFileId: null,

  openFolder: async (path) => {
    set({ isSolutionLoading: true, solutionError: null, rootPath: path });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_tree", { path });
      const solution = await invoke<CraiddSolution | null>("load_solution", { path });

      if (solution) {
        const withTrees: CraiddProject[] = [];
        for (const p of solution.projects) {
          const { tree, error } = await loadProjectTree(path, p);
          withTrees.push({ ...p, tree, treeError: error });
        }
        set({ solution: { ...solution, projects: withTrees }, discovery, isSolutionLoading: false, tabs: [], activeFileId: null });
      } else {
        set({ solution: null, discovery, isSolutionLoading: false, tabs: [], activeFileId: null });
      }
    } catch (err) {
      console.error("[craidd] openFolder failed:", err);
      set({ solutionError: String(err), isSolutionLoading: false });
    }
  },

  clearSolution: () => set({ rootPath: null, solution: null, discovery: null, tabs: [], activeFileId: null, solutionError: null }),

  addProject: async ({ name, language, folder }) => {
    const state = get();
    if (!state.rootPath) throw new Error("No folder is open.");
    const { invoke } = await import("@tauri-apps/api/core");

    const id = name.replace(/[^A-Za-z0-9_]/g, "") || folder.split("/").filter(Boolean).pop() || "project";
    const folderName = folder.split("/").filter(Boolean).pop() || "project";
    const craiddRelPath = folder === "." || folder === "" ? `${folderName}.craidd` : `${folder}/${folderName}.craidd`;

    const project: CraiddProject = { id, name, language, root: ".", path: craiddRelPath, folder };
    await invoke("save_project", { root: state.rootPath, project });

    const existing = state.solution;
    const solutionName = state.discovery?.name ?? "solution";
    const deduped = existing ? existing.projects.filter((p) => p.folder !== folder) : [];
    const nextSolution: CraiddSolution = {
      name: existing?.name ?? solutionName,
      root: state.rootPath,
      projects: [...deduped, project],
      autostart: existing?.autostart ?? [],
      runDefault: existing?.runDefault,
      debugDefault: existing?.debugDefault,
    };
    await invoke("save_solution", { root: state.rootPath, solution: nextSolution });

    const { tree, error } = await loadProjectTree(state.rootPath, project);
    project.tree = tree;
    project.treeError = error;

    set({
      solution: {
        ...nextSolution,
        projects: nextSolution.projects.map((p) => (p.folder === folder ? project : p)),
      },
    });
  },

  refreshProject: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;
    const { tree, error } = await loadProjectTree(state.rootPath, project);
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) => (p.id === projectId ? { ...p, tree, treeError: error } : p)),
      },
    });
  },

  openFile: async (absolutePath, fileName) => {
    const state = get();
    if (state.tabs.some((t) => t.fileId === absolutePath)) {
      set({ activeFileId: absolutePath });
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const content = await invoke<string>("read_file", { path: absolutePath });
      const language = languageFromFilename(fileName);
      const tab: EditorTab = { fileId: absolutePath, name: fileName, language, content };
      set({ tabs: [...state.tabs, tab], activeFileId: absolutePath });
    } catch (err) {
      console.error("[craidd] read_file failed:", err);
    }
  },

  closeTab: (fileId) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.fileId !== fileId);
      let activeFileId = s.activeFileId;
      if (activeFileId === fileId) {
        activeFileId = tabs.length > 0 ? tabs[tabs.length - 1].fileId : null;
      }
      return { tabs, activeFileId };
    }),

  setActiveFile: (fileId) => set({ activeFileId: fileId }),
}));
