import { useSolution } from "../../store/solutionStore";

export default function AncestorSolutionDialog() {
  const ancestor = useSolution((s) => s.pendingAncestor);
  const path = useSolution((s) => s.pendingPath);
  const resolve = useSolution((s) => s.resolveOpenDecision);

  if (!ancestor) return null;

  const folderName = path?.split("/").filter(Boolean).pop() ?? "this folder";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50">
      <div className="w-[520px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="text-sm text-zinc-100 font-medium">New Solution Detected</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            You've opened <span className="font-mono text-zinc-400">{folderName}</span>, which is inside an existing solution.
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 text-xs">
          <div className="text-zinc-500">
            <div>
              Parent solution: <span className="text-zinc-300 font-mono">{ancestor.clnName || "(unknown)"}</span>
            </div>
            <div className="text-zinc-600 mt-0.5">
              Name: <span className="text-zinc-400">{ancestor.solutionName || "(unknown)"}</span>
            </div>
          </div>

          <div className="text-zinc-400 leading-5 bg-zinc-950/50 border border-zinc-800 rounded px-3 py-2">
            Solutions are not projects. They cannot be linked. If you meant to work in the parent
            solution, choose that option. Otherwise, this folder can be its own solution.
          </div>

          <div className="grid gap-2">
            <button
              onClick={() => resolve("parent", ancestor.clnPath)}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Open Parent Solution</div>
              <div className="text-zinc-500 text-[11px]">Load {ancestor.solutionName || "the parent solution"} instead</div>
            </button>

            <button
              onClick={() => resolve("browse")}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Browse This Folder <span className="text-[10px] text-zinc-500">(default)</span></div>
              <div className="text-zinc-500 text-[11px]">Just show files. No solution here.</div>
            </button>

            <button
              onClick={() => resolve("create")}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Create Solution Here</div>
              <div className="text-zinc-500 text-[11px]">Write a new .cln in this folder</div>
            </button>

            <button
              onClick={() => resolve("add-existing")}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Add Existing Project…</div>
              <div className="text-zinc-500 text-[11px]">Start a solution here and pick a .craidd from anywhere</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
