import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import type { FileNode } from "../../../types/project";
import FileTree from "../FileTree";
import MakeProjectDialog from "../../dialogs/MakeProjectDialog";

export default function FileDiscovery() {
  const rootPath = useSolution((s) => s.rootPath);
  const discovery = useSolution((s) => s.discovery);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [dialogNode, setDialogNode] = useState<FileNode | null>(null);

  return (
    <div className="flex flex-col min-h-0 border-t border-zinc-800" style={{ flex: "1 1 45%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
          File Discovery
        </span>
        <span className="ml-auto text-[10px] text-zinc-600 normal-case">on disk</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {!discovery || !rootPath ? (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center">
            Nothing loaded.
          </div>
        ) : (
          <FileTree
            node={discovery}
            depth={0}
            basePath={rootPath}
            defaultOpen={true}
            onContext={(x, y, n) => setCtxMenu({ x, y, node: n })}
          />
        )}
      </div>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            className="fixed z-50 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
          >
            {ctxMenu.node.kind === "folder" ? (
              <button
                onClick={() => {
                  setDialogNode(ctxMenu.node);
                  setCtxMenu(null);
                }}
                className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
              >
                Make This a Project…
              </button>
            ) : (
              <div className="px-3 py-1 text-zinc-600 italic">
                (select a folder to make a project)
              </div>
            )}
          </div>
        </>
      )}

      {dialogNode && (
        <MakeProjectDialog node={dialogNode} onClose={() => setDialogNode(null)} />
      )}
    </div>
  );
}
