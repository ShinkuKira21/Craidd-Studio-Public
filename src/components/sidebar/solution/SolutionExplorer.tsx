import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import { languageMeta } from "../../../lib/languages";
import FileTree from "../FileTree";

export default function SolutionExplorer() {
  const rootPath = useSolution((s) => s.rootPath);
  const solution = useSolution((s) => s.solution);
  const discovery = useSolution((s) => s.discovery);
  const refreshProject = useSolution((s) => s.refreshProject);
  const addConfigHere = useSolution((s) => s.addConfigHere);
  const removeConfig = useSolution((s) => s.removeConfig);
  const setConfigDirectory = useSolution((s) => s.setConfigDirectory);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId?: string } | null>(null);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSetConfigDirectory = async (projectId: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string" || !rootPath) return;
      // Convert absolute path to a path relative to the .craidd's folder
      const project = solution?.projects.find((p) => p.id === projectId);
      if (!project) return;
      const projectAbs = project.folder === "." || project.folder === ""
        ? rootPath
        : `${rootPath.replace(/\/+$/, "")}/${project.folder.replace(/^\/+/, "")}`;
      const rel = relativePath(projectAbs, selected);
      await setConfigDirectory(projectId, rel);
    } catch (err) {
      console.error("[craidd] Set Config Directory failed:", err);
    }
  };

  return (
    <div className="flex flex-col min-h-0" style={{ flex: "1 1 55%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
          Solution Explorer
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin py-1" onClick={() => setCtxMenu(null)}>
        {!discovery && (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center leading-5">
            No folder open.<br />
            <span className="text-zinc-500">Use File → Open Folder to begin.</span>
          </div>
        )}
        {discovery && !solution && (
          <div className="px-3 py-4 text-[12px] text-zinc-500 leading-5">
            <div className="text-zinc-300 mb-1">No Craidd Solution yet.</div>
            <div className="text-zinc-600">
              Right-click a folder in <span className="text-zinc-400">File Discovery</span> below and choose "Make This a Project".
            </div>
          </div>
        )}
        {solution && rootPath && (
          <div className="px-1">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[12.5px] text-zinc-200 font-medium">
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 7h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                <path d="M3 7l2-3h6l2 3" />
              </svg>
              <span className="truncate">{solution.name}</span>
            </div>

            {solution.projects.map((project) => {
              const meta = project.language ? languageMeta(project.language) : languageMeta("config");
              const isCollapsed = collapsed.has(project.id);
              const projectBase = project.folder === "." || project.folder === ""
                ? rootPath
                : `${rootPath.replace(/\/+$/, "")}/${project.folder.replace(/^\/+/, "")}`;

              return (
                <div key={project.id} className="mt-1">
                  {/* Project header */}
                  <div
                    onClick={() => toggle(project.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({ x: e.clientX, y: e.clientY, projectId: project.id });
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 ml-2 rounded hover:bg-zinc-800 cursor-pointer text-[12.5px] text-zinc-200 select-none"
                  >
                    <svg
                      className={"w-3 h-3 text-zinc-500 shrink-0 transition-transform " + (isCollapsed ? "" : "rotate-90")}
                      fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span className={"text-[10px] font-mono " + meta.color}>
                      {meta.label.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{project.name}</span>
                    <span className="ml-auto text-[10px] text-zinc-600 truncate">
                      {project.folder === "." || project.folder === "" ? "(root)" : project.folder}
                    </span>
                  </div>

                  {!isCollapsed && (
                    <div>
                      {/* Source files */}
                      {project.language && project.language !== "config" && (
                        <>
                          {project.treeError ? (
                            <div className="px-6 py-2 text-[11px] text-red-400/80 italic">
                              {project.treeError}
                            </div>
                          ) : project.tree?.children && project.tree.children.length > 0 ? (
                            project.tree.children.map((child) => (
                              <FileTree
                                key={child.id || child.path}
                                node={child}
                                depth={3}
                                basePath={projectBase}
                              />
                            ))
                          ) : (
                            <div className="px-6 py-2 text-[11px] text-zinc-600 italic">
                              No matching files.
                            </div>
                          )}
                        </>
                      )}

                      {/* Config subsection */}
                      {project.configEnabled && (
                        <div className="mt-1">
                          <div className="flex items-center gap-1 px-2 py-0.5 ml-4 text-[11px] text-zinc-400 select-none">
                            <svg className="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                            <span className={"text-[9px] font-mono " + languageMeta("config").color}>CF</span>
                            <span className="truncate">
                              {project.configName ?? `${project.name} (Config)`}
                            </span>
                          </div>
                          {project.configTreeError ? (
                            <div className="px-6 py-2 text-[11px] text-red-400/80 italic">
                              {project.configTreeError}
                            </div>
                          ) : project.configTree?.children && project.configTree.children.length > 0 ? (
                            <ConfigNodes
                              basePath={configBase(projectBase, project.configDirectory)}
                              node={project.configTree}
                            />
                          ) : (
                            <div className="px-6 py-1 text-[11px] text-zinc-600 italic">
                              No config files here.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            className="fixed z-50 min-w-[240px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
          >
            {ctxMenu.projectId ? (
              <>
                <button
                  onClick={() => {
                    refreshProject(ctxMenu.projectId!);
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Refresh Project
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                {!solution?.projects.find((p) => p.id === ctxMenu.projectId)?.configEnabled ? (
                  <button
                    onClick={() => {
                      addConfigHere(ctxMenu.projectId!);
                      setCtxMenu(null);
                    }}
                    className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                  >
                    Add Config Project Here
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        handleSetConfigDirectory(ctxMenu.projectId!);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                    >
                      Change Config Directory…
                    </button>
                    <button
                      onClick={() => {
                        removeConfig(ctxMenu.projectId!);
                        setCtxMenu(null);
                      }}
                      className="w-full px-3 py-1 text-left text-zinc-300 hover:bg-red-700 hover:text-white"
                    >
                      Remove Config
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button disabled className="w-full px-3 py-1 text-left text-zinc-600 cursor-default">
                  Add → New Project (Phase 2.1)
                </button>
                <button disabled className="w-full px-3 py-1 text-left text-zinc-600 cursor-default">
                  Add → Project From Folder (Phase 2.1)
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ConfigNodes({
  basePath,
  node,
}: {
  basePath: string;
  node: import("../../../types/project").FileNode;
}) {
  if (!node.children) return null;
  return (
    <>
      {node.children.map((child) => (
        <FileTree
          key={child.id || child.path}
          node={child}
          depth={5}
          basePath={basePath}
        />
      ))}
    </>
  );
}

function configBase(projectBase: string, dir: string | undefined): string {
  if (!dir || dir === ".") return projectBase;
  if (dir === "..") {
    const parts = projectBase.replace(/\/+$/, "").split("/");
    parts.pop();
    return parts.join("/") || "/";
  }
  return `${projectBase.replace(/\/+$/, "")}/${dir.replace(/^\.\//, "").replace(/^\/+/, "")}`;
}

function relativePath(from: string, to: string): string {
  // Best-effort relative path. If they share a prefix, strip it.
  const f = from.replace(/\/+$/, "").split("/");
  const t = to.replace(/\/+$/, "").split("/");
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  const ups = f.length - i;
  const downs = t.slice(i);
  const rel = [...Array(ups).fill(".."), ...downs].join("/");
  return rel || ".";
}
