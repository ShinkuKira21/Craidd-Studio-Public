import { useState } from "react";
import type { FileNode } from "../../types/project";
import { useSolution } from "../../store/solutionStore";

interface Props {
  node: FileNode;
  depth: number;
  rootPath: string;
  onContext?: (x: number, y: number, node: FileNode) => void;
  defaultOpen?: boolean;
}

export default function FileTree({ node, depth, rootPath, onContext, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen || depth < 1);
  const openFile = useSolution((s) => s.openFile);
  const activeFileId = useSolution((s) => s.activeFileId);
  const isFolder = node.kind === "folder";
  const indent = { paddingLeft: `${8 + depth * 12}px` };

  const handleClick = () => {
    if (isFolder) setOpen((v) => !v);
    else {
      const rel = node.path && node.path !== "." ? node.path : node.name;
      const abs = `${rootPath.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
      openFile(abs, node.name);
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        onContextMenu={(e) => {
          if (onContext) { e.preventDefault(); onContext(e.clientX, e.clientY, node); }
        }}
        style={indent}
        title={node.path}
        className="flex items-center gap-1 pr-2 py-[3px] rounded cursor-pointer text-[12.5px] text-zinc-300 hover:bg-zinc-800 select-none"
      >
        {isFolder ? (
          <svg className={"w-3 h-3 shrink-0 text-zinc-500 transition-transform " + (open ? "rotate-90" : "")}
               fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 18l6-6-6-6" />
          </svg>
        ) : <span className="w-3 shrink-0" />}
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
      </div>
      {isFolder && open && node.children?.map((child) => (
        <FileTree key={child.id || child.path} node={child} depth={depth + 1} rootPath={rootPath} onContext={onContext} />
      ))}
    </>
  );
}
