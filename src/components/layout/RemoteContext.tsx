import { useEffect, useMemo, useRef, useState } from "react";
import type { LinkedMember } from "../../store/linkedWindowsStore";
import { dispatchLinkedWindowCommand, useLinkedWindows } from "../../store/linkedWindowsStore";
import { useBreakpoints } from "../../store/breakpointStore";
import { useSolution } from "../../store/solutionStore";
import BreakpointMenu from "../editor/BreakpointMenu";

const LINE_HEIGHT = 20;
const OVERSCAN = 16;

// A remote window is a source preview. Reusing a second Monaco instance here
// made context switches recreate WebKit editor surfaces on every selection.
export function RemoteEditorPane({ context }: { context: LinkedMember }) {
  const file = context.activeFile;
  const points = useBreakpoints((state) => state.points);
  const linkedWindows = useLinkedWindows((state) => state.windows);
  const [breakpointMenu, setBreakpointMenu] = useState<{ x: number; y: number; line: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => file?.content.split("\n") ?? [], [file?.content]);
  const markerLines = useMemo(() => {
    const lines = new Map<number, boolean>();
    for (const point of points.filter((item) => item.file === file?.path)) {
      lines.set(point.line, Boolean(lines.get(point.line)) || point.scope === "all" || point.scope === context.instanceId);
    }
    return lines;
  }, [points, file?.path, context.instanceId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight));
    observer.observe(node);
    setHeight(node.clientHeight);
    return () => observer.disconnect();
  }, [file?.path]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const top = context.pausedLine ? Math.max(0, (context.pausedLine - 5) * LINE_HEIGHT) : 0;
    node.scrollTop = top;
    setScrollTop(top);
  }, [file?.path, context.pausedLine]);

  const first = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + height) / LINE_HEIGHT) + OVERSCAN);
  const visibleLines = lines.slice(first, last);
  const editHere = async () => {
    if (!file || file.dirty) return;
    const { ownWindowLabel, selectWindow } = useLinkedWindows.getState();
    if (!ownWindowLabel) return;
    await selectWindow(ownWindowLabel);
    await useSolution.getState().revealFile(file.path, context.pausedLine ?? 1, 1);
  };

  return <div className="flex-1 flex flex-col min-h-0 bg-zinc-950">
    <div className="h-7 shrink-0 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 text-[11px]">
      <span className="text-blue-300">Viewing {context.projectName}</span>
      <button type="button" onClick={() => void editHere().catch((error) => alert(`Could not open file: ${String(error)}`))}
        disabled={!file || file.dirty}
        title={file?.dirty ? "Save this file in its owning window before opening another editable copy" : "Open this file in this window's editable editor"}
        className="ml-auto shrink-0 text-blue-300 hover:text-blue-100 disabled:text-zinc-500 disabled:cursor-default">
        {file?.dirty ? "Unsaved in owning window" : "Edit file here ↗"}
      </button>
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
    {file ? <div ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="flex-1 min-h-0 overflow-auto font-mono text-[13px] leading-5" aria-label={`${file.name} source preview`}>
      <div className="relative min-w-full" style={{ height: lines.length * LINE_HEIGHT, width: "max-content" }}>
        {visibleLines.map((line, offset) => {
          const lineNumber = first + offset + 1;
          const marker = markerLines.get(lineNumber);
          const paused = context.pausedLine === lineNumber;
          return <div key={lineNumber} style={{ top: (lineNumber - 1) * LINE_HEIGHT, height: LINE_HEIGHT }}
            className={"absolute left-0 flex min-w-full whitespace-pre " + (paused ? "bg-amber-500/20" : "")}
          >
            <button type="button" title={marker === true ? `Breakpoint active in ${context.projectName} at line ${lineNumber}`
              : marker === false ? `Breakpoint in another linked session at line ${lineNumber}` : `Set breakpoint at line ${lineNumber}`}
              onClick={() => void useBreakpoints.getState().toggleForInstance(file.path, lineNumber,
                context.instanceId, linkedWindows.map((item) => item.instanceId))}
              onContextMenu={(event) => { event.preventDefault(); setBreakpointMenu({ x: event.clientX, y: event.clientY, line: lineNumber }); }}
              className="sticky left-0 z-10 w-14 shrink-0 bg-zinc-950/95 pr-2 text-right text-zinc-600 hover:text-zinc-300"
            >{marker !== undefined && <span className={"inline-block mr-2 h-2.5 w-2.5 rounded-full " +
              (marker ? "bg-red-500" : "border-2 border-red-500 opacity-60")} />}{lineNumber}</button>
            <code className="block pr-5 text-zinc-300">{line || " "}</code>
          </div>;
        })}
      </div>
    </div> : <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">No editor tab is open in this IDE window.</div>}
    {file?.truncated && <div className="px-3 py-1 text-[11px] border-t border-zinc-800 text-zinc-500">Preview is limited to the first 80 KB. Edit here to open the complete saved file.</div>}
    {breakpointMenu && file && <BreakpointMenu file={file.path} line={breakpointMenu.line}
      instanceId={context.instanceId} x={breakpointMenu.x} y={breakpointMenu.y}
      onClose={() => setBreakpointMenu(null)} />}
  </div>;
}

export function RemoteOutputPanel({ context }: { context: LinkedMember }) {
  const allProblems = useLinkedWindows((state) => state.problems);
  const problems = useMemo(() => allProblems.filter((item) => item.windowLabel === context.windowLabel),
    [allProblems, context.windowLabel]);
  return <div className="h-full flex flex-col bg-zinc-950 border-t border-zinc-800 text-xs">
    <div className="h-8 shrink-0 flex items-center gap-3 px-3 border-b border-zinc-800 bg-zinc-900 text-zinc-400">
      <span>Output · {context.projectName}</span><span>{context.status}</span>
      {problems.length > 0 && <span className="text-red-400">{problems.length} problems</span>}
    </div>
    <pre className="flex-1 overflow-auto p-3 whitespace-pre-wrap font-mono text-zinc-300">{context.output || "No output yet."}</pre>
  </div>;
}
