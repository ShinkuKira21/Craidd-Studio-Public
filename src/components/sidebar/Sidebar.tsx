import SolutionExplorer from "./solution/SolutionExplorer";
import FileDiscovery from "./discovery/FileDiscovery";

export default function Sidebar() {
  return (
    <div className="bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden shrink-0 h-full w-full">
      <SolutionExplorer />
      <FileDiscovery />
    </div>
  );
}
