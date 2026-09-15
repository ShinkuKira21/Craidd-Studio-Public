import { create } from "zustand";
import type {
  CraiddSolution,
  CraiddProject,
  FileNode,
  EditorTab,
  Language,
  ProjectKind,
} from "../types/project";
import { languageFromFilename, monacoLanguageForFilename, projectExtensions, projectWellKnownFiles, languageMeta } from "../lib/languages";

export interface AncestorInfo {
  clnPath: string;
  clnName: string;
  solutionName: string;
}

export type OpenResult =
  | { status: "loaded" }
  | { status: "no-solution" }
  | { status: "needs-decision"; ancestor: AncestorInfo }
  | { status: "error"; message: string };

type BannerState = "none" | "no-solution" | "inside-parent" | "error";

interface SolutionState {
  rootPath: string | null;
  solution: CraiddSolution | null;
  isSolutionLoading: boolean;
  solutionError: string | null;
  discovery: FileNode | null;
  tabs: EditorTab[];
  activeFileId: string | null;

  bannerState: BannerState;
  bannerMessage: string | null;
  rootMissing: boolean;

  pendingAncestor: AncestorInfo | null;
  pendingPath: string | null;
  bannerAncestor: AncestorInfo | null;

  openFolder: (path: string) => Promise<OpenResult>;
  openSolution: (clnPath: string) => Promise<OpenResult>;
  resolveOpenDecision: (
    choice: "parent" | "browse" | "create" | "add-existing",
    parentClnPath?: string
  ) => Promise<void>;
  dismissError: () => void;

  clearSolution: () => void;
  refreshDiscovery: () => Promise<void>;
  clearRootMissing: () => void;

  addProject: (args: { name: string; language: Language; folder: string; kind?: ProjectKind }) => Promise<void>;
  addExistingProject: (craiddPath: string) => Promise<void>;
  createBlankProject: (args: { name: string; language: Language; subfolder: string }) => Promise<void>;
  createFile: (parentPath: string, name: string, content?: string) => Promise<string>;
  createFolder: (parentPath: string, name: string) => Promise<string>;
  declarePlaceholder: (projectPath: string, args: { name: string; language: Language; kind?: ProjectKind }) => Promise<void>;

  addConfigHere: (projectId: string) => Promise<void>;
  setConfigDirectory: (projectId: string, directory: string) => Promise<void>;
  removeConfig: (projectId: string) => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  heal: () => Promise<number>;

  openFile: (absolutePath: string, fileName: string) => Promise<void>;
  closeTab: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;

  updateTabContent: (fileId: string, content: string) => void;
  pendingSave: { fileId: string; kind: "deleted" | "newer" } | null;
  setPendingSave: (v: { fileId: string; kind: "deleted" | "newer" } | null) => void;
  reloadTabFromDisk: (fileId: string) => Promise<void>;
  saveFile: (fileId: string, force?: boolean) => Promise<"saved" | "conflict" | "error">;
  saveFileAs: (fileId: string, newPath: string) => Promise<void>;
  refreshDiskStates: () => Promise<void>;
  refreshDiskStateFor: (fileId: string) => Promise<void>;
  discardTab: (fileId: string) => void;
}

const log = (...args: unknown[]) => console.log("[craidd]", ...args);
const logErr = (...args: unknown[]) => console.error("[craidd]", ...args);

function joinRoot(root: string, folder: string): string {
  if (!folder || folder === ".") return root;
  return `${root.replace(/\/+$/, "")}/${folder.replace(/^\/+/, "")}`;
}

function resolveRelPath(baseAbs: string, rel: string): string {
  if (rel.startsWith("/")) return rel;
  const baseParts = baseAbs.replace(/\/+$/, "").split("/").filter(Boolean);
  const relParts = rel.replace(/^\/+/, "").split("/");
  for (const part of relParts) {
    if (part === "." || part === "") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return "/" + baseParts.join("/");
}

function isInside(parent: string, child: string): boolean {
  const p = parent.replace(/\/+$/, "");
  const c = child.replace(/\/+$/, "");
  return c === p || c.startsWith(p + "/");
}

async function readTreeFor(
  absolutePath: string,
  extensions: string[],
  wellKnownFiles: string[],
  stopAtCraidd: boolean
): Promise<{ tree: FileNode | null; error: string | null }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const tree = await invoke<FileNode>("read_dir_tree_filtered", {
      path: absolutePath,
      extensions,
      wellKnownFiles,
      stopAtCraidd,
    });
    return { tree, error: null };
  } catch (err) {
    logErr("read_dir_tree_filtered failed for", absolutePath, err);
    return { tree: null, error: String(err) };
  }
}

function projectFolderAbs(solutionRoot: string, project: CraiddProject): string {
  const craiddAbs = resolveRelPath(solutionRoot, project.path);
  const folderAbs = craiddAbs.slice(0, craiddAbs.lastIndexOf("/")) || "/";
  const relRoot = project.root === "." ? "" : project.root.replace(/^\/+/, "").replace(/\/+$/, "");
  return relRoot ? `${folderAbs}/${relRoot}` : folderAbs;
}

async function populateTrees(
  solutionRoot: string,
  project: CraiddProject
): Promise<CraiddProject> {
  if (project.missing) {
    return { ...project, treeBasePath: undefined, configBasePath: undefined };
  }
  const next: CraiddProject = { ...project };

  if (project.language && project.language !== "config") {
    const exts = projectExtensions(project.language);
    const wnf = projectWellKnownFiles(project.language);
    const folder = projectFolderAbs(solutionRoot, project);
    const { tree, error } = await readTreeFor(folder, exts, wnf, true);
    next.tree = tree;
    next.treeError = error;
    next.treeBasePath = folder;
    log("populateTrees: language tree", { project: project.path, folder });
  } else {
    next.tree = null;
    next.treeBasePath = undefined;
  }

  if (project.configEnabled) {
    const meta = languageMeta("config");
    const folderBase = projectFolderAbs(solutionRoot, project);
    let configFolder: string;
    if (!project.configDirectory || project.configDirectory === ".") {
      configFolder = folderBase;
    } else {
      const resolved = resolveRelPath(folderBase, project.configDirectory);
      configFolder = isInside(solutionRoot, resolved) ? resolved : folderBase;
    }
    const { tree, error } = await readTreeFor(configFolder, meta.extensions, [], false);
    next.configTree = tree;
    next.configTreeError = error;
    next.configBasePath = configFolder;
    log("populateTrees: config tree", {
      project: project.path,
      folderBase,
      configDirectory: project.configDirectory,
      configFolder,
    });
  } else {
    next.configTree = null;
    next.configBasePath = undefined;
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
  bannerState: "none",
  bannerMessage: null,
  rootMissing: false,
  pendingAncestor: null,
  pendingPath: null,
  bannerAncestor: null,
  pendingSave: null,

  setPendingSave: (v) => set({ pendingSave: v }),

  reloadTabFromDisk: async (fileId) => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const content = await invoke<string>("read_file", { path: fileId });
      const stats = await invoke<{ path: string; exists: boolean; mtimeMs: number; size: number }[]>(
        "stat_files", { paths: [fileId] }
      );
      const mtimeAtLastSync = stats[0]?.mtimeMs ?? 0;
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.fileId === fileId
            ? { ...t, content, originalContent: content, dirty: false, diskState: "inSync" as const, mtimeAtLastSync }
            : t
        ),
      }));
    } catch (err) {
      logErr("reloadTabFromDisk failed:", err);
    }
  },

  openFolder: async (path) => {
    log("openFolder:", path);
    set({
      isSolutionLoading: true,
      solutionError: null,
      rootPath: path,
      bannerState: "none",
      bannerMessage: null,
      rootMissing: false,
      pendingAncestor: null,
      pendingPath: null,
      bannerAncestor: null,
    });

    let discovery: FileNode;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      discovery = await invoke<FileNode>("read_dir_tree", { path });
      set({ discovery });
    } catch (err) {
      const msg = `Failed to read folder: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
      return { status: "error", message: msg };
    }

    let solution: CraiddSolution | null = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      solution = await invoke<CraiddSolution | null>("load_solution", { path });
      log("load_solution result:", solution ? `${solution.projects.length} projects` : "null");
    } catch (err) {
      const msg = `Failed to load solution: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
      return { status: "error", message: msg };
    }

    if (solution) {
      const withTrees: CraiddProject[] = [];
      for (const p of solution.projects) withTrees.push(await populateTrees(path, p));
      set({
        solution: { ...solution, projects: withTrees },
        isSolutionLoading: false,
        tabs: [],
        activeFileId: null,
        bannerState: "none",
        bannerMessage: null,
      });
      return { status: "loaded" };
    }

    let ancestor: AncestorInfo | null = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      ancestor = await invoke<AncestorInfo | null>("find_ancestor_solution", { path });
      log("find_ancestor_solution result:", ancestor);
    } catch (err) {
      logErr("find_ancestor_solution failed:", err);
    }

    if (ancestor) {
      set({
        solution: null,
        isSolutionLoading: false,
        tabs: [],
        activeFileId: null,
        pendingAncestor: ancestor,
        pendingPath: path,
        bannerState: "none",
      });
      return { status: "needs-decision", ancestor };
    }

    set({
      solution: null,
      isSolutionLoading: false,
      tabs: [],
      activeFileId: null,
      bannerState: "no-solution",
      bannerMessage: null,
    });
    return { status: "no-solution" };
  },

  openSolution: async (clnPath) => {
    log("openSolution called with:", JSON.stringify(clnPath));

    if (!clnPath || typeof clnPath !== "string") {
      const msg = `Invalid .cln path (got: ${String(clnPath)})`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
      return { status: "error", message: msg };
    }

    if (!clnPath.endsWith(".cln")) {
      const msg = `Path does not end in .cln: ${clnPath}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
      return { status: "error", message: msg };
    }

    const idx = Math.max(clnPath.lastIndexOf("/"), clnPath.lastIndexOf("\\"));
    if (idx < 0) {
      const msg = `Cannot derive root from: ${clnPath}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
      return { status: "error", message: msg };
    }
    const root = clnPath.slice(0, idx);
    const clnName = clnPath.slice(idx + 1);
    log("openSolution resolved:", { root, clnName });

    set({
      isSolutionLoading: true,
      solutionError: null,
      rootPath: root,
      bannerState: "none",
      bannerMessage: null,
      rootMissing: false,
      pendingAncestor: null,
      pendingPath: null,
      bannerAncestor: null,
    });

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_tree", { path: root });
      const solution = await invoke<CraiddSolution | null>("load_solution_named", { path: root, clnName });

      if (!solution) {
        const msg = `Solution file not found: ${clnName}`;
        logErr(msg);
        set({ discovery, solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
        return { status: "error", message: msg };
      }

      log("openSolution loaded:", solution.projects.length, "projects");

      const withTrees: CraiddProject[] = [];
      for (const p of solution.projects) withTrees.push(await populateTrees(root, p));

      set({
        solution: { ...solution, projects: withTrees },
        discovery,
        isSolutionLoading: false,
        tabs: [],
        activeFileId: null,
        bannerState: "none",
        bannerMessage: null,
      });
      return { status: "loaded" };
    } catch (err) {
      const msg = `Failed to open solution: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
      return { status: "error", message: msg };
    }
  },

  resolveOpenDecision: async (choice, parentClnPath) => {
    const state = get();
    const path = state.pendingPath;
    const ancestor = state.pendingAncestor;

    log("resolveOpenDecision:", choice, "ancestor:", ancestor);

    if (!path) return;

    if (choice === "parent") {
      if (!parentClnPath) {
        logErr("resolveOpenDecision: parent chosen but no path provided");
        return;
      }
      set({ pendingAncestor: null, pendingPath: null });
      await get().openSolution(parentClnPath);
      return;
    }

    if (choice === "browse") {
      set({
        bannerState: "inside-parent",
        bannerMessage: ancestor?.solutionName ?? null,
        bannerAncestor: ancestor ?? null,
        pendingAncestor: null,
        pendingPath: null,
      });
      return;
    }

    if (choice === "create") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const name = path.split("/").filter(Boolean).pop() || "solution";
        const empty: CraiddSolution = {
          name, root: path, projects: [], build: [], autostart: [],
        };
        await invoke("save_solution", { root: path, solution: empty });
        set({
          solution: empty,
          bannerState: "none",
          bannerMessage: null,
          pendingAncestor: null,
          pendingPath: null,
          bannerAncestor: null,
        });
      } catch (err) {
        const msg = `Failed to create solution: ${String(err)}`;
        logErr(msg);
        set({ bannerState: "error", bannerMessage: msg, pendingAncestor: null, pendingPath: null });
      }
      return;
    }

    if (choice === "add-existing") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          filters: [{ name: "Craidd Project", extensions: ["craidd"] }],
        });
        if (typeof selected !== "string") {
          set({
            pendingAncestor: null,
            pendingPath: null,
            bannerState: "no-solution",
            bannerMessage: null,
          });
          return;
        }

        const name = path.split("/").filter(Boolean).pop() || "solution";
        const empty: CraiddSolution = {
          name, root: path, projects: [], build: [], autostart: [],
        };
        await invoke("save_solution", { root: path, solution: empty });

        set({
          solution: empty,
          bannerState: "none",
          bannerMessage: null,
          pendingAncestor: null,
          pendingPath: null,
          bannerAncestor: null,
        });

        await get().addExistingProject(selected);
      } catch (err) {
        const msg = `Failed to add existing project: ${String(err)}`;
        logErr(msg);
        set({ bannerState: "error", bannerMessage: msg, pendingAncestor: null, pendingPath: null });
      }
    }
  },

  dismissError: () => set({ solutionError: null, bannerState: "none", bannerMessage: null }),

  clearSolution: () => set({
    rootPath: null, solution: null, discovery: null, tabs: [], activeFileId: null,
    solutionError: null, bannerState: "none", bannerMessage: null,
    pendingAncestor: null, pendingPath: null, bannerAncestor: null,
  }),

  refreshDiscovery: async () => {
    const state = get();
    if (!state.rootPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_tree", { path: state.rootPath });
      set({ discovery, rootMissing: false });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("does not exist") || msg.includes("No such file")) {
        logErr("refreshDiscovery: root folder is gone:", state.rootPath);
        set({
          rootMissing: true,
          solution: null,
          discovery: null,
          tabs: [],
          activeFileId: null,
          bannerState: "none",
          bannerMessage: null,
        });
      } else {
        logErr("refreshDiscovery failed:", err);
      }
    }
  },

  clearRootMissing: () => set({
    rootMissing: false,
    rootPath: null,
    solution: null,
    discovery: null,
    tabs: [],
    activeFileId: null,
    bannerState: "none",
    bannerMessage: null,
    pendingAncestor: null,
    pendingPath: null,
    bannerAncestor: null,
  }),

  addProject: async ({ name, language, folder, kind }) => {
    const state = get();
    if (!state.rootPath) throw new Error("No folder is open.");

    const existing = state.solution;
    if (language === "config" && existing) {
      const owner = existing.projects.find(
        (p) => p.folder === folder && p.language && p.language !== "config"
      );
      if (owner) { await get().addConfigHere(owner.id); return; }
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const others = existing ? existing.projects.filter((p) => !(p.folder === folder && p.language === language)) : [];
    const existingAtFolder = existing?.projects.find((p) => p.folder === folder && p.language === language);

    const id = name.replace(/[^A-Za-z0-9_]/g, "") || folder.split("/").filter(Boolean).pop() || "project";
    const folderName = folder.split("/").filter(Boolean).pop() || "project";
    const craiddRelPath = folder === "." || folder === "" ? `${folderName}.craidd` : `${folder}/${folderName}.craidd`;

    const project: CraiddProject = {
      id, name, language, root: ".", kind: kind ?? "application", path: craiddRelPath, folder,
      configEnabled: existingAtFolder?.configEnabled ?? false,
      configName: existingAtFolder?.configName,
      configDirectory: existingAtFolder?.configDirectory,
    };

    await invoke("save_project", { root: state.rootPath, project });

    const solutionName = state.discovery?.name ?? "solution";
    const nextSolution: CraiddSolution = {
      name: existing?.name ?? solutionName,
      root: state.rootPath,
      projects: [...others, project],
      build: existing?.build ?? [],
      autostart: existing?.autostart ?? [],
      runDefault: existing?.runDefault,
      debugDefault: existing?.debugDefault,
    };
    await invoke("save_solution", { root: state.rootPath, solution: nextSolution });

    const populated = await populateTrees(state.rootPath, project);
    set({
      solution: {
        ...nextSolution,
        projects: nextSolution.projects.map((p) =>
          p.folder === folder && p.language === language ? populated : p
        ),
      },
    });

    await get().refreshDiscovery();
  },

  addExistingProject: async (craiddPath) => {
    const state = get();
    if (!state.rootPath) throw new Error("No solution is open.");
    const { invoke } = await import("@tauri-apps/api/core");

    const rootNoSlash = state.rootPath.replace(/\/+$/, "");
    let rel: string;
    if (craiddPath.startsWith(rootNoSlash + "/")) {
      rel = craiddPath.slice(rootNoSlash.length + 1);
    } else {
      rel = craiddPath;
    }

    const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";

    const raw = await invoke<string>("read_file", { path: craiddPath });
    const parsed = parseCraidd(raw);
    if (!parsed) throw new Error("Could not parse .craidd");

    const project: CraiddProject = {
      id: (parsed.name || "project").replace(/[^A-Za-z0-9_]/g, ""),
      name: parsed.name || "project",
      language: parsed.language ?? (parsed.configEnabled ? "config" : null),
      root: parsed.root || ".",
      kind: parsed.kind || "application",
      path: rel,
      folder,
      configEnabled: parsed.configEnabled,
      configName: parsed.configName,
      configDirectory: parsed.configDirectory,
      external: !craiddPath.startsWith(rootNoSlash + "/"),
    };

    const existing = state.solution;
    const solutionName = existing?.name ?? state.discovery?.name ?? "solution";
    const others = existing ? existing.projects.filter((p) => p.path !== rel) : [];
    const nextSolution: CraiddSolution = {
      name: existing?.name ?? solutionName,
      root: state.rootPath,
      projects: [...others, project],
      build: existing?.build ?? [],
      autostart: existing?.autostart ?? [],
      runDefault: existing?.runDefault,
      debugDefault: existing?.debugDefault,
    };
    await invoke("save_solution", { root: state.rootPath, solution: nextSolution });

    const populated = await populateTrees(state.rootPath, project);
    set({
      solution: {
        ...nextSolution,
        projects: nextSolution.projects.map((p) => (p.path === rel ? populated : p)),
      },
    });
  },

  createBlankProject: async ({ name, language, subfolder }) => {
    const state = get();
    if (!state.rootPath) throw new Error("No solution is open.");
    const { invoke } = await import("@tauri-apps/api/core");
    const folder = subfolder.replace(/^\/+|\/+$/g, "");
    await invoke("create_project_folder", { root: state.rootPath, subfolder: folder });
    await get().addProject({ name, language, folder, kind: "application" });
  },

  createFile: async (parentPath, name, content = "") => {
    const state = get();
    const { invoke } = await import("@tauri-apps/api/core");
    const cleanParent = parentPath.replace(/\/+$/, "");
    const fullPath = `${cleanParent}/${name}`;

    await invoke("write_file", { path: fullPath, content });

    await get().refreshDiscovery();
    if (state.solution) {
      const solution = state.solution;
      const refreshed: CraiddProject[] = [];
      for (const pr of solution.projects) {
        refreshed.push(await populateTrees(state.rootPath ?? "", pr));
      }
      set({ solution: { ...solution, projects: refreshed } });
    }

    await get().openFile(fullPath, name);
    return fullPath;
  },

  createFolder: async (parentPath, name) => {
    const state = get();
    const { invoke } = await import("@tauri-apps/api/core");
    const cleanParent = parentPath.replace(/\/+$/, "");
    const fullPath = `${cleanParent}/${name}`;

    await invoke("create_folder", { path: fullPath });

    await get().refreshDiscovery();
    if (state.solution) {
      const solution = state.solution;
      const refreshed: CraiddProject[] = [];
      for (const pr of solution.projects) {
        refreshed.push(await populateTrees(state.rootPath ?? "", pr));
      }
      set({ solution: { ...solution, projects: refreshed } });
    }
    return fullPath;
  },

  declarePlaceholder: async (projectPath, { name, language, kind }) => {
    const state = get();
    if (!state.rootPath || !state.solution) throw new Error("No solution is open.");
    const { invoke } = await import("@tauri-apps/api/core");

    const folder = projectPath.includes("/") ? projectPath.slice(0, projectPath.lastIndexOf("/")) : ".";

    const project: CraiddProject = {
      id: name.replace(/[^A-Za-z0-9_]/g, ""),
      name,
      language,
      root: ".",
      kind: kind ?? "application",
      path: projectPath,
      folder,
      configEnabled: false,
    };

    await invoke("save_project", { root: state.rootPath, project });

    const populated = await populateTrees(state.rootPath, project);
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) =>
          p.path === projectPath ? populated : p
        ),
      },
    });
    await get().refreshDiscovery();
  },

  addConfigHere: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project || project.missing) return;

    const { invoke } = await import("@tauri-apps/api/core");
    const updated: CraiddProject = {
      ...project,
      configEnabled: true,
      configName: project.configName ?? `${project.name} (Config)`,
      configDirectory: undefined,
    };
    await invoke("save_project", { root: state.rootPath, project: updated });
    const populated = await populateTrees(state.rootPath, updated);
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) => (p.id === projectId ? populated : p)),
      },
    });
    await get().refreshDiscovery();
  },

  setConfigDirectory: async (projectId, directory) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project || project.missing) return;

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
        projects: state.solution.projects.map((p) => (p.id === projectId ? populated : p)),
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
      configTree: null,
      configTreeError: null,
    };
    await invoke("save_project", { root: state.rootPath, project: updated });
    set({
      solution: {
        ...state.solution,
        projects: state.solution.projects.map((p) => (p.id === projectId ? updated : p)),
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
        projects: state.solution.projects.map((p) => (p.id === projectId ? populated : p)),
      },
    });
  },

  heal: async () => {
    const state = get();
    if (!state.rootPath || !state.solution) return 0;
    const { invoke } = await import("@tauri-apps/api/core");
    const found = await invoke<string[]>("scan_craidd_files", { path: state.rootPath });
    const existingPaths = new Set(state.solution.projects.map((p) => p.path));
    const orphans = found.filter((p) => !existingPaths.has(p));
    if (orphans.length === 0) return 0;

    log(`heal: found ${orphans.length} orphan(s)`, orphans);

    const additions: CraiddProject[] = [];
    for (const rel of orphans) {
      try {
        const abs = joinRoot(state.rootPath, rel);
        const raw = await invoke<string>("read_file", { path: abs });
        const parsed = parseCraidd(raw);
        if (!parsed) continue;
        const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
        additions.push({
          id: (parsed.name || "project").replace(/[^A-Za-z0-9_]/g, ""),
          name: parsed.name || "project",
          language: parsed.language ?? (parsed.configEnabled ? "config" : null),
          root: parsed.root || ".",
          kind: parsed.kind || "application",
          path: rel,
          folder,
          configEnabled: parsed.configEnabled,
          configName: parsed.configName,
          configDirectory: parsed.configDirectory,
        });
      } catch (err) {
        logErr("heal: failed to load orphan", rel, err);
      }
    }

    if (additions.length === 0) return 0;

    const merged: CraiddSolution = {
      ...state.solution,
      projects: [...state.solution.projects, ...additions],
    };
    await invoke("save_solution", { root: state.rootPath, solution: merged });

    const withTrees: CraiddProject[] = [...state.solution.projects];
    for (const a of additions) withTrees.push(await populateTrees(state.rootPath, a));
    set({ solution: { ...merged, projects: withTrees } });
    return additions.length;
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
      const monacoLanguage = monacoLanguageForFilename(fileName);
      const tab: EditorTab = { fileId: absolutePath, name: fileName, language, monacoLanguage, content };
      set({ tabs: [...state.tabs, tab], activeFileId: absolutePath });
    } catch (err) {
      const msg = `Could not open ${absolutePath}: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
    }
  },

  closeTab: (fileId) => set((s) => {
    const tabs = s.tabs.filter((t) => t.fileId !== fileId);
    let activeFileId = s.activeFileId;
    if (activeFileId === fileId) activeFileId = tabs.length > 0 ? tabs[tabs.length - 1].fileId : null;
    return { tabs, activeFileId };
  }),

  setActiveFile: (fileId) => {
    set({ activeFileId: fileId });
    // Fire-and-forget disk refresh for the newly focused tab.
    void get().refreshDiskStateFor(fileId);
  },

  updateTabContent: (fileId, content) => set((s) => ({
    tabs: s.tabs.map((t) =>
      t.fileId === fileId
        ? { ...t, content, dirty: content !== t.originalContent }
        : t
    ),
  })),

  saveFile: async (fileId, force = false) => {
    const state = get();
    const tab = state.tabs.find((t) => t.fileId === fileId);
    if (!tab) return "error";
    const { invoke } = await import("@tauri-apps/api/core");

    try {
      const stats = await invoke<{ path: string; exists: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths: [fileId] }
      );
      const cur = stats[0];

      // Conflict: disk changed behind us, and the user hasn't forced.
      if (!force && cur && cur.exists && cur.mtimeMs > tab.mtimeAtLastSync + 1) {
        return "conflict";
      }

      await invoke("write_file_allow_overwrite", { path: fileId, content: tab.content }).catch(async () => {
        // Fallback: the original write_file refuses when the file exists.
        // We need an overwrite path — call fs directly.
        const { invoke: inv } = await import("@tauri-apps/api/core");
        await inv("overwrite_file", { path: fileId, content: tab.content });
      });

      const after = await invoke<{ path: string; exists: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths: [fileId] }
      );
      const mtimeAtLastSync = after[0]?.mtimeMs ?? 0;

      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.fileId === fileId
            ? { ...t, originalContent: t.content, dirty: false, diskState: "inSync", mtimeAtLastSync }
            : t
        ),
      }));
      return "saved";
    } catch (err) {
      logErr("saveFile failed:", err);
      return "error";
    }
  },

  saveFileAs: async (oldFileId, newPath) => {
    const state = get();
    const tab = state.tabs.find((t) => t.fileId === oldFileId);
    if (!tab) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("overwrite_file", { path: newPath, content: tab.content });
      const after = await invoke<{ path: string; exists: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths: [newPath] }
      );
      const mtimeAtLastSync = after[0]?.mtimeMs ?? 0;
      const fileName = newPath.split(/[\/]/).pop() ?? tab.name;
      const language = languageFromFilename(fileName);

      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.fileId === oldFileId
            ? { ...t, fileId: newPath, name: fileName, language, originalContent: t.content, dirty: false, diskState: "inSync", mtimeAtLastSync }
            : t
        ),
        activeFileId: s.activeFileId === oldFileId ? newPath : s.activeFileId,
      }));
    } catch (err) {
      logErr("saveFileAs failed:", err);
    }
  },

  refreshDiskStates: async () => {
    const state = get();
    if (state.tabs.length === 0) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const paths = state.tabs.map((t) => t.fileId);
      const stats = await invoke<{ path: string; exists: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths }
      );
      const byPath = new Map(stats.map((s) => [s.path, s]));
      set((s) => ({
        tabs: s.tabs.map((t) => {
          const st = byPath.get(t.fileId);
          if (!st) return t;
          let diskState: "inSync" | "deleted" | "newer" = "inSync";
          if (!st.exists) diskState = "deleted";
          else if (st.mtimeMs > t.mtimeAtLastSync + 1) diskState = "newer";
          return t.diskState === diskState ? t : { ...t, diskState };
        }),
      }));
    } catch (err) {
      logErr("refreshDiskStates failed:", err);
    }
  },

  refreshDiskStateFor: async (fileId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.fileId === fileId);
    if (!tab) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const stats = await invoke<{ path: string; exists: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths: [fileId] }
      );
      const st = stats[0];
      if (!st) return;
      let diskState: "inSync" | "deleted" | "newer" = "inSync";
      if (!st.exists) diskState = "deleted";
      else if (st.mtimeMs > tab.mtimeAtLastSync + 1) diskState = "newer";
      if (diskState === tab.diskState) return;
      set((s) => ({
        tabs: s.tabs.map((t) => (t.fileId === fileId ? { ...t, diskState } : t)),
      }));
    } catch (err) {
      logErr("refreshDiskStateFor failed:", err);
    }
  },

  discardTab: (fileId) => set((s) => {
    const tabs = s.tabs.filter((t) => t.fileId !== fileId);
    let activeFileId = s.activeFileId;
    if (activeFileId === fileId) activeFileId = tabs.length > 0 ? tabs[tabs.length - 1].fileId : null;
    return { tabs, activeFileId };
  }),
}));

function parseCraidd(text: string): {
  name?: string;
  language?: Language | null;
  root?: string;
  kind?: ProjectKind;
  configEnabled: boolean;
  configName?: string;
  configDirectory?: string;
} | null {
  const lines = text.split("\n");
  let section = "";
  let name: string | undefined;
  let language: string | undefined;
  let root = ".";
  let kind: string | undefined;
  let configEnabled = false;
  let configName: string | undefined;
  let configDirectory: string | undefined;

  const str = (v: string) => {
    const m = v.match(/"((?:[^"\\]|\\.)*)"/);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : undefined;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[project]") { section = "project"; continue; }
    if (line === "[config]") { section = "config"; configEnabled = true; continue; }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (section === "project") {
      if (key === "name") name = str(val);
      if (key === "language") language = str(val);
      if (key === "root") root = str(val) || ".";
      if (key === "kind") kind = str(val);
    } else if (section === "config") {
      if (key === "name") configName = str(val);
      if (key === "enabled") configEnabled = val === "true";
      if (key === "directory") configDirectory = str(val);
    }
  }
  if (!name && !configEnabled) return null;
  return {
    name,
    language: (language as Language) ?? null,
    root,
    kind: (kind as ProjectKind) ?? "application",
    configEnabled,
    configName,
    configDirectory,
  };
}
