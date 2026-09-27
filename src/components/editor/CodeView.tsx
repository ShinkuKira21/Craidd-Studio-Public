import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";
import { useBreakpoints } from "../../store/breakpointStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import type { Breakpoint } from "../../store/breakpointStore";
import { useDebug } from "../../store/debugStore";
import BreakpointMenu from "./BreakpointMenu";
import { CRAIDD_DARK_THEME, defineCraiddDarkTheme } from "../../lib/editorThemes";

function breakpointDecorations(monaco: Monaco, points: Breakpoint[], file: string | null, pausedLine: number | null) {
  const lines = [...new Set(points.filter((point) => point.file === file).map((point) => point.line))];
  return [...lines.map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: "craidd-breakpoint",
      glyphMarginHoverMessage: { value: "Breakpoint · line " + line },
    },
  })), ...(pausedLine ? [{ range: new monaco.Range(pausedLine, 1, pausedLine, 1), options: { isWholeLine: true, className: "craidd-paused-line" } }] : [])];
}

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
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const trackedPointsRef = useRef<Breakpoint[]>([]);
  const [breakpointMenu, setBreakpointMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const activeFileId = useSolution((s) => s.activeFileId);
  const points = useBreakpoints((s) => s.points);
  const remoteEditContext = useLinkedWindows((s) => s.remoteEditing
    ? s.windows.find((item) => item.windowLabel === s.viewedWindowLabel && item.windowLabel !== s.ownWindowLabel)
    : undefined);
  const debugStatus = useDebug((s) => s.status);
  const debugFile = useDebug((s) => s.file);
  const debugLine = useDebug((s) => s.line);
  const pausedLine = remoteEditContext
    ? remoteEditContext.status === "paused" && remoteEditContext.activeFile?.path === activeFileId ? remoteEditContext.pausedLine : null
    : debugStatus === "paused" && debugFile === activeFileId ? debugLine : null;
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
    glyphMargin: true,
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

  // Monaco can mount after React has already run the effect for a newly
  // opened file. Read the latest stores at mount time, not render-time props,
  // so adopting a hidden session never paints its marker as another window.
  const refreshBreakpoints = useCallback(() => {
    const decorations = decorationsRef.current;
    const monaco = monacoRef.current;
    if (!decorations || !monaco) return;
    const file = useSolution.getState().activeFileId;
    const currentPoints = useBreakpoints.getState().points;
    const linked = useLinkedWindows.getState();
    const target = linked.remoteEditing ? linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel
      && item.windowLabel !== linked.ownWindowLabel) : null;
    const debug = useDebug.getState();
    const currentPausedLine = target
      ? target.status === "paused" && target.activeFile?.path === file ? target.pausedLine : null
      : debug.status === "paused" && debug.file === file ? debug.line : null;
    trackedPointsRef.current = currentPoints.filter((point) => point.file === file)
      .filter((point, index, all) => all.findIndex((item) => item.line === point.line) === index);
    decorations.set(breakpointDecorations(monaco, currentPoints, file, currentPausedLine));
  }, []);

  useEffect(() => { refreshBreakpoints(); }, [refreshBreakpoints, points, activeFileId, remoteEditContext?.windowLabel, pausedLine]);

  useEffect(() => {
    const onSaved = (event: Event) => {
      const file = (event as CustomEvent<string>).detail;
      if (file !== useSolution.getState().activeFileId) return;
      const decorations = decorationsRef.current;
      if (!decorations) return;
      const moves = trackedPointsRef.current.flatMap((point, index) => {
        const line = decorations.getRange(index)?.startLineNumber;
        return line && line !== point.line ? [{ from: point.line, to: line }] : [];
      });
      if (moves.length) void useBreakpoints.getState().moveLines(file, moves)
        .catch((error) => console.error("[craidd] Could not move saved breakpoints:", error));
    };
    window.addEventListener("craidd:file-saved", onSaved);
    return () => window.removeEventListener("craidd:file-saved", onSaved);
  }, []);

  if (!active) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm bg-editor-bg">
        Open a file from File Discovery to view it.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 bg-editor-bg">
      <Editor
        height="100%"
        path={active.fileId}
        language={active.monacoLanguage}
        value={active.content}
        theme={theme === "craidd-dark" ? CRAIDD_DARK_THEME : theme}
        beforeMount={defineCraiddDarkTheme}
        onChange={onChange}
        onMount={(instance, monaco) => {
          editorRef.current = instance;
          monacoRef.current = monaco;
          decorationsRef.current = instance.createDecorationsCollection();
          refreshBreakpoints();
          revealCurrentNavigation(instance);
          instance.onDidChangeModel(() => { revealCurrentNavigation(instance); refreshBreakpoints(); });
          instance.onMouseDown((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.event.leftButton) return;
            const file = useSolution.getState().activeFileId;
            const line = event.target.position?.lineNumber;
            if (file && line) void useBreakpoints.getState().toggle(file, line)
              .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
          });
          instance.onContextMenu((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
              && event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
            const line = event.target.position?.lineNumber;
            if (!line) return;
            event.event.preventDefault();
            setBreakpointMenu({ x: event.event.posx, y: event.event.posy, line });
          });
        }}
        options={options}
      />
      {breakpointMenu && activeFileId && <BreakpointMenu file={activeFileId}
        line={breakpointMenu.line} x={breakpointMenu.x} y={breakpointMenu.y}
        onClose={() => setBreakpointMenu(null)} />}
    </div>
  );
}
