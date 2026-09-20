import Editor from "@monaco-editor/react";
import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import type { LinkedMember } from "../../store/linkedWindowsStore";
import { usePreferences } from "../../store/preferencesStore";
import { useLinkedWindows, dispatchLinkedWindowCommand } from "../../store/linkedWindowsStore";
import { useBreakpoints } from "../../store/breakpointStore";

export function RemoteEditorPane({ context }: { context: LinkedMember }) {
  const theme = usePreferences((state) => state.theme);
  const file = context.activeFile;
  const points = useBreakpoints((state) => state.points);
  const toggleBreakpoint = useBreakpoints((state) => state.toggle);
  const setBreakpointScope = useBreakpoints((state) => state.setScope);
  const [breakpointMenu, setBreakpointMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    const collection = decorationsRef.current;
    const monaco = monacoRef.current;
    if (!collection || !monaco) return;
    collection.set([
      ...points.filter((point) => point.file === file?.path).map((point) => ({
        range: new monaco.Range(point.line, 1, point.line, 1),
        options: { glyphMarginClassName: point.scope === "all" || point.scope === context.instanceId ? "craidd-breakpoint" : "craidd-breakpoint-inactive" },
      })),
      ...(context.pausedLine ? [{ range: new monaco.Range(context.pausedLine, 1, context.pausedLine, 1), options: { isWholeLine: true, className: "craidd-paused-line" } }] : []),
    ]);
    if (context.pausedLine) editorRef.current?.revealLineInCenter(context.pausedLine);
  }, [points, file?.path, context.pausedLine, context.instanceId]);
  return <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
    <div className="h-7 shrink-0 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 text-[11px]">
      <span className="text-blue-300">Viewing {context.projectName}</span>
      <span className="ml-auto shrink-0 text-amber-400">Read-only context preview</span>
    </div>
    <div className="h-9 shrink-0 flex items-stretch overflow-x-auto border-b border-zinc-800 bg-zinc-900/70 text-xs">
      {context.tabs.map((tab) => <button key={tab.path} type="button"
        onClick={() => void dispatchLinkedWindowCommand(context.windowLabel, "select_tab", tab.path)}
        title={tab.path}
        className={"px-3 shrink-0 border-r border-zinc-800 hover:bg-zinc-800 " +
          (tab.path === file?.path ? "bg-zinc-950 text-zinc-100 border-t-2 border-t-blue-500" : "text-zinc-400")}
      >{tab.name}{tab.dirty && <span className="text-amber-400 ml-2">●</span>}</button>)}
      {context.tabs.length === 0 && <span className="self-center px-3 text-zinc-500">No tabs open</span>}
    </div>
    {file ? <Editor key={`${context.windowLabel}:${file.path}`} height="100%"
      path={`craidd-remote-${context.windowLabel}:${file.path}`}
      language={file.language} value={file.content} theme={theme}
      onMount={(instance, monaco) => {
        editorRef.current = instance; monacoRef.current = monaco;
        decorationsRef.current = instance.createDecorationsCollection();
        decorationsRef.current.set([
          ...points.filter((point) => point.file === file.path).map((point) => ({
            range: new monaco.Range(point.line, 1, point.line, 1),
            options: { glyphMarginClassName: point.scope === "all" || point.scope === context.instanceId ? "craidd-breakpoint" : "craidd-breakpoint-inactive" },
          })),
          ...(context.pausedLine ? [{ range: new monaco.Range(context.pausedLine, 1, context.pausedLine, 1), options: { isWholeLine: true, className: "craidd-paused-line" } }] : []),
        ]);
        if (context.pausedLine) instance.revealLineInCenter(context.pausedLine);
        instance.onMouseDown((event) => {
          if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !event.event.leftButton) return;
          const line = event.target.position?.lineNumber;
          if (line) void useBreakpoints.getState().toggle(file.path, line);
        });
        instance.onContextMenu((event) => {
          if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
          const line = event.target.position?.lineNumber;
          if (!line) return;
          event.event.preventDefault();
          setBreakpointMenu({ x: event.event.posx, y: event.event.posy, line });
        });
      }}
      options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, automaticLayout: true,
        scrollBeyondLastLine: false, glyphMargin: true, fontSize: 13, padding: { top: 8, bottom: 8 } }} />
      : <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">No editor tab is open in this IDE window.</div>}
    {breakpointMenu && file && <>
      <button className="fixed inset-0 z-40 cursor-default" aria-label="Close breakpoint menu" onClick={() => setBreakpointMenu(null)} />
      <div className="fixed z-50 min-w-44 bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs"
        style={{ left: breakpointMenu.x, top: breakpointMenu.y }}>
        {points.some((point) => point.file === file.path && point.line === breakpointMenu.line) ? <>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void setBreakpointScope(file.path, breakpointMenu.line, "all"); setBreakpointMenu(null); }}>All instances</button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void setBreakpointScope(file.path, breakpointMenu.line, context.instanceId); setBreakpointMenu(null); }}>Only {context.projectName} · this instance</button>
          <button className="block w-full px-3 py-1.5 text-left text-red-300 hover:bg-zinc-800" onClick={() => { void useBreakpoints.getState().remove(file.path, breakpointMenu.line); setBreakpointMenu(null); }}>Remove breakpoint</button>
        </> : <>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void toggleBreakpoint(file.path, breakpointMenu.line); setBreakpointMenu(null); }}>Add for all instances</button>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-blue-700" onClick={() => { void toggleBreakpoint(file.path, breakpointMenu.line, context.instanceId); setBreakpointMenu(null); }}>Add only for this instance</button>
        </>}
      </div>
    </>}
  </div>;
}

export function RemoteOutputPanel({ context }: { context: LinkedMember }) {
  const problems = useLinkedWindows((state) => state.problems.filter((item) => item.windowLabel === context.windowLabel));
  return <div className="h-full flex flex-col bg-zinc-950 border-t border-zinc-800 text-xs">
    <div className="h-8 shrink-0 flex items-center gap-3 px-3 border-b border-zinc-800 bg-zinc-900 text-zinc-400">
      <span>Output · {context.projectName}</span><span>{context.status}</span>
      {problems.length > 0 && <span className="text-red-400">{problems.length} problems</span>}
    </div>
    <pre className="flex-1 overflow-auto p-3 whitespace-pre-wrap font-mono text-zinc-300">{context.output || "No output yet."}</pre>
  </div>;
}
