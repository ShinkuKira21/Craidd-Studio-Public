import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";
import { CRAIDD_DARK_THEME, defineCraiddDarkTheme } from "../../lib/editorThemes";

export default function DiffDialog({
  fileId,
  onClose,
}: {
  fileId: string;
  onClose: () => void;
}) {
  const tabs = useSolution((s) => s.tabs);
  const theme = usePreferences((s) => s.theme);
  const tab = tabs.find((t) => t.fileId === fileId);
  const [diskContent, setDiskContent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const c = await invoke<string>("read_file", { path: fileId });
        if (!cancelled) setDiskContent(c);
      } catch (err) {
        console.error("[craidd] DiffDialog read failed:", err);
        if (!cancelled) setDiskContent("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  if (!tab) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60">
      <div className="w-[85vw] h-[80vh] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="text-xs text-zinc-300">
            <span className="text-zinc-100 font-medium font-mono">{tab.name}</span>
            <span className="text-zinc-600 ml-3">
              left: disk   ·   right: your unsaved changes
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2"
          >
            ×
          </button>
        </div>
        <div className="flex-1 min-h-0 editor-surface bg-editor-bg">
          {diskContent === null ? (
            <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
              Loading disk version…
            </div>
          ) : (
            <DiffEditor
              height="100%"
              original={diskContent}
              modified={tab.content}
              language={tab.language === "plaintext" ? "plaintext" : tab.language}
              theme={theme === "craidd-dark" ? CRAIDD_DARK_THEME : theme}
              beforeMount={defineCraiddDarkTheme}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                automaticLayout: true,
              }}
            />
          )}
        </div>
        <div className="px-4 py-2.5 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
