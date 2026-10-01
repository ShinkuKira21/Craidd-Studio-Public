import { useState } from "react";
import { useSolution } from "../../store/solutionStore";
import DiffDialog from "./DiffDialog";
import { requestFileSave } from "../../lib/fileActions";

export default function SaveConflictDialog({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const tabs = useSolution((s) => s.tabs);
  const reloadTabFromDisk = useSolution((s) => s.reloadTabFromDisk);
  const [showDiff, setShowDiff] = useState(false);
  const tab = tabs.find((t) => t.fileId === fileId);

  if (!tab) {
    onClose();
    return null;
  }

  const handleOverwrite = async () => {
    try { await requestFileSave(fileId, true); onClose(); }
    catch (error) { alert(`Save failed: ${String(error)}`); }
  };

  const handleLoadLatest = async () => {
    await reloadTabFromDisk(fileId);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50">
        <div className="w-[520px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
            Newer version exists on disk
          </div>
          <div className="px-4 py-4 text-xs text-zinc-400 leading-5">
            <div className="mb-2">
              <span className="text-zinc-200 font-mono">{tab.name}</span> has been modified
              on disk since you opened it.
            </div>
            <div className="text-zinc-500">
              Your unsaved changes and the disk version may conflict.
            </div>
          </div>
          <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowDiff(true)}
              className="px-3 py-1 rounded text-xs text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
            >
              Review Changes
            </button>
            <button
              onClick={handleLoadLatest}
              className="px-3 py-1 rounded text-xs text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
              title="Discards your unsaved changes"
            >
              Load Latest (discard mine)
            </button>
            <button
              onClick={handleOverwrite}
              className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
            >
              Overwrite
            </button>
          </div>
        </div>
      </div>
      {showDiff && (
        <DiffDialog fileId={fileId} onClose={() => setShowDiff(false)} />
      )}
    </>
  );
}
