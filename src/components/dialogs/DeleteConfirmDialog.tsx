import { useState } from "react";
import type { FileNode } from "../../types/project";
import { useSolution } from "../../store/solutionStore";

export default function DeleteConfirmDialog({
  node,
  basePath,
  onClose,
}: {
  node: FileNode;
  basePath: string;
  onClose: () => void;
}) {
  const deletePath = useSolution((s) => s.deletePath);
  const tabs = useSolution((s) => s.tabs);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abs = buildAbs(basePath, node);
  const isFolder = node.kind === "folder";
  const childCount = countChildren(node);
  const isOpen = tabs.some((t) => t.fileId === abs);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await deletePath(abs, isFolder);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={submitting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[500px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-red-300 font-medium">
          Delete {isFolder ? "folder" : "file"} — {node.name}
        </div>

        <div className="px-4 py-4 space-y-3 text-xs text-zinc-400 leading-5">
          {isFolder && childCount > 0 && (
            <div>
              <span className="text-red-400 font-medium">
                {childCount} item{childCount === 1 ? "" : "s"}
              </span>{" "}
              will be removed permanently.
            </div>
          )}

          {isOpen && (
            <div className="text-zinc-300 bg-zinc-800/60 border border-zinc-700 rounded px-2.5 py-2">
              <span className="text-zinc-100">This file is open in the editor.</span>{" "}
              It will be deleted from disk, but the tab will stay open with a{" "}
              <span className="text-red-400">red dot</span> until you close it
              yourself.
            </div>
          )}

          <div className="text-zinc-500 border-t border-zinc-800 pt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span>Git status</span>
              <span className="text-zinc-400 italic">
                not yet available — Git integration lands in Phase 2.2b
              </span>
            </div>
            <div className="text-[11px] text-zinc-600 leading-4">
              When Git is detected, files that are committed will delete with
              no confirmation at all. This dialog is a temporary safeguard
              until that lands. See <span className="font-mono">docs/philosophy-delete.md</span>.
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-3 py-1 rounded text-xs bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
          >
            {submitting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildAbs(basePath: string, node: FileNode): string {
  const rel = node.path && node.path !== "." ? node.path : node.name;
  return `${basePath.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
}

function countChildren(node: FileNode): number {
  if (!node.children) return 0;
  let n = 0;
  for (const c of node.children) {
    n += 1;
    if (c.kind === "folder") n += countChildren(c);
  }
  return n;
}
