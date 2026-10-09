import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";
import { useSplit } from "../../store/splitStore";
import { setActiveEditor, getActiveEditor } from "../../lib/activeEditor";
import { CRAIDD_DARK_THEME, defineCraiddDarkTheme } from "../../lib/editorThemes";

/**
 * The side editor group. It edits the same Monaco model as the main editor,
 * so both views of one file stay identical, and writes changes to the same
 * tab for dirty tracking and Save. It has no breakpoint gutter or paused-line
 * marker; those stay in the main editor.
 */
export default function SideEditor() {
  const fileId = useSplit((s) => s.sideFileId);
  const tab = useSolution((s) => s.tabs.find((item) => item.fileId === fileId));
  const activeFileId = useSolution((s) => s.activeFileId);
  const updateTabContent = useSolution((s) => s.updateTabContent);
  const fontSize = usePreferences((s) => s.fontSize);
  const tabSize = usePreferences((s) => s.tabSize);
  const wordWrap = usePreferences((s) => s.wordWrap);
  const theme = usePreferences((s) => s.theme);
  const monacoRef = useRef<Monaco | null>(null);
  const instanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // The tab was closed: close the group.
  useEffect(() => { if (fileId && !tab) useSplit.getState().closeSide(); }, [fileId, tab]);

  // The side editor keeps its model on unmount (the main editor may share it).
  // Dispose it once no editor shows the file, so a later reopen reads the tab content.
  useEffect(() => () => {
    if (!fileId || useSolution.getState().activeFileId === fileId) return;
    const monaco = monacoRef.current;
    monaco?.editor.getModel(monaco.Uri.parse(fileId))?.dispose();
  }, [fileId]);

  if (!fileId || !tab) return null;
  const name = fileId.split("/").pop() ?? fileId;
  return <div className="flex-1 min-w-0 min-h-0 flex flex-col border-l border-zinc-800">
    <div className="h-9 shrink-0 flex items-center gap-2 px-3 bg-zinc-900 border-b border-zinc-800 text-xs">
      <span className="truncate text-zinc-200" title={fileId}>{name}</span>
      {tab.dirty && <span className="text-zinc-400" title="Unsaved changes">●</span>}
      {fileId === activeFileId && <span className="text-zinc-600">also in main</span>}
      <button type="button" title="Close side group" onClick={() => useSplit.getState().closeSide()}
        className="ml-auto text-zinc-500 hover:text-zinc-200">×</button>
    </div>
    <div className="flex-1 min-h-0">
      <Editor
        height="100%"
        path={fileId}
        language={tab.monacoLanguage}
        defaultValue={tab.content}
        keepCurrentModel
        theme={theme === "craidd-dark" ? CRAIDD_DARK_THEME : theme}
        beforeMount={defineCraiddDarkTheme}
        onChange={(value) => { if (typeof value === "string") updateTabContent(fileId, value); }}
        onMount={(instance, monaco) => {
          instanceRef.current = instance;
          monacoRef.current = monaco;
          instance.onDidFocusEditorText(() => { useSplit.getState().setSideFocused(true); setActiveEditor(instance, () => fileId); });
          instance.onDidDispose(() => { if (getActiveEditor() === instance) setActiveEditor(null); });
        }}
        options={{
          fontSize, tabSize, fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true,
          glyphMargin: false, wordWrap: wordWrap ? "on" : "off", padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  </div>;
}
