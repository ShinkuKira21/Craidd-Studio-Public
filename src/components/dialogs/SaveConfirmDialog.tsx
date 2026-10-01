import { useSolution } from "../../store/solutionStore";
import { requestFileSave } from "../../lib/fileActions";

export default function SaveConfirmDialog({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const tabs = useSolution((s) => s.tabs);
  const discardTab = useSolution((s) => s.discardTab);
  const tab = tabs.find((t) => t.fileId === fileId);

  if (!tab) {
    onClose();
    return null;
  }

  const deleted = tab.diskState === "deleted";

  const handleSave = async () => {
    try { await requestFileSave(fileId, deleted, () => discardTab(fileId)); onClose(); }
    catch (error) { alert(`Save failed: ${String(error)}`); }
  };

  const handleDiscard = () => {
    discardTab(fileId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50">
      <div className="w-[440px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          {deleted ? "File deleted on disk" : "Unsaved changes"}
        </div>
        <div className="px-4 py-4 text-xs text-zinc-400 leading-5">
          {deleted ? (
            <>The file <span className="text-zinc-200 font-mono">{tab.name}</span> was deleted on disk since you opened it.</>
          ) : (
            <>Save changes to <span className="text-zinc-200 font-mono">{tab.name}</span> before closing?</>
          )}
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleDiscard}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-red-800"
          >
            Don't Save
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
