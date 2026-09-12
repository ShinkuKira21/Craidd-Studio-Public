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

  addProject: (args: {
    name: string;
    language: Language;
    folder: string;
  }) => Promise<void>;

  addConfigHere: (projectId: string) => Promise<void>;
  setConfigDirectory: (projectId: string, directory: string) => Promise<void>;
  removeConfig: (projectId: string) => Promise<void>;

  refreshProject: (projectId: string) => Promise<void>;
  openFile: (absolutePath: string, fileName: string) => Promise<void>;
  closeTab: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;
}

/** Resolve a folder path relative to root. */
function joinRoot(root: string, folder: string): string {
  if (!folder || folder === ".") return root;
  return `${root.replace(/\/+$/, "")}/${folder.replace(/^\/+/, "")}`;
}

async function loadTreeFor(
  rootPath: string,
  folder: string,
  extensions: string[],
  wellKnownFiles: string[]
): Promise<{ tree: FileNode | null; error: string | null }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = joinRoot(rootPath, folder);
    const tree = await invoke<FileNode>("read_dir_tree_filtered", {
      path,
      extensions,
      wellKnownFiles,
    });
    return { tree, error: null };
  } catch (err) {
    return { tree: null, error: String(err) };
  }
}

async function populateTrees(
  rootPath: string,
  project: CraiddProject
): Promise<CraiddProject> {
  const next = { ...project };

  // Source tree
  if (project.language && project.language !== "config") {
    const meta = languageMeta(project.language);
    const { tree, error } = await loadTreeFor(
      rootPath,
      project.folder,
      meta.extensions,
      meta.wellKnownFiles
    );
    next.tree = tree;
    next.treeError = error;
  } else {
    next.tree = null;
  }

  // Config tree
  if (project.configEnabled) {
    const configMeta = languageMeta("config");
    const configFolder = project.configDirectory
      ? project.configDirectory
      : project.folder;
    // If the config directory is specified relative to the craidd's folder,
    // and the craidd's folder is not the solution root, we need to combine.
    let resolvedConfigFolder: string;
    if (!project.configDirectory) {
      resolvedConfigFolder = project.folder;
    } else if (project.configDirectory.startsWith("/")) {
      // Absolute in solution space — strip leading slash
      resolvedConfigFolder = project.configDirectory.replace(/^\/+/, "");
    } else if (project.folder === "." || project.folder === "") {
      resolvedConfigFolder = project.configDirectory;
    } else {
      // Relative to the .craidd's folder
      const base = project.folder.replace(/\/+$/, "");
      const rel = project.configDirectory.replace(/^\.\//, "");
      resolvedConfigFolder = rel === ".." ? base.split("/").slice(0, -1).join("/") || "." : `${base}/${rel}`;
    }
    const { tree, error } = await loadTreeFor(
      rootPath,
      resolvedConfigFolder,
      configMeta.extensions,
      configMeta.wellKnownFiles
    );
    next.configTree = tree;
    next.configTreeError = error;
  } else {
    next.configTree = null;
  }

  return next;
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
          withTrees.push(await populateTrees(path, p));
        }
        set({
          solution: { ...solution, projects: withTrees },
          discovery,
          isSolutionLoading: false,
          tabs: [],
          activeFileId: null,
        });
      } else {
        set({
          solution: null,
          discovery,
          isSolutionLoading: false,
          tabs: [],
          activeFileId: null,
        });
      }
    } catch (err) {
      console.error("[craidd] openFolder failed:", err);
      set({ solutionError: String(err), isSolutionLoading: false });
    }
  },

  clearSolution: () =>
    set({
      rootPath: null,
      solution: null,
      discovery: null,
      tabs: [],
      activeFileId: null,
      solutionError: null,
    }),

  addProject: async ({ name, language, folder }) => {
    const state = get();
    if (!state.rootPath) throw new Error("No folder is open.");
    const { invoke } = await import("@tauri-apps/api/core");

    const existing = state.solution;
    // Dedupe: same folder AND same language = replace. Different lang = keep both.
    const others = existing
      ? existing.projects.filter(
          (p) => !(p.folder === folder && p.language === language)
        )
      : [];

    // If there's already a project at this folder with this exact name+lang, reuse its config
    const existingAtFolder = existing?.projects.find(
      (p) => p.folder === folder && p.language === language
    );

    const id =
      name.replace(/[^A-Za-z0-9_]/g, "") ||
      folder.split("/").filter(Boolean).pop() ||
      "project";

    const folderName = folder.split("/").filter(Boolean).pop() || "project";
    const craiddRelPath =
      folder === "." || folder === ""
        ? `${folderName}.craidd`
        : `${folder}/${folderName}.craidd`;

    const project: CraiddProject = {
      id,
      name,
      language,
      root: ".",
      path: craiddRelPath,
      folder,
      configEnabled: existingAtFolder?.configEnabled ?? false,
      configName: existingAtFolder?.configName,
      configDirectory: existingAtFolder?.configDirectory,
      configInclude: existingAtFolder?.configInclude,
    };

    await invoke("save_project", { root: state.rootPath, project });

    const solutionName = state.discovery?.name ?? "solution";
    const nextSolution: CraiddSolution = {
      name: existing?.name ?? solutionName,
      root: state.rootPath,
      projects: [...others, project],
      autostart: existing?.autostart ?? [],
      runDefault: existing?.runDefault,
      debugDefault: existing?.debugDefault,
    };

    await invoke("save_solution", { root: state.rootPath, solution: nextSolution });

    const populated = await populateTrees(state.rootPath, project);
    const final: CraiddSolution = {
      ...nextSolution,
      projects: nextSolution.projects.map((p) =>
        p.folder === folder && p.language === language ? populated : p
      ),
    };

    set({ solution: final });
  },

  addConfigHere: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;

    const { invoke } = await import("@tauri-apps/api/core");

    const updated: CraiddProject = {
      ...project,
      configEnabled: true,
      configName: project.configName ?? `${project.name} (Config)`,
      configDirectory: project.configDirectory, // same folder
    };

    await invoke("save_project", { root: state.rootPath, project: updated });

    const populated = await populateTrees(state.rootPath, updated);
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) =>
          p.id === projectId ? populated : p
        ),
      },
    });
  },

  setConfigDirectory: async (projectId, directory) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;

    const { invoke } = await import("@tauri-apps/api/core");

    const updated: CraiddProject = {
      ...project,
      configEnabled: true,
      configName: project.configName ?? `${project.name} (Config)`,
      configDirectory: directory,
    };

    await invoke("save_project", { root: state.rootPath, project: updated });

    const populated = await populateTrees(state.rootPath, updated);
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) =>
          p.id === projectId ? populated : p
        ),
      },
    });
  },

  removeConfig: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;

    const { invoke } = await import("@tauri-apps/api/core");

    const updated: CraiddProject = {
      ...project,
      configEnabled: false,
      configName: undefined,
      configDirectory: undefined,
      configInclude: undefined,
      configTree: null,
      configTreeError: null,
    };

    await invoke("save_project", { root: state.rootPath, project: updated });

    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) =>
          p.id === projectId ? updated : p
        ),
      },
    });
  },

  refreshProject: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;
    const populated = await populateTrees(state.rootPath, project);
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) =>
          p.id === projectId ? populated : p
        ),
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
