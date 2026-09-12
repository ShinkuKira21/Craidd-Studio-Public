import { useWorkspace } from "../../store/workspaceStore";
import TreeItem from "./TreeItem";

export default function ProjectExplorer() {
  const project = useWorkspace((s) => s.project);
  const expandedNodes = useWorkspace((s) => s.expandedNodes);
  const toggleNode = useWorkspace((s) => s.toggleNode);

  return (
    <div className="flex flex-col min-h-0" style={{ flex: "1 1 55%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">
          Project Explorer
        </span>
        <span className="ml-auto text-[10px] text-zinc-600 normal-case">by language</span>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {project.trees.map((tree) => {
          const isExpanded = expandedNodes.has(tree.id);
          return (
            <div key={tree.id} className="px-1">
              <div
                onClick={() => toggleNode(tree.id)}
                className="flex items-center gap-1 px-1 py-[3px] rounded hover:bg-zinc-800 cursor-pointer text-zinc-200 select-none"
              >
                <svg
                  className={"w-3 h-3 text-zinc-500 shrink-0 transition-transform " + (isExpanded ? "rotate-90" : "")}
                  fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <span className="shrink-0 text-[13px]">{tree.icon}</span>
                <span className="font-medium text-[12.5px] truncate">{tree.label}</span>
                <span className="ml-auto text-[10px] text-zinc-600 truncate">{tree.root}</span>
              </div>
              {isExpanded && (
                <div>
                  {tree.nodes.map((node) => (
                    <TreeItem key={node.id} node={node} depth={2} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
