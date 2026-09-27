import { create } from "zustand";
import type {
  CraiddSolution,
  CraiddProject,
  ConfigEntry,
  FileNode,
  EditorTab,
  Language,
  Manifest,
  ProjectKind,
} from "../types/project";
import { languageFromFilename, monacoLanguageForFilename, projectExtensions, projectWellKnownFiles, languageMeta } from "../lib/languages";
import { seedMainChoices, syncMainChoices } from "./buildStore";

export interface AncestorInfo {
  clnPath: string;
  clnName: string;
  solutionName: string;
}

export type TreeSource = "discovery" | "solution-lang" | "solution-config";

export interface RenameRequest {
  path: string;
  source: TreeSource;
  tick: number;
}

export type OpenResult =
  | { status: "loaded" }
  | { status: "no-solution" }
  | { status: "needs-decision"; ancestor: AncestorInfo }
  | { status: "error"; message: string };

type BannerState = "none" | "no-solution" | "inside-parent" | "error";

interface SolutionState {
  rootPath: string | null;
  clnPath: string | null;
  solution: CraiddSolution | null;
  isSolutionLoading: boolean;
  solutionError: string | null;
  discovery: FileNode | null;
  tabs: EditorTab[];
  activeFileId: string | null;
  navigation: { fileId: string; line: number; column: number; serial: number } | null;

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
  repointProject: (projectId: string, newCraiddAbs: string) => Promise<void>;
  redeclareProject: (projectId: string, args: { name: string; language: Language }) => Promise<void>;
  moveProjectTo: (projectId: string, newFolderAbs: string, chosenLanguage?: Language) => Promise<void>;

  saveConfigurations: (configs: ConfigEntry[], defaultConfig?: string) => Promise<void>;
  addConfigHere: (projectId: string) => Promise<void>;
  setConfigDirectory: (projectId: string, directory: string) => Promise<void>;
  saveMembership: (projectId: string, overrides: Pick<CraiddProject, "mainInclude" | "mainExclude" | "configInclude" | "configExclude">) => Promise<void>;
  removeConfig: (projectId: string) => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  refreshProjectMarkers: () => Promise<void>;
  heal: () => Promise<number>;

  renamePath: (oldPath: string, newPath: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string, deleteFolder: boolean) => Promise<void>;
  deletePath: (path: string, recursive: boolean) => Promise<void>;

  openFile: (absolutePath: string, fileName: string) => Promise<void>;
  revealFile: (absolutePath: string, line: number, column: number) => Promise<void>;
  closeTab: (fileId: string) => void;
  setActiveFile: (fileId: string) => void;

  updateTabContent: (fileId: string, content: string) => void;
  renamingRequest: RenameRequest | null;
  requestRename: (path: string, source: TreeSource) => void;
  clearRenameRequest: () => void;
  focusedTreeTarget: { path: string; source: TreeSource } | null;
  setFocusedTreeTarget: (t: { path: string; source: TreeSource } | null) => void;
  pendingSave: { fileId: string; kind: "deleted" | "newer" } | null;
  setPendingSave: (v: { fileId: string; kind: "deleted" | "newer" } | null) => void;
  reloadTabFromDisk: (fileId: string) => Promise<void>;
  saveFile: (fileId: string, force?: boolean) => Promise<"saved" | "conflict" | "error">;
  saveFileAs: (fileId: string, newPath: string) => Promise<void>;
  refreshDiskStates: () => Promise<void>;
  refreshDiskStateFor: (fileId: string) => Promise<void>;
  discardTab: (fileId: string) => void;
}


/** Ensure the required config fields are present on a freshly-loaded
 *  solution, then ask Rust to infer defaults from the projects' manifests.
 *  Inferred entries are stored on `inferredConfigs` and are never written
 *  to disk. */
async function withInferredConfigs(
  solution: CraiddSolution,
): Promise<CraiddSolution> {
  const base: CraiddSolution = {
    ...solution,
    configs: solution.configs ?? [],
    inferredConfigs: [],
  };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const inferred = await invoke<ConfigEntry[]>("infer_configs", {
      solution: base,
    });
    log("infer_configs result:", inferred.map((c) => `${c.name} (${c.kind})`));
    return { ...base, inferredConfigs: inferred };
  } catch (err) {
    logErr("infer_configs failed:", err);
    return base;
  }
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

function toRel(abs: string, root: string): string {
  const rootNoSlash = root.replace(/\/+$/, "");
  return abs.startsWith(rootNoSlash + "/")
    ? abs.slice(rootNoSlash.length + 1)
    : abs;
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
  stopAtCraidd: boolean,
  shallow = false,
  includePaths: string[] = [],
  excludePaths: string[] = [],
): Promise<{ tree: FileNode | null; error: string | null }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const tree = await invoke<FileNode>("read_dir_tree_filtered", {
      path: absolutePath,
      extensions,
      wellKnownFiles,
      stopAtCraidd,
      shallow,
      includePaths,
      excludePaths,
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

/**
 * Batch-stat every project's .craidd in one IPC round-trip.
 * Returns a map keyed by the project's path (as stored in the .cln).
 */
async function statCraidds(
  solutionRoot: string,
  projects: CraiddProject[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (projects.length === 0) return map;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const abs = projects.map((p) => resolveRelPath(solutionRoot, p.path));
    const stats = await invoke<{ path: string; exists: boolean }[]>("stat_files", {
      paths: abs,
    });
    for (let i = 0; i < projects.length; i++) {
      map.set(projects[i].path, stats[i]?.exists ?? false);
    }
  } catch (err) {
    // On stat failure, treat every project as existing (fail-open) so a
    // transient IPC error doesn't blank the whole explorer. The per-project
    // tree walk will surface real errors.
    logErr("statCraidds failed:", err);
    for (const p of projects) map.set(p.path, true);
  }
  return map;
}

async function populateTrees(
  solutionRoot: string,
  project: CraiddProject,
  craiddExists?: Map<string, boolean>
): Promise<CraiddProject> {
  // Verify the .craidd still exists on disk. This is what makes a project
  // go stale the moment its marker is deleted (from File Discovery, from a
  // terminal, by another tool). It also handles the recovery case: a
  // project that was missing and becomes present flips back to declared.
  let exists: boolean;
  if (craiddExists && craiddExists.has(project.path)) {
    exists = craiddExists.get(project.path)!;
  } else {
    // Fallback path (no batch provided): a single stat for this project.
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const abs = resolveRelPath(solutionRoot, project.path);
      const stats = await invoke<{ path: string; exists: boolean }[]>("stat_files", {
        paths: [abs],
      });
      exists = stats[0]?.exists ?? false;
    } catch {
      exists = false;
    }
  }

  if (!exists) {
    return { ...project, missing: true, tree: null, configTree: null };
  }

  const next: CraiddProject = { ...project, missing: false };

  if (project.language && project.language !== "config") {
    const exts = projectExtensions(project.language);
    const wnf = projectWellKnownFiles(project.language);
    const folder = projectFolderAbs(solutionRoot, project);
    const { tree, error } = await readTreeFor(folder, exts, wnf, true, false, project.mainInclude, project.mainExclude);
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
    const { tree, error } = await readTreeFor(configFolder, meta.extensions, [], true, false, project.configInclude, project.configExclude);
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

  // Read manifests from the folders the user's declaration points at.
  // Two folders, maximum, both inside the loaded solution:
  //
  //   1. The project's own resolved folder.
  //   2. The config folder, when [config].directory is declared and
  //      resolves somewhere other than the project folder.
  //
  // No parent walk. No "just in case" inside the project folder. If the
  // user didn't declare a config folder, we assume there isn't one, and
  // the project simply has no manifests outside its own folder.
  //
  // See src-tauri/src/commands/manifests.rs.
  const manifestFolder = projectFolderAbs(solutionRoot, project);
  const collected: Manifest[] = [];
  const seenPaths = new Set<string>();

  const readInto = async (folder: string, label: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const found = await invoke<Manifest[]>("read_manifests", { folder });
      for (const m of found) {
        if (seenPaths.has(m.path)) continue;
        seenPaths.add(m.path);
        collected.push(m);
      }
    } catch (err) {
      logErr(`read_manifests (${label}) failed for`, folder, err);
    }
  };

  await readInto(manifestFolder, "project");

  const configFolder = next.configBasePath;
  if (
    configFolder &&
    configFolder !== manifestFolder &&
    isInside(solutionRoot, configFolder)
  ) {
    await readInto(configFolder, "config");
  }

  next.manifests = collected;
  log("populateTrees: manifests", {
    project: project.path,
    projectFolder: manifestFolder,
    configFolder: configFolder ?? null,
    count: collected.length,
    kinds: collected.map((m) => m.kind),
  });

  return next;
}

// A slower tree read must never put a deleted file back after a newer refresh.
let treeRefreshEpoch = 0;

async function refreshAllProjectTrees(
  get: () => SolutionState,
  set: (partial: Partial<SolutionState>) => void,
): Promise<void> {
  const state = get();
  if (!state.rootPath || !state.solution) return;
  const epoch = ++treeRefreshEpoch;
  const root = state.rootPath;
  const projects = state.solution.projects;
  const statMap = await statCraidds(root, projects);
  const refreshed = await Promise.all(projects.map((p) => populateTrees(root, p, statMap)));
  const latest = get();
  if (epoch !== treeRefreshEpoch || latest.rootPath !== root || latest.solution !== state.solution) return;
  const next = await withInferredConfigs({ ...latest.solution, projects: refreshed });
  if (epoch !== treeRefreshEpoch || get().rootPath !== root || get().solution !== state.solution) return;
  set({ solution: next });
  syncMainChoices(next);
}

export const useSolution = create<SolutionState>((set, get) => ({
  rootPath: null,
  clnPath: null,
  solution: null,
  isSolutionLoading: false,
  solutionError: null,
  discovery: null,
  tabs: [],
  activeFileId: null,
  navigation: null,
  bannerState: "none",
  bannerMessage: null,
  rootMissing: false,
  pendingAncestor: null,
  pendingPath: null,
  bannerAncestor: null,
  pendingSave: null,
  renamingRequest: null,
  focusedTreeTarget: null,

  setPendingSave: (v) => set({ pendingSave: v }),

  requestRename: (path, source) => set({ renamingRequest: { path, source, tick: Date.now() } }),
  clearRenameRequest: () => set({ renamingRequest: null }),
  setFocusedTreeTarget: (t) => set({ focusedTreeTarget: t }),

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
      clnPath: null,
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
      discovery = await invoke<FileNode>("read_dir_children", { root: path, path });
      set({ discovery });
    } catch (err) {
      const msg = `Failed to read folder: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
      return { status: "error", message: msg };
    }

    let loaded: { solution: CraiddSolution; clnPath: string } | null = null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const raw = await invoke<{ solution: CraiddSolution; clnPath: string } | null>(
        "load_solution",
        { path },
      );
      loaded = raw;
      log("load_solution result:", raw ? `${raw.solution.projects.length} projects @ ${raw.clnPath}` : "null");
    } catch (err) {
      const msg = `Failed to load solution: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
      return { status: "error", message: msg };
    }

    if (loaded) {
      // The .cln's own folder is the floor. Not the folder the user opened.
      // If they opened a parent, the .cln wins — the solution defines its root.
      const clnFolder = loaded.clnPath.slice(0, loaded.clnPath.lastIndexOf("/"));
      const effectiveRoot = clnFolder || path;
      const statMap = await statCraidds(effectiveRoot, loaded.solution.projects);
      const withTrees = await Promise.all(
        loaded.solution.projects.map((p) => populateTrees(effectiveRoot, p, statMap)),
      );
      const finalSolution = await withInferredConfigs({
        ...loaded.solution,
        projects: withTrees,
      });
      set({
        rootPath: effectiveRoot,
        solution: finalSolution,
        clnPath: loaded.clnPath,
        isSolutionLoading: false,
        tabs: [],
        activeFileId: null,
        bannerState: "none",
        bannerMessage: null,
      });
      seedMainChoices(finalSolution);
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
      clnPath,
      bannerState: "none",
      bannerMessage: null,
      rootMissing: false,
      pendingAncestor: null,
      pendingPath: null,
      bannerAncestor: null,
    });

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_children", { root, path: root });
      const loaded = await invoke<{ solution: CraiddSolution; clnPath: string } | null>(
        "load_solution_named",
        { path: root, clnName },
      );

      if (!loaded) {
        const msg = `Solution file not found: ${clnName}`;
        logErr(msg);
        set({ discovery, solutionError: msg, bannerState: "error", bannerMessage: msg, isSolutionLoading: false });
        return { status: "error", message: msg };
      }

      log("openSolution loaded:", loaded.solution.projects.length, "projects @", loaded.clnPath);

      const statMap = await statCraidds(root, loaded.solution.projects);
      const withTrees = await Promise.all(
        loaded.solution.projects.map((p) => populateTrees(root, p, statMap)),
      );

      const finalSolution = await withInferredConfigs({
        ...loaded.solution,
        projects: withTrees,
      });
      set({
        solution: finalSolution,
        discovery,
        isSolutionLoading: false,
        tabs: [],
        activeFileId: null,
        bannerState: "none",
        bannerMessage: null,
      });
      seedMainChoices(finalSolution);
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
          configs: [], inferredConfigs: [],
        };
        await invoke("save_solution", { root: path, solution: empty });
        const opened = await get().openFolder(path);
        if (opened.status !== "loaded") throw new Error("Could not reopen the new solution.");
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
          configs: [], inferredConfigs: [],
        };
        await invoke("save_solution", { root: path, solution: empty });
        const opened = await get().openFolder(path);
        if (opened.status !== "loaded") throw new Error("Could not reopen the new solution.");
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
    navigation: null,
    solutionError: null, bannerState: "none", bannerMessage: null,
    pendingAncestor: null, pendingPath: null, bannerAncestor: null,
  }),

  refreshDiscovery: async () => {
    const state = get();
    if (!state.rootPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_children", { root: state.rootPath, path: state.rootPath });
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

    // Refuse duplicate project names within one solution.
    const existingNames = (state.solution?.projects ?? []).map((p) => p.name);
    if (existingNames.includes(name) && !state.solution?.projects.some(
      (p) => p.name === name && p.folder === folder && p.language === language
    )) {
      throw new Error(`A project named "${name}" already exists in this solution.`);
    }

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
    // Ask Rust which filename this project should take — canonical
    // {folder}.craidd if the folder has no .craidd, else {folder}.{lang}.craidd.
    const folderAbs = folder === "." || folder === ""
      ? state.rootPath
      : `${state.rootPath.replace(/\/+$/, "")}/${folder.replace(/^\/+/, "")}`;
    const craiddFileName = await invoke<string>("plan_craidd_filename", {
      folder: folderAbs,
      language,
    });
    const craiddRelPath = folder === "." || folder === ""
      ? craiddFileName
      : `${folder}/${craiddFileName}`;

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
      configs: existing?.configs ?? [],
      inferredConfigs: [],
    };
    await invoke("save_solution", { root: state.rootPath, solution: nextSolution });
    if (!state.clnPath) {
      const opened = await get().openFolder(state.rootPath);
      if (opened.status !== "loaded") throw new Error("Could not reopen the new solution.");
      await get().refreshDiscovery();
      return;
    }

    const populated = await populateTrees(state.rootPath, project);
    const withProjects = {
      ...nextSolution,
      projects: nextSolution.projects.map((p) =>
        p.folder === folder && p.language === language ? populated : p
      ),
    };
    const inferred = await withInferredConfigs(withProjects);
    set({ solution: inferred });
    syncMainChoices(inferred);

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
      configs: existing?.configs ?? [],
      inferredConfigs: [],
    };
    await invoke("save_solution", { root: state.rootPath, solution: nextSolution });
    if (!state.clnPath) {
      const opened = await get().openFolder(state.rootPath);
      if (opened.status !== "loaded") throw new Error("Could not reopen the new solution.");
      return;
    }

    const populated = await populateTrees(state.rootPath, project);
    const withProjects = {
      ...nextSolution,
      projects: nextSolution.projects.map((p) => (p.path === rel ? populated : p)),
    };
    const inferred = await withInferredConfigs(withProjects);
    set({ solution: inferred });
    syncMainChoices(inferred);
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
      const statMap = await statCraidds(state.rootPath ?? "", solution.projects);
      for (const pr of solution.projects) {
        refreshed.push(await populateTrees(state.rootPath ?? "", pr, statMap));
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
      const statMap = await statCraidds(state.rootPath ?? "", solution.projects);
      for (const pr of solution.projects) {
        refreshed.push(await populateTrees(state.rootPath ?? "", pr, statMap));
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

  redeclareProject: async (projectId, { name, language }) => {
    const state = get();
    if (!state.rootPath || !state.solution) throw new Error("No solution is open.");
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found in solution.");
    const { invoke } = await import("@tauri-apps/api/core");

    // Compute the folder the marker would land in.
    const rootNoSlash = state.rootPath.replace(/\/+$/, "");
    const craiddAbs = project.path.startsWith("/")
      ? project.path
      : `${rootNoSlash}/${project.path}`;
    const folderAbs = craiddAbs.slice(0, craiddAbs.lastIndexOf("/"));

    // Invariant 2 — refuse if a live project in this folder already
    // declares this language.
    const claims = await invoke<
      { language: string; files: { path: string }[] }[]
    >("folder_language_claims_cmd", { folder: folderAbs });
    for (const c of claims) {
      if (c.language !== language) continue;
      for (const f of c.files) {
        const rel = toRel(f.path, state.rootPath);
        if (rel === project.path) continue; // it's our own stale
        const live = state.solution.projects.some(
          (p) => p.id !== projectId && p.path === rel,
        );
        if (live) {
          throw new Error(
            `This folder already has a live ${language} project (${f.path.split("/").pop()}). ` +
            `Either pick a different language, or clean up the folder first.`,
          );
        }
      }
    }

    // Wipe + write a fresh marker. This deletes any stale .craidd in
    // the folder — including our own — and recreates one clean marker.
    // Note: wipe_and_recreate deletes *every* .craidd in the folder,
    // so we only call it when there are no live markers of other
    // languages we'd be destroying. The check above ensures that for
    // our language; for other languages, if a live project exists,
    // we must not wipe.
    for (const c of claims) {
      if (c.language === language) continue;
      for (const f of c.files) {
        const rel = toRel(f.path, state.rootPath);
        const live = state.solution.projects.some(
          (p) => p.id !== projectId && p.path === rel,
        );
        if (live) {
          throw new Error(
            `This folder has a live ${c.language} project. ` +
            `Use Option 2 (point at the existing marker) or Option 3 (move elsewhere).`,
          );
        }
      }
    }

    await invoke("wipe_and_recreate_craidd", {
      folder: folderAbs,
      name,
      language,
    });

    // Reload via the .cln.
    if (state.clnPath) {
      await get().openSolution(state.clnPath).catch((e) =>
        logErr("reload after redeclareProject failed:", e),
      );
    }
  },

  repointProject: async (projectId, newCraiddAbs) => {
    const state = get();
    if (!state.rootPath || !state.solution) throw new Error("No solution is open.");
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found in solution.");
    const { invoke } = await import("@tauri-apps/api/core");

    log("[repoint] start", { projectId, oldPath: project.path, newCraiddAbs });

    // 1. Verify the new .craidd exists.
    const stats = await invoke<{ path: string; exists: boolean }[]>("stat_files", {
      paths: [newCraiddAbs],
    });
    if (!stats[0]?.exists) {
      throw new Error(`No file at ${newCraiddAbs}`);
    }

    // 2. Verify it is a marker.
    const raw = await invoke<string>("read_file", { path: newCraiddAbs });
    if (!raw.includes("[project]") && !raw.includes("[config]")) {
      throw new Error("That file is not a .craidd.");
    }

    // 3. Parse its language.
    let markerLanguage: string | null = null;
    {
      let inProject = false;
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (t === "[project]") { inProject = true; continue; }
        if (t.startsWith("[")) { inProject = false; continue; }
        if (!inProject) continue;
        const m = t.match(/^language\s*=\s*"([^"]*)"/);
        if (m) { markerLanguage = m[1]; break; }
      }
    }

    // 4. Compute the new relative path.
    const rootNoSlash = state.rootPath.replace(/\/+$/, "");
    const newRel = newCraiddAbs.startsWith(rootNoSlash + "/")
      ? newCraiddAbs.slice(rootNoSlash.length + 1)
      : newCraiddAbs;

    // 5. Invariant 1 — path already declared by another project?
    const conflictingPath = state.solution.projects.find(
      (p) => p.id !== projectId && p.path === newRel,
    );
    if (conflictingPath) {
      throw new Error(
        `That .craidd is already declared in this solution as "${conflictingPath.name}".`,
      );
    }

    // 6. Invariant 2 — folder already has a live project of this language?
    if (markerLanguage) {
      const folderAbs = newCraiddAbs.slice(0, newCraiddAbs.lastIndexOf("/"));
      const claims = await invoke<
        { language: string; files: { path: string }[] }[]
      >("folder_language_claims_cmd", { folder: folderAbs });
      for (const c of claims) {
        if (c.language !== markerLanguage) continue;
        // Exclude the file we're adopting.
        const others = c.files.filter((f) => f.path !== newCraiddAbs);
        if (others.length === 0) continue;
        // Only live ones count. A live one is declared in this solution.
        const liveOthers = others.filter((f) =>
          state.solution!.projects.some((pr) => pr.path === toRel(f.path, state.rootPath!)),
        );
        if (liveOthers.length > 0) {
          throw new Error(
            `This folder already has a live ${markerLanguage} project. Clean up the folder first.`,
          );
        }
      }
    }

    // 7. Repoint.
    log("[repoint] invoking edit_cln_repoint_entry", { oldPath: project.path, newPath: newRel });
    await invoke("edit_cln_repoint_entry", {
      root: state.rootPath,
      oldPath: project.path,
      newPath: newRel,
    });
    log("[repoint] edit_cln_repoint_entry returned ok");

    // 8. Reload.
    const reloadPath = state.clnPath;
    if (reloadPath) {
      const r = await get().openSolution(reloadPath).catch((e) => {
        logErr("reload after repointProject failed:", e);
        return null;
      });
      log("[repoint] reload result", r);
    } else {
      logErr("[repoint] no clnPath — skipping reload");
    }
  },


  moveProjectTo: async (projectId, newFolderAbs, chosenLanguage) => {
    const state = get();
    if (!state.rootPath || !state.solution) throw new Error("No solution is open.");
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found in solution.");
    const { invoke } = await import("@tauri-apps/api/core");

    log("[move] start", { projectId, oldPath: project.path, newFolderAbs, chosenLanguage });

    // 1. Enumerate markers in the destination folder.
    const markers = await invoke<
      { name: string; path: string; language: string | null }[]
    >("scan_craidd_in_folder_cmd", { folder: newFolderAbs });

    // 2. Determine the language we intend to declare there.
    const targetLanguage = chosenLanguage ?? project.language ?? null;
    if (!targetLanguage) {
      throw new Error("No language selected for the destination.");
    }

    // 3. If a marker of the same language already exists, refuse.
    for (const m of markers) {
      if (m.language === targetLanguage) {
        // Is it the marker we're already pointing at? Then it's fine.
        const rel = toRel(m.path, state.rootPath);
        if (rel === project.path) continue;
        // Is it live? A live marker is declared in the solution.
        const live = state.solution.projects.some(
          (p) => p.id !== projectId && p.path === rel,
        );
        if (live) {
          throw new Error(
            `This folder already has a live ${targetLanguage} project (${m.name}). Clean up the folder first.`,
          );
        }
      }
    }

    // 4. Adopt an existing marker, or write a fresh one.
    let newRel: string;
    const sameLangMarker = markers.find((m) => m.language === targetLanguage);

    if (sameLangMarker) {
      // Adopt it.
      newRel = toRel(sameLangMarker.path, state.rootPath);
      log("[move] adopting existing marker", newRel);
      // Update the project's stored language if the marker declares one.
      if (sameLangMarker.language && sameLangMarker.language !== project.language) {
        const moved = { ...project, language: sameLangMarker.language as Language };
        await invoke("save_project", { root: state.rootPath, project: moved });
      }
    } else {
      // Write a fresh marker.
      const plannedName = await invoke<string>("plan_craidd_filename", {
        folder: newFolderAbs,
        language: targetLanguage,
      });
      const absPath = `${newFolderAbs.replace(/\/+$/, "")}/${plannedName}`;
      newRel = toRel(absPath, state.rootPath);
      const moved = {
        ...project,
        language: targetLanguage,
        path: newRel,
        folder: newRel.includes("/") ? newRel.slice(0, newRel.lastIndexOf("/")) : ".",
      };
      await invoke("save_project", { root: state.rootPath, project: moved });
      log("[move] wrote fresh marker", newRel);
    }

    // 5. Repoint the .cln.
    log("[move] invoking edit_cln_repoint_entry", { oldPath: project.path, newPath: newRel });
    await invoke("edit_cln_repoint_entry", {
      root: state.rootPath,
      oldPath: project.path,
      newPath: newRel,
    });
    log("[move] edit_cln_repoint_entry returned ok");

    // 6. Reload.
    if (state.clnPath) {
      const r = await get().openSolution(state.clnPath).catch((e) => {
        logErr("reload after moveProjectTo failed:", e);
        return null;
      });
      log("[move] reload result", r);
    } else {
      logErr("[move] no clnPath — skipping reload");
    }
  },


  saveConfigurations: async (configs, defaultConfig) => {
    const state = get();
    if (!state.solution || !state.clnPath) throw new Error("No solution file is open.");
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_solution_configs", {
      clnPath: state.clnPath,
      configs,
      defaultConfig: defaultConfig ?? null,
      expectedConfigs: state.solution.configs,
      expectedDefaultConfig: state.solution.defaultConfig ?? null,
    });
    const next = { ...state.solution, configs, defaultConfig };
    set({ solution: next });
    syncMainChoices(next);
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
    const inferred = await withInferredConfigs({
      ...state.solution,
      projects: state.solution.projects.map((p) => (p.id === projectId ? populated : p)),
    });
    set({ solution: inferred });
    syncMainChoices(inferred);
  },

  saveMembership: async (projectId, overrides) => {
    const state = get();
    if (!state.rootPath || !state.solution) throw new Error("No solution is open.");
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project || project.missing) throw new Error("Project is unavailable.");
    const updated = { ...project, ...overrides };
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_project", { root: state.rootPath, project: updated });
    const populated = await populateTrees(state.rootPath, updated);
    set((s) => s.solution ? ({
      solution: {
        ...s.solution,
        projects: s.solution.projects.map((p) => p.id === projectId ? populated : p),
      },
    }) : {});
  },

  setConfigDirectory: async (projectId, directory) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project || project.missing) return;

    const resolvedDirectory = resolveRelPath(projectFolderAbs(state.rootPath, project), directory);
    if (!isInside(state.rootPath, resolvedDirectory)) {
      throw new Error("Config directory must be inside the solution folder.");
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const updated: CraiddProject = {
      ...project,
      configEnabled: true,
      configName: project.configName ?? `${project.name} (Config)`,
      configDirectory: directory,
    };
    await invoke("save_project", { root: state.rootPath, project: updated });
    const populated = await populateTrees(state.rootPath, updated);
    const inferred = await withInferredConfigs({
      ...state.solution,
      projects: state.solution.projects.map((p) => (p.id === projectId ? populated : p)),
    });
    set({ solution: inferred });
    syncMainChoices(inferred);
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
    const populated = await populateTrees(state.rootPath, updated);
    const inferred = await withInferredConfigs({
      ...state.solution,
      projects: state.solution.projects.map((p) => (p.id === projectId ? populated : p)),
    });
    set({ solution: inferred });
    syncMainChoices(inferred);
  },

  refreshProject: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;
    await refreshAllProjectTrees(get, set);
  },

  refreshProjectMarkers: async () => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const projects = state.solution.projects;
    if (projects.length === 0) return;

    // Batch-stat every marker. Compare against the store's current
    // notion of "missing". If nothing changed, do nothing — this is
    // the cheap path, and it's what runs on every focus event.
    const statMap = await statCraidds(state.rootPath, projects);
    let changed = false;
    for (const p of projects) {
      const exists = statMap.get(p.path) ?? true;
      if (exists === !!p.missing) { changed = true; break; }
    }
    if (!changed) return;

    // Something changed on disk. Re-populate the whole solution.
    await refreshAllProjectTrees(get, set);
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

    const allProjects = [...state.solution.projects, ...additions];
    const statMap = await statCraidds(state.rootPath, allProjects);
    const withTrees: CraiddProject[] = [];
    for (const p of state.solution.projects) withTrees.push(await populateTrees(state.rootPath, p, statMap));
    for (const a of additions) withTrees.push(await populateTrees(state.rootPath, a, statMap));
    const inferred = await withInferredConfigs({ ...merged, projects: withTrees });
    set({ solution: inferred });
    syncMainChoices(inferred);
    return additions.length;
  },

  removeProject: async (projectId) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("remove_project", {
        root: state.rootPath,
        craiddPath: project.path,
      });
    } catch (err) {
      const msg = `Could not remove project: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
      return;
    }
    // Reload the solution from disk so the .cln edit is reflected.
    if (state.clnPath) {
      await get().openSolution(state.clnPath).catch((e) => logErr("reload after removeProject failed:", e));
    } else if (state.rootPath) {
      await get().openFolder(state.rootPath).catch((e) => logErr("reload after removeProject failed:", e));
    }
  },

  deleteProject: async (projectId, deleteFolder) => {
    const state = get();
    if (!state.rootPath || !state.solution) return;
    const project = state.solution.projects.find((p) => p.id === projectId);
    if (!project) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("delete_project", {
        root: state.rootPath,
        craiddPath: project.path,
        deleteFolder,
      });
    } catch (err) {
      const msg = `Could not delete project: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
      return;
    }
    if (state.clnPath) {
      await get().openSolution(state.clnPath).catch((e) => logErr("reload after deleteProject failed:", e));
    } else if (state.rootPath) {
      await get().openFolder(state.rootPath).catch((e) => logErr("reload after deleteProject failed:", e));
    }
  },

  renamePath: async (oldPath, newPath) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("rename_path", { from: oldPath, to: newPath });
    const { useBreakpoints } = await import("./breakpointStore");
    try { await useBreakpoints.getState().movePath(oldPath, newPath); }
    catch (error) { logErr("Could not update breakpoint paths after rename:", error); }

    // Update any open tab that pointed at the old path.
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.fileId !== oldPath) return t;
        const name = newPath.split(/[\\/]/).pop() ?? t.name;
        const language = languageFromFilename(name);
        return { ...t, fileId: newPath, name, language };
      }),
      activeFileId: s.activeFileId === oldPath ? newPath : s.activeFileId,
    }));

    await get().refreshDiscovery();
    await refreshAllProjectTrees(get, set);
  },

  deletePath: async (path, recursive) => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_path", { path, recursive });

    // Don't auto-close tabs; let them turn red on next disk refresh.
    // But do refresh immediately so the user sees the change.
    await get().refreshDiskStates();

    await get().refreshDiscovery();
    await refreshAllProjectTrees(get, set);
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
      const stats = await invoke<{ mtimeMs: number }[]>("stat_files", { paths: [absolutePath] });
      const language = languageFromFilename(fileName);
      const monacoLanguage = monacoLanguageForFilename(fileName);
      const tab: EditorTab = {
        fileId: absolutePath,
        name: fileName,
        language,
        monacoLanguage,
        content,
        originalContent: content,
        dirty: false,
        diskState: "inSync",
        mtimeAtLastSync: stats[0]?.mtimeMs ?? 0,
      };
      set({ tabs: [...state.tabs, tab], activeFileId: absolutePath });
    } catch (err) {
      const msg = `Could not open ${absolutePath}: ${String(err)}`;
      logErr(msg);
      set({ solutionError: msg, bannerState: "error", bannerMessage: msg });
    }
  },

  revealFile: async (absolutePath, line, column) => {
    await get().openFile(absolutePath, absolutePath.split("/").pop() || absolutePath);
    if (!get().tabs.some((tab) => tab.fileId === absolutePath)) return;
    set((state) => ({
      activeFileId: absolutePath,
      navigation: { fileId: absolutePath, line: Math.max(1, line), column: Math.max(1, column),
        serial: (state.navigation?.serial ?? 0) + 1 },
    }));
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

  updateTabContent: (fileId, content) => {
    if (get().tabs.find((t) => t.fileId === fileId)?.content === content) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.fileId === fileId
          ? { ...t, content, dirty: content !== t.originalContent }
          : t
      ),
    }));
  },

  saveFile: async (fileId, force = false) => {
    const state = get();
    const tab = state.tabs.find((t) => t.fileId === fileId);
    if (!tab) return "error";
    const { invoke } = await import("@tauri-apps/api/core");

    try {
      const stats = await invoke<{ path: string; exists: boolean; readable: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths: [fileId] }
      );
      const cur = stats[0];

      // Conflict: disk changed behind us, and the user hasn't forced.
      if (!force && cur && cur.exists && cur.mtimeMs > tab.mtimeAtLastSync + 1) {
        return "conflict";
      }

      await invoke("overwrite_file", { path: fileId, content: tab.content });

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
      window.dispatchEvent(new CustomEvent("craidd:file-saved", { detail: fileId }));
      return "saved";
    } catch (err) {
      logErr("saveFile failed:", err);
      return "error";
    }
  },

  saveFileAs: async (oldFileId, newPath) => {
    const state = get();
    const tab = state.tabs.find((t) => t.fileId === oldFileId);
    if (!tab) throw new Error("The file is no longer open.");
    if (state.tabs.some((t) => t.fileId === newPath && t.fileId !== oldFileId)) {
      throw new Error("The destination is already open in another tab.");
    }
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
            ? { ...t, fileId: newPath, name: fileName, language, monacoLanguage: monacoLanguageForFilename(fileName), originalContent: t.content, dirty: false, diskState: "inSync", mtimeAtLastSync }
            : t
        ),
        activeFileId: s.activeFileId === oldFileId ? newPath : s.activeFileId,
      }));
      await get().refreshDiscovery();
      const latest = get();
      if (latest.solution && latest.rootPath) {
        const projects = await Promise.all(latest.solution.projects.map((p) => populateTrees(latest.rootPath!, p)));
        set((s) => s.solution ? ({ solution: { ...s.solution, projects } }) : {});
      }
    } catch (err) {
      logErr("saveFileAs failed:", err);
      throw err;
    }
  },

  refreshDiskStates: async () => {
    const state = get();
    if (state.tabs.length === 0) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const paths = state.tabs.map((t) => t.fileId);
      const stats = await invoke<{ path: string; exists: boolean; readable: boolean; mtimeMs: number; size: number }[]>(
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
          // A file that exists but cannot be read is not deleted. Treating
          // it as in-sync avoids showing a red dot for a permission issue.
          else if (st.readable !== false && st.mtimeMs > t.mtimeAtLastSync + 1) diskState = "newer";
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
      const stats = await invoke<{ path: string; exists: boolean; readable: boolean; mtimeMs: number; size: number }[]>(
        "stat_files",
        { paths: [fileId] }
      );
      const st = stats[0];
      if (!st) return;
      let diskState: "inSync" | "deleted" | "newer" = "inSync";
      if (!st.exists) diskState = "deleted";
      else if (st.readable !== false && st.mtimeMs > tab.mtimeAtLastSync + 1) diskState = "newer";
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
