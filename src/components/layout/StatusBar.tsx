import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";

export default function StatusBar() {
  const solution = useSolution((s) => s.solution);
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const active = tabs.find((t) => t.fileId === activeFileId);
  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);

  return (
    <div className="h-6 bg-zinc-900 border-t border-zinc-800 flex items-center px-3 gap-3 text-[11px] text-zinc-500 shrink-0">
      <span className="text-zinc-400 truncate max-w-[240px]">
        {solution ? solution.name : "No solution"}
      </span>
      <span className="text-zinc-700">|</span>
      <span>{active?.language ?? "—"}</span>
      <span className="text-zinc-700">|</span>
      <span>{active ? active.name : "—"}</span>
      {wordWrap && (
        <>
          <span className="text-zinc-700">|</span>
          <span className="text-blue-400">Wrap</span>
        </>
      )}
      <span className="text-zinc-700">|</span>
      <span>{Math.round(fontSize)}px</span>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-green-400">✓ 0</span>
        <span className="text-yellow-400">⚠ 0</span>
        <span className="text-red-400">✕ 0</span>
      </div>
    </div>
  );
}
