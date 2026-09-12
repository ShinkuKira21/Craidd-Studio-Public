import { useSolution } from "../../store/solutionStore";

export default function Breadcrumb() {
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const active = tabs.find((t) => t.fileId === activeFileId);

  if (!active) {
    return (
      <div className="h-7 px-4 flex items-center border-b border-zinc-900 text-xs text-zinc-600">
        No file open
      </div>
    );
  }

  const parts = active.fileId.split(/[\\/]/).filter(Boolean);
  const last = parts.length > 3 ? parts.slice(-3) : parts;

  return (
    <div className="h-7 px-4 flex items-center gap-1 text-xs text-zinc-500 border-b border-zinc-900 shrink-0">
      {last.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-700">›</span>}
          <span className={i === last.length - 1 ? "text-zinc-300" : ""}>{p}</span>
        </span>
      ))}
    </div>
  );
}
