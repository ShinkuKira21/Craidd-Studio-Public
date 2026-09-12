import { useSolution } from "../../store/solutionStore";
import { languageMeta } from "../../lib/languages";

export default function EditorTabs() {
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const setActiveFile = useSolution((s) => s.setActiveFile);
  const closeTab = useSolution((s) => s.closeTab);

  return (
    <div className="h-9 bg-zinc-900 border-b border-zinc-800 flex items-stretch overflow-x-auto scroll-thin shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.fileId === activeFileId;
        const color =
          tab.language === "plaintext"
            ? "bg-zinc-500"
            : languageMeta(tab.language as any).color.replace("text-", "bg-");
        return (
          <div
            key={tab.fileId}
            onClick={() => setActiveFile(tab.fileId)}
            onAuxClick={(e) => {
              // Middle click = close
              if (e.button === 1) {
                e.preventDefault();
                closeTab(tab.fileId);
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
            <span className={"w-2 h-2 rounded-full " + color} />
            <span className="text-xs whitespace-nowrap">{tab.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.fileId); }}
              className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-zinc-200 opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
