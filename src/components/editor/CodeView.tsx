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

function breakpointDecorations(monaco: Monaco, points: Breakpoint[], file: string | null, instanceId: string | null, pausedLine: number | null) {
  const lines = [...new Set(points.filter((point) => point.file === file).map((point) => point.line))];
  return [...lines.map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: points.some((point) => point.file === file && point.line === line && (point.scope === "all" || point.scope === instanceId))
        ? "craidd-breakpoint" : "craidd-breakpoint-inactive",
      glyphMarginHoverMessage: { value: points.some((point) => point.file === file && point.line === line &&
        (point.scope === "all" || point.scope === instanceId))
        ? `Breakpoint active in this session · line ${line}` : `Breakpoint in another linked session · line ${line}` },
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
  const ownLabel = useLinkedWindows((s) => s.ownInstanceId);
  const debugStatus = useDebug((s) => s.status);
  const debugFile = useDebug((s) => s.file);
  const debugLine = useDebug((s) => s.line);
  const pausedLine = debugStatus === "paused" && debugFile === activeFileId ? debugLine : null;
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

  useEffect(() => {
    const decorations = decorationsRef.current;
    if (!decorations || !monacoRef.current) return;
    trackedPointsRef.current = points.filter((point) => point.file === activeFileId)
      .filter((point, index, all) => all.findIndex((item) => item.line === point.line) === index);
    decorations.set(breakpointDecorations(monacoRef.current, points, activeFileId, ownLabel, pausedLine));
  }, [points, activeFileId, ownLabel, pausedLine]);

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
        onMount={(instance, monaco) => {
          editorRef.current = instance;
          monacoRef.current = monaco;
          decorationsRef.current = instance.createDecorationsCollection();
          trackedPointsRef.current = points.filter((point) => point.file === activeFileId)
            .filter((point, index, all) => all.findIndex((item) => item.line === point.line) === index);
          decorationsRef.current.set(breakpointDecorations(monaco, points, activeFileId, ownLabel, pausedLine));
          revealCurrentNavigation(instance);
          instance.onDidChangeModel(() => revealCurrentNavigation(instance));
          instance.onMouseDown((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.event.leftButton) return;
            const file = useSolution.getState().activeFileId;
            const line = event.target.position?.lineNumber;
            const state = useLinkedWindows.getState();
            if (file && line && state.ownInstanceId) void useBreakpoints.getState()
              .toggleForInstance(file, line, state.ownInstanceId, state.windows.map((item) => item.instanceId))
              .catch((error) => alert(`Breakpoint failed: ${String(error)}`));
          });
          instance.onContextMenu((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
            const line = event.target.position?.lineNumber;
            if (!line) return;
            event.event.preventDefault();
            setBreakpointMenu({ x: event.event.posx, y: event.event.posy, line });
          });
        }}
        options={options}
      />
      {breakpointMenu && activeFileId && ownLabel && <BreakpointMenu file={activeFileId}
        line={breakpointMenu.line} instanceId={ownLabel} x={breakpointMenu.x} y={breakpointMenu.y}
        onClose={() => setBreakpointMenu(null)} />}
    </div>
  );
}
