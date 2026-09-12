import ProjectExplorer from "./ProjectExplorer";
import FileExplorer from "./FileExplorer";

export default function Sidebar() {
  return (
    <div className="bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden shrink-0 h-full w-full">
      <ProjectExplorer />
      <FileExplorer />
    </div>
  );
}
