import { useSolution } from "../../store/solutionStore";
import { requestFileSave } from "../../lib/fileActions";

export default function DeletedFileDialog({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const tabs = useSolution((s) => s.tabs);
  const saveFileAs = useSolution((s) => s.saveFileAs);
  const closeTab = useSolution((s) => s.closeTab);
  const tab = tabs.find((t) => t.fileId === fileId);

  if (!tab) {
    onClose();
    return null;
  }

  const handleSave = async () => {
    try { await requestFileSave(fileId, true, () => closeTab(fileId)); onClose(); }
    catch (error) { alert(`Save failed: ${String(error)}`); }
  };

  const handleSaveAs = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const chosen = await save({ defaultPath: fileId });
      if (typeof chosen === "string") {
        await saveFileAs(fileId, chosen);
        onClose();
      }
    } catch (err) {
      console.error("[craidd] Save As from deleted prompt failed:", err);
      alert(`Save As failed: ${String(err)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50">
      <div className="w-[460px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          File deleted on disk
        </div>
        <div className="px-4 py-4 text-xs text-zinc-400 leading-5">
          <div className="mb-2">
            <span className="text-zinc-200 font-mono">{tab.name}</span> was deleted on disk
            since you opened it.
          </div>
          <div className="text-zinc-500">
            Save will recreate the file at its original path.
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
            onClick={handleSaveAs}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Save As…
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
