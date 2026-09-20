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

function breakpointDecorations(monaco: Monaco, points: Breakpoint[], file: string | null, ownLabel: string | null, pausedLine: number | null) {
  return [...points.filter((point) => point.file === file).map((point) => ({
    range: new monaco.Range(point.line, 1, point.line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: point.scope === "all" || point.scope === ownLabel ? "craidd-breakpoint" : "craidd-breakpoint-inactive",
      glyphMarginHoverMessage: { value: point.scope === "all" ? "Breakpoint · All instances" : `Breakpoint · ${point.scope}` },
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
  const toggleBreakpoint = useBreakpoints((s) => s.toggle);
  const setBreakpointScope = useBreakpoints((s) => s.setScope);
  const ownLabel = useLinkedWindows((s) => s.ownInstanceId);
  const linkedWindows = useLinkedWindows((s) => s.windows);
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
    trackedPointsRef.current = points.filter((point) => point.file === activeFileId);
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
          trackedPointsRef.current = points.filter((point) => point.file === activeFileId);
          decorationsRef.current.set(breakpointDecorations(monaco, points, activeFileId, ownLabel, pausedLine));
          revealCurrentNavigation(instance);
          instance.onDidChangeModel(() => revealCurrentNavigation(instance));
          instance.onMouseDown((event) => {
            if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.event.leftButton) return;
            const file = useSolution.getState().activeFileId;
            const line = event.target.position?.lineNumber;
            if (file && line) void useBreakpoints.getState().toggle(file, line).catch((error) => alert(`Breakpoint failed: ${String(error)}`));
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
      {breakpointMenu && activeFileId && <>
        <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={() => setBreakpointMenu(null)} />
        <div className="fixed z-50 min-w-44 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
          style={{ left: breakpointMenu.x, top: breakpointMenu.y }}>
          {points.some((point) => point.file === activeFileId && point.line === breakpointMenu.line) ? <>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void setBreakpointScope(activeFileId, breakpointMenu.line, "all"); setBreakpointMenu(null); }}>All instances</button>
            {ownLabel && <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void setBreakpointScope(activeFileId, breakpointMenu.line, ownLabel); setBreakpointMenu(null); }}>Only this IDE window</button>}
            {linkedWindows.filter((item) => item.instanceId !== ownLabel).map((item) =>
              <button key={item.instanceId} className="block w-full px-3 py-1.5 text-left hover:bg-blue-700"
                onClick={() => { void setBreakpointScope(activeFileId, breakpointMenu.line, item.instanceId); setBreakpointMenu(null); }}>
                Only {item.projectName} · {item.windowLabel}
              </button>)}
            <button className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-zinc-800" onClick={() => { void useBreakpoints.getState().remove(activeFileId, breakpointMenu.line); setBreakpointMenu(null); }}>Remove breakpoint</button>
          </> : <>
            <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void toggleBreakpoint(activeFileId, breakpointMenu.line); setBreakpointMenu(null); }}>Add for all instances</button>
            {ownLabel && <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void toggleBreakpoint(activeFileId, breakpointMenu.line, ownLabel); setBreakpointMenu(null); }}>Add only for this IDE window</button>}
          </>}
        </div>
      </>}
    </div>
  );
}
