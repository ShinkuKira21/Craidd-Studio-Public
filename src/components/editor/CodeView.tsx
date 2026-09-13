import Editor from "@monaco-editor/react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";

export default function CodeView() {
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const active = tabs.find((t) => t.fileId === activeFileId);
  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);

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
        language={active.monacoLanguage}
        value={active.content}
        theme="vs-dark"
        options={{
          readOnly: true,
          fontSize,
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
