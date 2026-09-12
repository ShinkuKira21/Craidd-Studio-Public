import { useState } from "react";
import { useWorkspace } from "../../store/workspaceStore";
import { useLayout } from "../../store/layoutStore";

const langDot: Record<string, string> = {
  rust: "bg-orange-400",
  typescript: "bg-blue-400",
  javascript: "bg-yellow-400",
  python: "bg-green-400",
};

export default function EditorTabs({ paneId }: { paneId: string }) {
  const tabs = useWorkspace((s) => s.tabs);
  const closeTab = useWorkspace((s) => s.closeTab);
  const pane = useLayout((s) => s.panes.find((p) => p.id === paneId));
  const setPaneFile = useLayout((s) => s.setPaneFile);
  const setFocusedPane = useLayout((s) => s.setFocusedPane);
  const splitPane = useLayout((s) => s.splitPane);
  const panes = useLayout((s) => s.panes);
  const focusedPaneId = useLayout((s) => s.focusedPaneId);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);

  const activeTabId = pane?.activeFileId ?? null;
  const isFocused = focusedPaneId === paneId;

  return (
    <>
      <div
        className={
          "h-9 bg-zinc-900 border-b border-zinc-800 flex items-stretch overflow-x-auto scroll-thin shrink-0 " +
          (isFocused ? "" : "opacity-80")
        }
        onMouseDown={() => setFocusedPane(paneId)}
      >
        {tabs.map((tab) => {
          const isActive = tab.fileId === activeTabId;
          return (
            <div
              key={tab.fileId}
              onClick={() => { setFocusedPane(paneId); setPaneFile(paneId, tab.fileId); }}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, fileId: tab.fileId });
              }}
              className={
                "group flex items-center gap-2 px-3 border-r border-zinc-800 cursor-pointer select-none " +
                (isActive
                  ? "bg-zinc-950 text-zinc-100 border-t-2 border-t-blue-500"
                  : "text-zinc-400 hover:bg-zinc-800 border-t-2 border-t-transparent")
              }
            >
              <span className={"w-2 h-2 rounded-full " + (langDot[tab.language] ?? "bg-zinc-500")} />
              <span className="text-xs whitespace-nowrap">{tab.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.fileId); if (activeTabId === tab.fileId) setPaneFile(paneId, null); }}
                className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-zinc-200 opacity-0 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            className="fixed z-50 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
          >
            <button
              onClick={() => {
                setPaneFile(paneId, ctxMenu.fileId);
                splitPane(paneId);
                // Move the file into the new pane
                setTimeout(() => {
                  const layout = useLayout.getState();
                  const newPane = layout.panes[layout.panes.length - 1];
                  if (newPane) {
                    layout.setPaneFile(newPane.id, ctxMenu.fileId);
                    layout.setPaneFile(paneId, null);
                  }
                }, 0);
                setCtxMenu(null);
              }}
              disabled={panes.length >= 2}
              className={
                "w-full px-3 py-1 text-left " +
                (panes.length >= 2
                  ? "text-zinc-600 cursor-default"
                  : "text-zinc-200 hover:bg-blue-700 hover:text-white")
              }
            >
              Split Right
            </button>
            <div className="my-1 h-px bg-zinc-800" />
            <button
              onClick={() => { closeTab(ctxMenu.fileId); if (activeTabId === ctxMenu.fileId) setPaneFile(paneId, null); setCtxMenu(null); }}
              className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}
