import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import NewProjectDialog from "../../dialogs/NewProjectDialog";

export default function SolutionBanner() {
  const bannerState = useSolution((s) => s.bannerState);
  const bannerMessage = useSolution((s) => s.bannerMessage);
  const bannerAncestor = useSolution((s) => s.bannerAncestor);
  const solution = useSolution((s) => s.solution);
  const rootPath = useSolution((s) => s.rootPath);
  const addExistingProject = useSolution((s) => s.addExistingProject);
  const openSolution = useSolution((s) => s.openSolution);
  const dismissError = useSolution((s) => s.dismissError);
  const [newOpen, setNewOpen] = useState(false);

  const handleAddExisting = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Craidd Project", extensions: ["craidd"] }],
      });
      if (typeof selected === "string") await addExistingProject(selected);
    } catch (err) {
      console.error("[craidd] add existing from banner failed:", err);
    }
  };

  if (!rootPath) return null;
  if (bannerState === "none" && !solution) return null;

  // Error state takes priority
  if (bannerState === "error") {
    return (
      <div className="px-3 py-2 border-b border-red-900/60 bg-red-950/30 text-[11px] text-red-300 leading-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium text-red-200">Error</div>
            <div className="text-red-400 break-words">{bannerMessage ?? "Unknown error"}</div>
          </div>
          <button
            onClick={dismissError}
            className="text-red-400 hover:text-red-200 shrink-0"
            title="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  // Inside-parent (browsing a folder under another solution)
  if (bannerState === "inside-parent" && bannerAncestor) {
    return (
      <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/60 text-[11px] text-zinc-500 leading-5">
        <div className="text-zinc-400">
          Browsing folder inside a solution
          {bannerMessage ? ` — ${bannerMessage}` : ""}.
        </div>
        <button
          onClick={() => openSolution(bannerAncestor.clnPath)}
          className="text-blue-400 hover:text-blue-300 mt-0.5"
        >
          Open parent solution
        </button>
      </div>
    );
  }

  // Solution exists but has no projects → show "new project / add existing"
  if (solution && solution.projects.length === 0) {
    return (
      <>
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/60 text-[11px] text-zinc-500 leading-5">
          <div className="text-zinc-400 mb-1">No projects yet.</div>
          <div className="flex gap-3">
            <button onClick={() => setNewOpen(true)} className="text-blue-400 hover:text-blue-300">
              New project
            </button>
            <button onClick={handleAddExisting} className="text-blue-400 hover:text-blue-300">
              Add existing project…
            </button>
          </div>
        </div>
        {newOpen && <NewProjectDialog onClose={() => setNewOpen(false)} />}
      </>
    );
  }

  // No solution at all in this folder → offer to create one
  if (bannerState === "no-solution" && !solution) {
    return (
      <>
        <div className="px-3 py-2 border-b border-zinc-800 bg-zinc-900/60 text-[11px] text-zinc-500 leading-5">
          <div className="text-zinc-400 mb-1">No solution in this folder.</div>
          <div className="flex gap-3">
            <button onClick={() => setNewOpen(true)} className="text-blue-400 hover:text-blue-300">
              New project
            </button>
            <button onClick={handleAddExisting} className="text-blue-400 hover:text-blue-300">
              Add existing project…
            </button>
          </div>
        </div>
        {newOpen && <NewProjectDialog onClose={() => setNewOpen(false)} />}
      </>
    );
  }

  return null;
}
