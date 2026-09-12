import { useWorkspace } from "../../store/workspaceStore";

export default function Breadcrumb({ fileId }: { fileId: string | null }) {
  const tabs = useWorkspace((s) => s.tabs);
  const active = tabs.find((t) => t.fileId === fileId);

  if (!active) {
    return (
      <div className="h-7 px-4 flex items-center border-b border-zinc-900 text-xs text-zinc-600">
        No file open
      </div>
    );
  }

  const parts = active.fileId.split("/").filter(Boolean);
  const treeLabel = parts[0] === "rust-core" ? "Rust (Core)"
                  : parts[0] === "ts-frontend" ? "TypeScript (Frontend)"
                  : parts[0] === "config" ? "Config" : parts[0];
  const rest = parts.slice(1);

  const treeColor = parts[0] === "rust-core" ? "text-orange-400"
                  : parts[0] === "ts-frontend" ? "text-blue-400"
                  : "text-zinc-400";

  return (
    <div className="h-7 px-4 flex items-center gap-1 text-xs text-zinc-500 border-b border-zinc-900 shrink-0">
      <span className={treeColor}>{treeLabel}</span>
      {rest.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="text-zinc-700">›</span>
          <span className={i === rest.length - 1 ? "text-zinc-300" : ""}>{p}</span>
        </span>
      ))}
    </div>
  );
}
