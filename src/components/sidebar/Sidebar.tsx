import { useLayout } from "../../store/layoutStore";
import SolutionExplorer from "./solution/SolutionExplorer";
import FileDiscovery from "./discovery/FileDiscovery";
import SearchPanel from "./search/SearchPanel";

export default function Sidebar() {
  const activeView = useLayout((s) => s.activeView);

  return (
    <div className="bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden shrink-0 h-full w-full">
      {activeView === "search" ? (
        <SearchPanel />
      ) : (
        <>
          <SolutionExplorer />
          <FileDiscovery />
        </>
      )}
    </div>
  );
}
