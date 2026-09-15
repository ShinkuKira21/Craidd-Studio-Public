import { useState } from "react";
import { useSolution } from "../../store/solutionStore";

export default function DeleteProjectDialog({
  projectId,
  projectName,
  projectFolder,
  siblingCount,
  onClose,
}: {
  projectId: string;
  projectName: string;
  projectFolder: string;
  siblingCount: number;
  onClose: () => void;
}) {
  const deleteProject = useSolution((s) => s.deleteProject);
  const removeProject = useSolution((s) => s.removeProject);
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folderPath =
    projectFolder === "." || projectFolder === "" ? "(solution root)" : projectFolder;

  const folderDeleteReady = !deleteFolder || confirmText === projectName;

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await deleteProject(projectId, deleteFolder);
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  const doRemove = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await removeProject(projectId);
      onClose();
    } catch (err) {
      setError(String(err));
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
        className="w-[520px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-red-300 font-medium">
          Delete project — {projectName}
        </div>

        <div className="px-4 py-4 space-y-3 text-xs leading-5">
          <div className="text-zinc-400">
            This will delete{" "}
            <span className="font-mono text-zinc-200">{projectName}.craidd</span>{" "}
            and remove the project from the solution.
          </div>

          {!deleteFolder ? (
            <div className="text-zinc-500">
              The folder{" "}
              <span className="font-mono text-zinc-400">{folderPath}</span>{" "}
              will remain on disk.
            </div>
          ) : (
            <div className="text-red-400 font-medium">
              The folder{" "}
              <span className="font-mono text-red-300">{folderPath}</span>{" "}
              and everything inside will be permanently deleted.
            </div>
          )}

          <label
            className={
              "flex items-center gap-2 select-none pt-1 " +
              (siblingCount > 1 ? "cursor-default opacity-60" : "cursor-pointer")
            }
            title={siblingCount > 1 ? "This folder holds other projects. Delete its folders from File Discovery." : ""}
          >
            <input
              type="checkbox"
              checked={deleteFolder}
              onChange={(e) => {
                if (siblingCount > 1) return;
                setDeleteFolder(e.target.checked);
                setConfirmText("");
              }}
              disabled={submitting || siblingCount > 1}
              className="accent-red-600"
            />
            <span className="text-zinc-300">Also delete the project folder</span>
          </label>

          {siblingCount > 1 && (
            <div className="text-[11px] text-zinc-500 leading-4 -mt-2">
              This folder holds {siblingCount} projects. Delete its folders from File Discovery.
            </div>
          )}

          {deleteFolder && (
            <div className="pt-1">
              <div className="text-zinc-400 mb-1">
                Type <span className="font-mono text-zinc-200">{projectName}</span> exactly to confirm:
              </div>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoFocus
                disabled={submitting}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-red-500 font-mono disabled:opacity-50"
              />
            </div>
          )}

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
            onClick={doRemove}
            disabled={submitting}
            className="px-3 py-1 rounded text-xs text-yellow-300 hover:bg-yellow-950/40 disabled:opacity-50"
          >
            Remove from Project Instead
          </button>
          <button
            onClick={submit}
            disabled={submitting || !folderDeleteReady}
            className="px-3 py-1 rounded text-xs bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
          >
            {submitting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
