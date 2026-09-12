import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import { languageMeta } from "../../../lib/languages";
import FileTree from "../FileTree";

export default function SolutionExplorer() {
  const rootPath = useSolution((s) => s.rootPath);
  const solution = useSolution((s) => s.solution);
  const discovery = useSolution((s) => s.discovery);
  const refreshProject = useSolution((s) => s.refreshProject);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId?: string } | null>(null);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const treeRootPath = rootPath ?? "";

  return (
    <div className="flex flex-col min-h-0" style={{ flex: "1 1 55%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">Solution Explorer</span>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin py-1" onClick={() => setCtxMenu(null)}>
        {!discovery && (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center leading-5">
            No folder open.<br /><span className="text-zinc-500">Use File → Open Folder to begin.</span>
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
        {solution && (
          <div className="px-1">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[12.5px] text-zinc-200 font-medium">
              <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M3 7h18v11a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /><path d="M3 7l2-3h6l2 3" />
              </svg>
              <span className="truncate">{solution.name}</span>
            </div>

            {solution.projects.map((project) => {
              const meta = languageMeta(project.language);
              const isCollapsed = collapsed.has(project.id);
              return (
                <div key={project.id} className="mt-1">
                  <div
                    onClick={() => toggle(project.id)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, projectId: project.id }); }}
                    className="flex items-center gap-1.5 px-2 py-1 ml-2 rounded hover:bg-zinc-800 cursor-pointer text-[12.5px] text-zinc-200 select-none"
                  >
                    <svg className={"w-3 h-3 text-zinc-500 shrink-0 transition-transform " + (isCollapsed ? "" : "rotate-90")}
                         fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span className={"text-[10px] font-mono " + meta.color}>{meta.label.slice(0, 2).toUpperCase()}</span>
                    <span className="truncate">{project.name}</span>
                    <span className="ml-auto text-[10px] text-zinc-600 truncate">
                      {project.folder === "." || project.folder === "" ? "(root)" : project.folder}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <div>
                      {project.treeError ? (
                        <div className="px-6 py-2 text-[11px] text-red-400/80 italic">{project.treeError}</div>
                      ) : project.tree && project.tree.children && project.tree.children.length > 0 ? (
                        project.tree.children.map((child) => (
                          <FileTree key={child.id || child.path} node={child} depth={3} rootPath={treeRootPath} />
                        ))
                      ) : (
                        <div className="px-6 py-2 text-[11px] text-zinc-600 italic">No matching files.</div>
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
          <div style={{ left: ctxMenu.x, top: ctxMenu.y }}
               className="fixed z-50 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs">
            {ctxMenu.projectId ? (
              <button
                onClick={() => { refreshProject(ctxMenu.projectId!); setCtxMenu(null); }}
                className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
              >
                Refresh Project
              </button>
            ) : (
              <>
                <button disabled className="w-full px-3 py-1 text-left text-zinc-600 cursor-default">Add → New Project (Phase 2.1)</button>
                <button disabled className="w-full px-3 py-1 text-left text-zinc-600 cursor-default">Add → Project From Folder (Phase 2.1)</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
