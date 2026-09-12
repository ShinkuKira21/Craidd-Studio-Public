import { useActiveTab } from "../../store/workspaceStore";
import { usePreferences } from "../../store/preferencesStore";

export default function StatusBar() {
  const active = useActiveTab();
  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);

  return (
    <div className="h-6 bg-zinc-900 border-t border-zinc-800 flex items-center px-3 gap-3 text-[11px] text-zinc-500 shrink-0">
      <span className="text-blue-400 flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
        </svg>
        main
      </span>
      <span className="text-zinc-600">|</span>
      <span>{active?.language ?? "—"}</span>
      <span className="text-zinc-600">|</span>
      <span>Ln 7, Col 12</span>
      <span className="text-zinc-600">|</span>
      <span>UTF-8</span>
      <span className="text-zinc-600">|</span>
      <span>LF</span>
      {wordWrap && (
        <>
          <span className="text-zinc-600">|</span>
          <span className="text-blue-400">Wrap</span>
        </>
      )}
      <span className="text-zinc-600">|</span>
      <span>{Math.round(fontSize)}px</span>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-green-400">✓ 0</span>
        <span className="text-yellow-400">⚠ 0</span>
        <span className="text-red-400">✕ 0</span>
      </div>
    </div>
  );
}
