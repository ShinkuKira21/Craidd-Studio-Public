import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import type { FileNode } from "../../../types/project";
import FileTree from "../FileTree";
import MakeProjectDialog from "../../dialogs/MakeProjectDialog";

export default function FileDiscovery() {
  const rootPath = useSolution((s) => s.rootPath);
  const discovery = useSolution((s) => s.discovery);
  const refreshDiscovery = useSolution((s) => s.refreshDiscovery);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [dialogNode, setDialogNode] = useState<FileNode | null>(null);

  return (
    <div className="flex flex-col min-h-0 border-t border-zinc-800" style={{ flex: "1 1 45%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">File Discovery</span>
        <span className="ml-auto text-[10px] text-zinc-600 normal-case">on disk</span>
        <button title="Refresh" onClick={() => refreshDiscovery()}
                className="p-1 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {!discovery || !rootPath ? (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center">Nothing loaded.</div>
        ) : (
          <FileTree node={discovery} depth={0} basePath={rootPath} defaultOpen={true}
                    onContext={(x, y, n) => setCtxMenu({ x, y, node: n })} />
        )}
      </div>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div style={{ left: ctxMenu.x, top: ctxMenu.y }}
               className="fixed z-50 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs">
            {ctxMenu.node.kind === "folder" ? (
              <button
                onClick={() => { setDialogNode(ctxMenu.node); setCtxMenu(null); }}
                className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
              >
                Make This a Project…
              </button>
            ) : (
              <div className="px-3 py-1 text-zinc-600 italic">(select a folder)</div>
            )}
          </div>
        </>
      )}

      {dialogNode && <MakeProjectDialog node={dialogNode} onClose={() => setDialogNode(null)} />}
    </div>
  );
}
