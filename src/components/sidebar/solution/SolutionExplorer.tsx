import { useEffect, useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import { languageMeta } from "../../../lib/languages";
import type { Language, FileNode, CraiddProject } from "../../../types/project";
import FileTree from "../FileTree";
import SolutionBanner from "./SolutionBanner";
import NewProjectDialog from "../../dialogs/NewProjectDialog";
import MissingProjectDialog from "../../dialogs/MissingProjectDialog";
import DeleteConfirmDialog from "../../dialogs/DeleteConfirmDialog";
import DeleteProjectDialog from "../../dialogs/DeleteProjectDialog";
import NewFileDialog, { type NewFileMode } from "../../dialogs/NewFileDialog";
import NewFolderDialog from "../../dialogs/NewFolderDialog";
import FineTuneDialog from "../../dialogs/FineTuneDialog";
import ToolchainConfigurationDialog from "../../dialogs/ToolchainConfigurationDialog";
import { useBuild } from "../../../store/buildStore";

export default function SolutionExplorer() {
  const rootPath = useSolution((s) => s.rootPath);
  const solution = useSolution((s) => s.solution);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const refreshProject = useSolution((s) => s.refreshProject);
  const addConfigHere = useSolution((s) => s.addConfigHere);
  const setConfigDirectory = useSolution((s) => s.setConfigDirectory);
  const saveMembership = useSolution((s) => s.saveMembership);
  const removeConfig = useSolution((s) => s.removeConfig);
  const addExistingProject = useSolution((s) => s.addExistingProject);
  const removeProject = useSolution((s) => s.removeProject);
  const requestRename = useSolution((s) => s.requestRename);
  const renamePath = useSolution((s) => s.renamePath);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId?: string; projectMissing?: boolean } | null>(null);
  const [newFileTarget, setNewFileTarget] = useState<{ parentPath: string; language: Language | null; mode: NewFileMode } | null>(null);
  const [newFolderTarget, setNewFolderTarget] = useState<{ parentPath: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [declareTarget, setDeclareTarget] = useState<CraiddProject | null>(null);
  const [treeCtxMenu, setTreeCtxMenu] = useState<{
    x: number; y: number;
    node: FileNode;
    projectId: string;
    basePath: string;
    source: "solution-lang" | "solution-config";
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ node: FileNode; basePath: string } | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{ id: string; name: string; folder: string } | null>(null);
  const [fineTuneTarget, setFineTuneTarget] = useState<{ projectId: string; mode: "fine-tune" | "recalibrate" } | null>(null);
  const [pendingFineTuneName, setPendingFineTuneName] = useState<string | null>(null);
  const [toolchainTarget, setToolchainTarget] = useState<CraiddProject | null>(null);

  // Auto-open Fine Tune for a freshly created project if requested.
  useEffect(() => {
    if (!pendingFineTuneName || !solution) return;
    const created = solution.projects.find((p) => p.name === pendingFineTuneName);
    if (created) {
      setFineTuneTarget({ projectId: created.id, mode: "fine-tune" });
      setPendingFineTuneName(null);
    }
  }, [pendingFineTuneName, solution]);

  useEffect(() => {
    const openFineTune = (event: Event) => {
      const projectId = (event as CustomEvent<string>).detail;
      if (projectId) setFineTuneTarget({ projectId, mode: "fine-tune" });
    };
    window.addEventListener("craidd:fine-tune-project", openFineTune);
    return () => window.removeEventListener("craidd:fine-tune-project", openFineTune);
  }, []);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleOpenExisting = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Craidd Project", extensions: ["craidd"] }],
      });
      if (typeof selected === "string") await addExistingProject(selected);
    } catch (err) {
      console.error("[craidd] Open Existing Project failed:", err);
      alert("Could not open project: " + String(err));
    }
  };

  const handleInlineRenameCommit = async (node: FileNode, newName: string) => {
    if (!rootPath) throw new Error("No folder is open.");
    const oldAbs = buildAbsFromNode(rootPath, node);
    const parentAbs = oldAbs.slice(0, oldAbs.lastIndexOf("/"));
    const newAbs = `${parentAbs}/${newName}`;
    await renamePath(oldAbs, newAbs);
  };

  const handleSetConfigDirectory = async (projectId: string) => {
    try {
      const project = solution?.projects.find((p) => p.id === projectId);
      if (!project || !rootPath) return;

      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;

      const projectAbs = project.folder === "." || project.folder === ""
        ? rootPath
        : `${rootPath.replace(/\/+$/, "")}/${project.folder.replace(/^\/+/, "")}`;

      const rel = relativePath(projectAbs, selected);
      await setConfigDirectory(projectId, rel);
    } catch (err) {
      console.error("[craidd] Change Config Directory failed:", err);
      alert("Could not set config directory: " + String(err));
    }
  };

  const projectBasePath = (projectFolder: string) => {
    if (!rootPath) return "";
    return projectFolder === "." || projectFolder === ""
      ? rootPath
      : `${rootPath.replace(/\/+$/, "")}/${projectFolder.replace(/^\/+/, "")}`;
  };

  const configBasePath = (project: { folder: string; configEnabled: boolean; configDirectory?: string }) => {
    if (!project.configEnabled) return null;
    const base = projectBasePath(project.folder);
    const dir = project.configDirectory;
    if (!dir || dir === "." || dir === "") return base;
    // Resolve relative to the project folder; ".." allowed by user
    const baseParts = base.replace(/\/+$/, "").split("/").filter(Boolean);
    const relParts = dir.replace(/^\/+/, "").split("/");
    for (const part of relParts) {
      if (part === "." || part === "") continue;
      if (part === "..") baseParts.pop();
      else baseParts.push(part);
    }
    return "/" + baseParts.join("/");
  };

  /**
   * A project is "empty for our purposes" when the Fine Tune dialog
   * would render zero non-.craidd rows in either root.
   * Cheap heuristic: language tree or config tree has at least one child
   * that isn't a .craidd.
   */
  const isProjectEmpty = (project: CraiddProject) => {
    const hasNonCraidd = (n: FileNode | null | undefined): boolean => {
      if (!n || !n.children) return false;
      for (const c of n.children) {
        if (c.name.toLowerCase().endsWith(".craidd")) continue;
        return true;
      }
      return false;
    };
    const langHit = hasNonCraidd(project.tree);
    const cfgHit = project.configEnabled && hasNonCraidd(project.configTree);
    return !langHit && !cfgHit;
  };

  // The toolbar selection belongs to this window. Keep the .cln's project order
  // intact and only move the selected project in the rendered explorer.
  const selectedConfig = [...(solution?.inferredConfigs ?? []), ...(solution?.configs ?? [])]
    .find((config) => config.name === selectedConfigName);
  const selectedProjectPath = selectedConfig?.target && selectedConfig.target !== "."
    ? selectedConfig.target : solution?.defaultProject;
  const selectedProject = solution?.projects.find((project) => project.path === selectedProjectPath);
  const orderedProjects = solution && selectedProject
    ? [selectedProject, ...solution.projects.filter((project) => project.path !== selectedProject.path)]
    : solution?.projects ?? [];

  return (
    <div className="flex flex-col min-h-0" style={{ flex: "1 1 55%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
          Solution Explorer
        </span>
      </div>

      <SolutionBanner />

      <div
        className="flex-1 overflow-y-auto scroll-thin py-1"
        onContextMenu={(e) => {
          e.preventDefault();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        onClick={() => setCtxMenu(null)}
      >
        {!rootPath && (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center leading-5">
            No folder open.<br />
            <span className="text-zinc-500">Use File → Open Folder to begin.</span>
          </div>
        )}

        {rootPath && solution && (
          <div className="px-1">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[12.5px] text-zinc-200 font-medium">
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 7h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                <path d="M3 7l2-3h6l2 3" />
              </svg>
              <span className="truncate">{solution.name}</span>
            </div>

            {orderedProjects.map((project) => {
              const meta = project.language ? languageMeta(project.language) : languageMeta("config");
              const isCollapsed = collapsed.has(project.path);
              const projectBase = project.external
                ? (project.path.startsWith("/")
                    ? project.path.slice(0, project.path.lastIndexOf("/"))
                    : `${rootPath.replace(/\/+$/, "")}/${project.path.slice(0, project.path.lastIndexOf("/"))}`)
                : projectBasePath(project.folder);

              return (
                <div key={project.path} className="mt-1">
                  <div
                    onClick={() => toggle(project.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        projectId: project.id,
                        projectMissing: !!project.missing,
                      });
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 ml-2 rounded hover:bg-zinc-800 cursor-pointer text-[12.5px] text-zinc-200 select-none"
                  >
                    <svg className={"w-3 h-3 text-zinc-500 shrink-0 transition-transform " + (isCollapsed ? "" : "rotate-90")}
                         fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span className={"text-[10px] font-mono " + meta.color}>
                      {meta.label.slice(0, 2).toUpperCase()}
                    </span>
                    <span className={"truncate " + (project.missing ? "text-zinc-500 italic" : "")}>
                      {project.name}
                      {project.missing && " (not declared)"}
                    </span>
                    {project.external && (
                      <span title="External project" className="text-[10px] text-yellow-500/80">↗</span>
                    )}
                    <span className="ml-auto text-[10px] text-zinc-600 truncate">
                      {project.folder === "." ? "(root)" : project.folder}
                    </span>
                  </div>

                  {!isCollapsed && !project.missing && (
                    <div>
                      {project.language && project.language !== "config" && (
                        <>
                          {project.treeError ? (
                            <div className="px-6 py-2 text-[11px] text-red-400/80 italic">{project.treeError}</div>
                          ) : project.tree?.children && project.tree.children.length > 0 ? (
                            project.tree.children.map((child) => (
                              <FileTree
                                key={child.id || child.path}
                                node={child}
                                depth={3}
                                basePath={project.treeBasePath ?? projectBase}
                                source="solution-lang"
                                onContext={(x, y, n) => setTreeCtxMenu({
                                  x, y, node: n,
                                  projectId: project.id,
                                  basePath: project.treeBasePath ?? projectBase,
                                  source: "solution-lang",
                                })}
                                onRenameCommit={handleInlineRenameCommit}
                              />
                            ))
                          ) : (
                            <div className="px-6 py-2 text-[11px] text-zinc-600 italic">No matching files.</div>
                          )}
                        </>
                      )}

                      {project.configEnabled && (
                        <div className="mt-1">
                          <div className="flex items-center gap-1 px-2 py-0.5 ml-4 text-[11px] text-zinc-400 select-none">
                            <span className={"text-[9px] font-mono " + languageMeta("config").color}>CF</span>
                            <span className="truncate">{project.configName ?? `${project.name} (Config)`}</span>
                            {project.configDirectory && (
                              <span className="text-[10px] text-zinc-600 ml-1">({project.configDirectory})</span>
                            )}
                          </div>
                          {project.configTree?.children && project.configTree.children.length > 0 ? (
                            project.configTree.children.map((child) => (
                              <FileTree
                                key={child.id || child.path}
                                node={child}
                                depth={5}
                                basePath={project.configBasePath ?? projectBase}
                                source="solution-config"
                                onContext={(x, y, n) => setTreeCtxMenu({
                                  x, y, node: n,
                                  projectId: project.id,
                                  basePath: project.configBasePath ?? projectBase,
                                  source: "solution-config",
                                })}
                                onRenameCommit={handleInlineRenameCommit}
                              />
                            ))
                          ) : (
                            <div className="px-6 py-1 text-[11px] text-zinc-600 italic">No config files here.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!isCollapsed && project.missing && (
                    <div className="px-6 py-2 text-[11px] text-zinc-500 leading-5">
                      This project is not declared.{" "}
                      <button
                        onClick={() => setDeclareTarget(project)}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Redeclare
                      </button>
                      , or{" "}
                      <button
                        onClick={() => removeProject(project.id)}
                        className="text-yellow-400 hover:text-yellow-300"
                      >
                        Remove project from solution
                      </button>
                      .
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {treeCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTreeCtxMenu(null)} />
          <div
            style={{ left: treeCtxMenu.x, top: treeCtxMenu.y }}
            className="fixed z-50 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
          >
            <button
              onClick={() => {
                requestRename(
                  buildAbsFromNode(treeCtxMenu.basePath, treeCtxMenu.node),
                  treeCtxMenu.source,
                );
                setTreeCtxMenu(null);
              }}
              className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >
              Rename…
            </button>
            <button
              onClick={() => {
                setDeleteTarget({ node: treeCtxMenu.node, basePath: treeCtxMenu.basePath });
                setTreeCtxMenu(null);
              }}
              className="w-full px-3 py-1 text-left text-red-300 hover:bg-red-700 hover:text-white"
            >
              Delete
            </button>
            <div className="my-1 h-px bg-zinc-800" />
            <button
              onClick={() => {
                const target = treeCtxMenu;
                setTreeCtxMenu(null);
                const project = solution?.projects.find((p) => p.id === target.projectId);
                if (!project) return;
                const path = target.node.path;
                const isConfig = target.source === "solution-config";
                void saveMembership(project.id, {
                  mainInclude: isConfig ? project.mainInclude : (project.mainInclude ?? []).filter((p) => p !== path),
                  mainExclude: isConfig ? project.mainExclude : [...new Set([...(project.mainExclude ?? []), path])],
                  configInclude: isConfig ? (project.configInclude ?? []).filter((p) => p !== path) : project.configInclude,
                  configExclude: isConfig ? [...new Set([...(project.configExclude ?? []), path])] : project.configExclude,
                }).catch((err) => alert(`Could not change membership: ${String(err)}`));
              }}
              className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >
              {treeCtxMenu.source === "solution-config" ? "Remove from Config" : "Remove from Project"}
            </button>
          </div>
        </>
      )}

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div style={{ left: ctxMenu.x, top: ctxMenu.y }}
               className="fixed z-50 min-w-[240px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs">
            {ctxMenu.projectId && ctxMenu.projectMissing ? (
              // ── Stale project (not declared) ──
              <>
                <div className="px-3 py-1.5 text-[11px] text-zinc-500 italic border-b border-zinc-800">
                  {solution?.projects.find((p) => p.id === ctxMenu.projectId)?.name}
                  {" "}
                  <span className="text-zinc-600">(not declared)</span>
                </div>
                <button
                  onClick={() => {
                    const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                    if (!project) return;
                    setDeclareTarget(project);
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Redeclare Project…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => {
                    const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                    if (!project) return;
                    setToolchainTarget(project);
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Toolchain Configuration…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => {
                    if (ctxMenu.projectId) removeProject(ctxMenu.projectId);
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-yellow-300 hover:bg-yellow-950/40"
                >
                  Remove Project
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => { refreshProject(ctxMenu.projectId!); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Refresh Project
                </button>
              </>
            ) : ctxMenu.projectId ? (
              // ── Normal project ──
              <>
                <button
                  onClick={() => { refreshProject(ctxMenu.projectId!); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Refresh Project
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => {
                    const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                    if (!project || !rootPath) return;
                    setNewFileTarget({
                      parentPath: projectBasePath(project.folder),
                      language: project.language ?? null,
                      mode: "project",
                    });
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Add ▸ New File…
                </button>
                <button
                  onClick={() => {
                    const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                    if (!project || !rootPath) return;
                    setNewFolderTarget({ parentPath: projectBasePath(project.folder) });
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Add ▸ New Folder…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                {(() => {
                  const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                  const empty = !project || isProjectEmpty(project);
                  const baseCls = "w-full px-3 py-1 text-left ";
                  const enabledCls = "text-zinc-200 hover:bg-blue-700 hover:text-white";
                  const disabledCls = "text-zinc-600 cursor-default";
                  return (
                    <>
                      <button
                        disabled={empty}
                        onClick={() => {
                          if (empty) return;
                          setFineTuneTarget({ projectId: ctxMenu.projectId!, mode: "fine-tune" });
                          setCtxMenu(null);
                        }}
                        className={baseCls + (empty ? disabledCls : enabledCls)}
                      >
                        Fine Tune…
                      </button>
                      <button
                        disabled={empty}
                        onClick={() => {
                          if (empty) return;
                          setFineTuneTarget({ projectId: ctxMenu.projectId!, mode: "recalibrate" });
                          setCtxMenu(null);
                        }}
                        className={baseCls + (empty ? disabledCls : enabledCls)}
                      >
                        Recalibrate…
                      </button>
                    </>
                  );
                })()}
                <div className="my-1 h-px bg-zinc-800" />
                {!solution?.projects.find((p) => p.id === ctxMenu.projectId)?.configEnabled ? (
                  <button
                    onClick={() => { addConfigHere(ctxMenu.projectId!); setCtxMenu(null); }}
                    className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                  >
                    Add Config Project Here
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { handleSetConfigDirectory(ctxMenu.projectId!); setCtxMenu(null); }}
                      className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                    >
                      Change Config Directory…
                    </button>
                    <button
                      onClick={() => { removeConfig(ctxMenu.projectId!); setCtxMenu(null); }}
                      className="w-full px-3 py-1 text-left text-zinc-300 hover:bg-red-700 hover:text-white"
                    >
                      Remove Config
                    </button>
                  </>
                )}
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => {
                    if (ctxMenu.projectId) removeProject(ctxMenu.projectId);
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-yellow-300 hover:bg-yellow-950/40"
                >
                  Remove Project
                </button>
                {(() => {
                  const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                  const atRoot = !project || project.folder === "." || project.folder === "";
                  return (
                    <button
                      disabled={atRoot}
                      title={atRoot ? "This project is at the solution root. Use File Discovery to manage it." : ""}
                      onClick={() => {
                        if (atRoot || !project) return;
                        setDeleteProjectTarget({
                          id: project.id,
                          name: project.name,
                          folder: project.folder,
                        });
                        setCtxMenu(null);
                      }}
                      className={
                        "w-full px-3 py-1 text-left " +
                        (atRoot
                          ? "text-zinc-600 cursor-default"
                          : "text-red-300 hover:bg-red-950/40")
                      }
                    >
                      Delete Project…
                    </button>
                  );
                })()}
              </>
            ) : (
              <>
                <button
                  onClick={() => { setNewOpen(true); setCtxMenu(null); }}
                  disabled={!rootPath}
                  className={"w-full px-3 py-1 text-left " + (!rootPath ? "text-zinc-600 cursor-default" : "text-zinc-200 hover:bg-blue-700 hover:text-white")}
                >
                  Add → New Blank Project…
                </button>
                <button
                  onClick={() => { handleOpenExisting(); setCtxMenu(null); }}
                  disabled={!rootPath}
                  className={"w-full px-3 py-1 text-left " + (!rootPath ? "text-zinc-600 cursor-default" : "text-zinc-200 hover:bg-blue-700 hover:text-white")}
                >
                  Add → Existing Project…
                </button>
              </>
            )}
          </div>
        </>
      )}

      {deleteProjectTarget && (
        <DeleteProjectDialog
          projectId={deleteProjectTarget.id}
          projectName={deleteProjectTarget.name}
          projectFolder={deleteProjectTarget.folder}
          siblingCount={(() => {
            const target = deleteProjectTarget;
            return (solution?.projects ?? []).filter(
              (p) => p.folder === target.folder && !p.missing
            ).length;
          })()}
          onClose={() => setDeleteProjectTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          node={deleteTarget.node}
          basePath={deleteTarget.basePath}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {newOpen && (
        <NewProjectDialog
          onClose={(opts) => {
            setNewOpen(false);
            if (opts?.fineTuneAfter) setPendingFineTuneName(opts.projectName ?? null);
          }}
        />
      )}
      {newFileTarget && (
        <NewFileDialog
          parentPath={newFileTarget.parentPath}
          projectLanguage={newFileTarget.language}
          mode={newFileTarget.mode}
          onClose={() => setNewFileTarget(null)}
        />
      )}
      {newFolderTarget && (
        <NewFolderDialog
          parentPath={newFolderTarget.parentPath}
          onClose={() => setNewFolderTarget(null)}
        />
      )}
      {declareTarget && (
        <MissingProjectDialog
          project={declareTarget}
          onClose={() => setDeclareTarget(null)}
        />
      )}
      {toolchainTarget && (
        <ToolchainConfigurationDialog
          project={toolchainTarget}
          onClose={() => setToolchainTarget(null)}
        />
      )}
      {fineTuneTarget && (() => {
        const project = solution?.projects.find((p) => p.id === fineTuneTarget.projectId);
        if (!project || !rootPath) return null;
        const base = project.treeBasePath ?? (project.external
          ? (project.path.startsWith("/")
              ? project.path.slice(0, project.path.lastIndexOf("/"))
              : `${rootPath.replace(/\/+$/, "")}/${project.path.slice(0, project.path.lastIndexOf("/"))}`)
          : projectBasePath(project.folder));
        return (
          <FineTuneDialog
            project={project}
            projectBaseAbs={base}
            configBaseAbs={project.configEnabled ? (project.configBasePath ?? configBasePath(project)) : null}
            mode={fineTuneTarget.mode}
            onClose={() => setFineTuneTarget(null)}
          />
        );
      })()}
    </div>
  );
}

function buildAbsFromNode(rootPath: string, node: FileNode): string {
  const base = rootPath.replace(/\/+$/, "");
  const rel = node.path;
  if (!rel || rel === ".") return base;
  return `${base}/${rel.replace(/^\/+/, "")}`;
}

function relativePath(from: string, to: string): string {
  const f = from.replace(/\/+$/, "").split("/").filter(Boolean);
  const t = to.replace(/\/+$/, "").split("/").filter(Boolean);
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  const ups = f.length - i;
  const downs = t.slice(i);
  const parts = [...Array(ups).fill(".."), ...downs];
  return parts.join("/") || ".";
}
