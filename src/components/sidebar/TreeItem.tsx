import type { FileNode } from "../../types/project";
import { useWorkspace } from "../../store/workspaceStore";
import { useLayout } from "../../store/layoutStore";

interface Props {
  node: FileNode;
  depth: number;
}

const vcsColor: Record<string, string> = {
  M: "bg-yellow-500/20 text-yellow-400",
  A: "bg-green-500/20 text-green-400",
  D: "bg-red-500/20 text-red-400",
  U: "bg-blue-500/20 text-blue-400",
};

export default function TreeItem({ node, depth }: Props) {
  const expandedNodes = useWorkspace((s) => s.expandedNodes);
  const toggleNode = useWorkspace((s) => s.toggleNode);
  const openTab = useWorkspace((s) => s.openTab);
  const tabs = useWorkspace((s) => s.tabs);

  const focusedPaneId = useLayout((s) => s.focusedPaneId);
  const panes = useLayout((s) => s.panes);
  const setPaneFile = useLayout((s) => s.setPaneFile);
  const setFocusedPane = useLayout((s) => s.setFocusedPane);

  const focusedPane = panes.find((p) => p.id === focusedPaneId);
  const isActive = focusedPane?.activeFileId === node.id;

  const isFolder = node.kind === "folder";
  const isExpanded = expandedNodes.has(node.id);

  const handleClick = () => {
    if (isFolder) {
      toggleNode(node.id);
    } else {
      // Open a tab if it's not already open
      if (!tabs.some((t) => t.fileId === node.id)) {
        // Infer language from extension
        const ext = node.name.split(".").pop() ?? "";
        const langMap: Record<string, string> = {
          rs: "rust", ts: "typescript", tsx: "typescript",
          js: "javascript", jsx: "javascript", py: "python",
          json: "json", toml: "toml",
        };
        const language = langMap[ext] ?? "plaintext";
        const treeId = node.id.split("/")[0];
        openTab({ fileId: node.id, treeId, name: node.name, language });
      }
      setFocusedPane(focusedPaneId);
      setPaneFile(focusedPaneId, node.id);
    }
  };

  const indent = { paddingLeft: `${8 + depth * 12}px` };

  return (
    <>
      <div
        onClick={handleClick}
        style={indent}
        className={
          "flex items-center gap-1 pr-2 py-[3px] rounded cursor-pointer text-[12.5px] select-none " +
          (isActive
            ? "bg-blue-900/40 text-zinc-100"
            : "text-zinc-300 hover:bg-zinc-800")
        }
      >
        {isFolder ? (
          <svg
            className={"w-3 h-3 shrink-0 text-zinc-500 transition-transform " + (isExpanded ? "rotate-90" : "")}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="shrink-0">
          {isFolder ? (
            <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
          )}
        </span>
        <span className="truncate">{node.name}</span>
        {node.vcsStatus && (
          <span className={"ml-auto text-[9px] font-bold px-1 rounded " + vcsColor[node.vcsStatus]}>
            {node.vcsStatus}
          </span>
        )}
        {node.hasBreakpoint && !node.vcsStatus && (
          <span className="ml-auto w-2 h-2 rounded-full bg-red-500" />
        )}
      </div>
      {isFolder && isExpanded && node.children?.map((child) => (
        <TreeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}
