import { useEffect, useRef, useState } from "react";
import type { FileNode } from "../../types/project";
import { useSolution, type TreeSource } from "../../store/solutionStore";

interface Props {
  node: FileNode;
  depth: number;
  basePath: string;
  source: TreeSource;
  onContext?: (x: number, y: number, node: FileNode) => void;
  onRenameCommit?: (node: FileNode, newName: string) => Promise<void>;
  defaultOpen?: boolean;
}

export default function FileTree({
  node,
  depth,
  basePath,
  source,
  onContext,
  onRenameCommit,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || depth < 1);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(node.name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTickRef = useRef(0);

  const openFile = useSolution((s) => s.openFile);
  const activeFileId = useSolution((s) => s.activeFileId);
  const renamingRequest = useSolution((s) => s.renamingRequest);
  const setFocusedTreeTarget = useSolution((s) => s.setFocusedTreeTarget);

  const isFolder = node.kind === "folder";
  const absPath = buildAbs(basePath, node);
  const isActive = activeFileId === absPath;
  const indent = { paddingLeft: `${8 + depth * 12}px` };

  useEffect(() => {
    if (!renamingRequest) return;
    if (renamingRequest.path !== absPath) return;
    if (renamingRequest.source !== source) return;
    if (renamingRequest.tick === lastTickRef.current) return;
    lastTickRef.current = renamingRequest.tick;
    setDraftName(node.name);
    setError(null);
    setRenaming(true);
  }, [renamingRequest, absPath, source, node.name]);

  useEffect(() => {
    if (!renaming) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = node.name.lastIndexOf(".");
    if (!isFolder && dot > 0) {
      el.setSelectionRange(0, dot);
    } else {
      el.select();
    }
  }, [renaming, node.name, isFolder]);

  const handleClick = () => {
    setFocusedTreeTarget({ path: absPath, source });
    if (renaming) return;
    if (isFolder) setOpen((v) => !v);
    else openFile(absPath, node.name);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (renaming) return;
    if (!onRenameCommit) return;
    setDraftName(node.name);
    setError(null);
    setRenaming(true);
  };

  const cancel = () => {
    setRenaming(false);
    setError(null);
    setDraftName(node.name);
  };

  const commit = async () => {
    if (!renaming) return;
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === node.name) {
      cancel();
      return;
    }
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      setError("Name cannot contain a slash.");
      return;
    }
    if (!onRenameCommit) {
      cancel();
      return;
    }
    try {
      await onRenameCommit(node, trimmed);
    } catch (err) {
      setError(String(err));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          if (onContext) {
            e.preventDefault();
            e.stopPropagation();
            onContext(e.clientX, e.clientY, node);
          }
        }}
        style={indent}
        title={renaming ? undefined : absPath}
        className={
          "flex items-center gap-1 pr-2 py-[3px] rounded cursor-pointer text-[12.5px] select-none " +
          (isActive ? "bg-blue-900/40 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800")
        }
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
        {renaming ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={(e) => { setDraftName(e.target.value); setError(null); }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={onKeyDown}
            onBlur={() => { void commit(); }}
            className={
              "flex-1 min-w-0 bg-zinc-950 border rounded px-1 py-0 text-[12.5px] text-zinc-100 outline-none " +
              (error ? "border-red-500" : "border-blue-500")
            }
          />
        ) : (
          <span className="truncate">{node.name}</span>
        )}
      </div>
      {renaming && error && (
        <div
          style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}
          className="text-[11px] text-red-400 pb-1"
        >
          {error}
        </div>
      )}
      {isFolder && open && node.children?.map((child) => (
        <FileTree
          key={child.id || child.path}
          node={child}
          depth={depth + 1}
          basePath={basePath}
          source={source}
          onContext={onContext}
          onRenameCommit={onRenameCommit}
        />
      ))}
    </>
  );
}

/**
 * Absolute path from a tree node. `node.path` is authoritative:
 *   ""  or "." → the tree root itself
 *   "foo"      → child of root
 *   "foo/bar"  → grandchild
 * Never fall back to node.name.
 */
function buildAbs(basePath: string, node: FileNode): string {
  const base = basePath.replace(/\/+$/, "");
  const rel = node.path;
  if (!rel || rel === ".") return base;
  return `${base}/${rel.replace(/^\/+/, "")}`;
}
