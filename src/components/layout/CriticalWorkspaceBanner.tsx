import { useSolution } from "../../store/solutionStore";

/**
 * Shown when the workspace root folder has been deleted from outside
 * the application. The app must not silently reset — it must tell the
 * user what happened and offer a path forward.
 */
export default function CriticalWorkspaceBanner() {
  const rootMissing = useSolution((s) => s.rootMissing);
  const clearRootMissing = useSolution((s) => s.clearRootMissing);
  const openFolder = useSolution((s) => s.openFolder);

  if (!rootMissing) return null;

  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      clearRootMissing();
      await openFolder(selected);
    } catch (err) {
      console.error("[craidd] critical banner: open folder failed:", err);
    }
  };

  const handleCreateNew = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      clearRootMissing();
      await openFolder(selected);
    } catch (err) {
      console.error("[craidd] critical banner: create new failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[560px] bg-zinc-900 border border-red-900/70 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-red-900/50 bg-red-950/30">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <div className="text-sm text-red-200 font-medium">
              Critical: Workspace deleted from outside the application
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 text-xs">
          <div className="text-zinc-400 leading-5">
            The folder this workspace was rooted in no longer exists. This usually means
            the folder was moved, renamed, or deleted by another process.
          </div>
          <div className="text-zinc-500 leading-5">
            No edits have been lost — the editor was not writable in this phase.
            Open a folder to continue, or create a new solution.
          </div>

          <div className="grid gap-2 pt-1">
            <button
              onClick={handleOpenFolder}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Open Folder…</div>
              <div className="text-zinc-500 text-[11px]">Pick an existing folder on disk</div>
            </button>

            <button
              onClick={handleCreateNew}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Create New Solution…</div>
              <div className="text-zinc-500 text-[11px]">Pick a folder and declare it as a new solution</div>
            </button>

            <button
              disabled
              title="Restore from file preservation memory arrives in Phase 7"
              className="w-full text-left px-3 py-2 rounded border border-zinc-800 opacity-50 cursor-not-allowed"
            >
              <div className="text-zinc-500 font-medium">Restore Project from File Preservation Memory</div>
              <div className="text-zinc-600 text-[11px]">Phase 7</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
