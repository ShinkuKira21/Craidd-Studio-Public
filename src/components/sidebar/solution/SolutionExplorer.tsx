import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import { languageMeta } from "../../../lib/languages";
import FileTree from "../FileTree";
import SolutionBanner from "./SolutionBanner";
import NewProjectDialog from "../../dialogs/NewProjectDialog";
import DeclarePlaceholderDialog from "../../dialogs/DeclarePlaceholderDialog";

export default function SolutionExplorer() {
  const rootPath = useSolution((s) => s.rootPath);
  const solution = useSolution((s) => s.solution);
  const refreshProject = useSolution((s) => s.refreshProject);
  const addConfigHere = useSolution((s) => s.addConfigHere);
  const setConfigDirectory = useSolution((s) => s.setConfigDirectory);
  const removeConfig = useSolution((s) => s.removeConfig);
  const addExistingProject = useSolution((s) => s.addExistingProject);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId?: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [declareTarget, setDeclareTarget] = useState<{ path: string; name: string } | null>(null);

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

  const handleSetConfigDirectory = async (projectId: string) => {
    try {
      const project = solution?.projects.find((p) => p.id === projectId);
      if (!project || !rootPath) return;

      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;

      // Compute relative path from the project's folder to the selected folder.
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

            {solution.projects.map((project) => {
              const meta = project.language ? languageMeta(project.language) : languageMeta("config");
              const isCollapsed = collapsed.has(project.path);
              const projectBase = project.external
                ? (project.path.startsWith("/")
                    ? project.path.slice(0, project.path.lastIndexOf("/"))
                    : `${rootPath.replace(/\/+$/, "")}/${project.path.slice(0, project.path.lastIndexOf("/"))}`)
                : `${rootPath.replace(/\/+$/, "")}/${project.folder === "." ? "" : project.folder}`;

              return (
                <div key={project.path} className="mt-1">
                  <div
                    onClick={() => toggle(project.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({ x: e.clientX, y: e.clientY, projectId: project.id });
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
                              <FileTree key={child.id || child.path} node={child} depth={3} basePath={projectBase} />
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
                              <FileTree key={child.id || child.path} node={child} depth={5} basePath={projectBase} />
                            ))
                          ) : (
                            <div className="px-6 py-1 text-[11px] text-zinc-600 italic">No config files here.</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {!isCollapsed && project.missing && (
                    <div className="px-6 py-2 text-[11px]">
                      <button
                        onClick={() => setDeclareTarget({ path: project.path, name: project.name })}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        Declare Project…
                      </button>
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
          <div style={{ left: ctxMenu.x, top: ctxMenu.y }}
               className="fixed z-50 min-w-[240px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs">
            {ctxMenu.projectId ? (
              <>
                <button
                  onClick={() => { refreshProject(ctxMenu.projectId!); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Refresh Project
                </button>
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

      {newOpen && <NewProjectDialog onClose={() => setNewOpen(false)} />}
      {declareTarget && (
        <DeclarePlaceholderDialog
          projectPath={declareTarget.path}
          guessedName={declareTarget.name}
          onClose={() => setDeclareTarget(null)}
        />
      )}
    </div>
  );
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
