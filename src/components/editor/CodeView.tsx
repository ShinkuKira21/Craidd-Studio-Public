import Editor from "@monaco-editor/react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";

export default function CodeView() {
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const updateTabContent = useSolution((s) => s.updateTabContent);
  const active = tabs.find((t) => t.fileId === activeFileId);

  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);
  const tabSize = usePreferences((s) => s.tabSize);
  const theme = usePreferences((s) => s.theme);

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm bg-zinc-950">
        Open a file from File Discovery to view it.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 bg-zinc-950">
      <Editor
        height="100%"
        path={active.fileId}
        language={active.language === "plaintext" ? "plaintext" : active.language}
        value={active.content}
        theme={theme}
        onChange={(value) => {
          if (typeof value === "string") updateTabContent(active.fileId, value);
        }}
        options={{
          readOnly: false,
          fontSize,
          tabSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: "line",
          lineNumbers: "on",
          glyphMargin: true,
          folding: true,
          automaticLayout: true,
          wordWrap: wordWrap ? "on" : "off",
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
