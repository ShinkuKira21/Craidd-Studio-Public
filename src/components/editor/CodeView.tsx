import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";

function revealCurrentNavigation(instance: editor.IStandaloneCodeEditor) {
  const { navigation, activeFileId } = useSolution.getState();
  if (!navigation || navigation.fileId !== activeFileId || instance.getModel()?.uri.path !== activeFileId) return;
  const position = { lineNumber: navigation.line, column: navigation.column };
  instance.setPosition(position);
  instance.revealPositionInCenter(position);
  instance.focus();
}

export default function CodeView() {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const activeFileId = useSolution((s) => s.activeFileId);
  const navigation = useSolution((s) => s.navigation);
  // Monaco owns the live text while typing. The store still receives every
  // change for Save, but React only needs to rerender on a tab switch or a
  // disk reload (which changes originalContent).
  useSolution((s) => s.tabs.find((t) => t.fileId === s.activeFileId)?.originalContent);
  const updateTabContent = useSolution((s) => s.updateTabContent);
  const active = useSolution.getState().tabs.find((t) => t.fileId === activeFileId);

  const wordWrap = usePreferences((s) => s.wordWrap);
  const fontSize = usePreferences((s) => s.fontSize);
  const tabSize = usePreferences((s) => s.tabSize);
  const theme = usePreferences((s) => s.theme);
  const options = useMemo(() => ({
    readOnly: false,
    fontSize,
    tabSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: "line" as const,
    lineNumbers: "on" as const,
    glyphMargin: false,
    folding: true,
    automaticLayout: true,
    wordWrap: wordWrap ? "on" as const : "off" as const,
    padding: { top: 8, bottom: 8 },
  }), [fontSize, tabSize, wordWrap]);
  const onChange = useCallback((value: string | undefined) => {
    if (typeof value === "string" && activeFileId) updateTabContent(activeFileId, value);
  }, [activeFileId, updateTabContent]);

  useEffect(() => {
    if (!navigation || navigation.fileId !== activeFileId) return;
    const frame = requestAnimationFrame(() => {
      const instance = editorRef.current;
      if (instance) revealCurrentNavigation(instance);
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, activeFileId]);

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
        theme={theme}
        onChange={onChange}
        onMount={(instance) => {
          editorRef.current = instance;
          revealCurrentNavigation(instance);
          instance.onDidChangeModel(() => revealCurrentNavigation(instance));
        }}
        options={options}
      />
    </div>
  );
}
