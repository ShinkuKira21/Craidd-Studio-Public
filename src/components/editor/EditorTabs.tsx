import { useEffect } from "react";
import { useSolution } from "../../store/solutionStore";
import { languageMeta } from "../../lib/languages";
import type { EditorTab } from "../../types/project";

// Returns the CSS colour for a tab's status dot, or null for "no dot".
// Precedence: deleted > newer > dirty > saved.
function dotClass(tab: EditorTab): string | null {
  if (tab.diskState === "deleted") return "bg-red-500";
  if (tab.diskState === "newer") return "bg-yellow-500";
  if (tab.dirty) return "bg-zinc-200";
  return null;
}

export default function EditorTabs({
  requestClose,
}: {
  requestClose: (fileId: string) => void;
}) {
  // Editing changes tab content on every keystroke. Tab chrome only needs
  // to repaint when its label or status changes.
  useSolution((s) => s.tabs.map((t) =>
    `${t.fileId}\u0000${t.name}\u0000${t.language}\u0000${t.dirty}\u0000${t.diskState}`
  ).join("\u0001"));
  const tabs = useSolution.getState().tabs;
  const activeFileId = useSolution((s) => s.activeFileId);
  const setActiveFile = useSolution((s) => s.setActiveFile);
  const closeTab = useSolution((s) => s.closeTab);

  // When the active tab changes, scroll it into view horizontally.
  useEffect(() => {
    if (!activeFileId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeFileId)}"]`
    );
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeFileId]);

  return (
    <div className="h-9 bg-zinc-900 border-b border-zinc-800 flex items-stretch overflow-x-auto scroll-thin shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.fileId === activeFileId;
        const langColor =
          tab.language === "plaintext"
            ? "text-zinc-500"
            : languageMeta(tab.language).color;
        const dot = dotClass(tab);

        const onClose = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (tab.dirty || tab.diskState === "deleted") {
            requestClose(tab.fileId);
          } else {
            closeTab(tab.fileId);
          }
        };

        return (
          <div
            key={tab.fileId}
            data-tab-id={tab.fileId}
            onClick={() => setActiveFile(tab.fileId)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                if (tab.dirty || tab.diskState === "deleted") requestClose(tab.fileId);
                else closeTab(tab.fileId);
              }
            }}
            title={tab.fileId}
            className={
              "group flex items-center gap-2 px-3 border-r border-zinc-800 cursor-pointer select-none " +
              (isActive
                ? "bg-zinc-950 text-zinc-100 border-t-2 border-t-blue-500"
                : "text-zinc-400 hover:bg-zinc-800 border-t-2 border-t-transparent")
            }
          >
            <svg aria-hidden="true" className={"w-3 h-3 shrink-0 " + langColor} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 1.75h6l4 4v8.5H3z" /><path d="M9 1.75v4h4" />
            </svg>
            <span className="text-xs whitespace-nowrap">{tab.name}</span>
            {dot && <span title={tab.diskState === "deleted" ? "Deleted on disk" : tab.diskState === "newer" ? "Changed on disk" : "Unsaved changes"} className={"w-2 h-2 rounded-full shrink-0 " + dot} />}
            <button
              onClick={onClose}
              title={`Close ${tab.name}`}
              aria-label={`Close ${tab.name}`}
              className="w-4 h-4 flex items-center justify-center opacity-70 group-hover:opacity-100"
            >
              <span className="text-zinc-600 hover:text-zinc-200 text-sm leading-none">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
