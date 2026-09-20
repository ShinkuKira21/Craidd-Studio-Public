import { useDebug } from "../../store/debugStore";
import { useBreakpoints } from "../../store/breakpointStore";
import { useSolution } from "../../store/solutionStore";
import { useLinkedWindows, dispatchLinkedWindowCommand } from "../../store/linkedWindowsStore";

export default function DebugSidebar() {
  const debug = useDebug();
  const points = useBreakpoints((state) => state.points);
  const own = useLinkedWindows((state) => state.ownInstanceId);
  const remote = useLinkedWindows((state) => state.windows.find((item) => item.windowLabel === state.viewedWindowLabel && item.windowLabel !== state.ownWindowLabel));
  const reveal = useSolution((state) => state.revealFile);
  const revealBreakpoint = (file: string, line: number) => remote
    ? dispatchLinkedWindowCommand(remote.windowLabel, "reveal_file", JSON.stringify({ file, line }))
    : reveal(file, line, 1);
  const frames = remote?.debugFrames ?? debug.frames;
  const variables = remote?.debugVariables ?? debug.variables;
  const activePoints = points.filter((point) => point.scope === "all" || point.scope === (remote?.instanceId ?? own));
  return <div className="w-72 bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden shrink-0 text-xs">
    <div className="h-9 px-3 flex items-center border-b border-zinc-800 shrink-0 font-semibold text-zinc-300 uppercase tracking-wide">Debug</div>
    <div className="overflow-auto scroll-thin flex-1">
      <section className="p-3 border-b border-zinc-800">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Session</div>
        <div className={remote?.status === "paused" || (!remote && debug.status === "paused") ? "text-amber-300" : "text-zinc-300"}>
          {remote ? `${remote.projectName} · ${remote.status}` : debug.status}
        </div>
        {(remote?.pausedLine || debug.line) && <div className="mt-1 text-zinc-400 truncate" title={remote?.activeFile?.path ?? debug.file ?? ""}>
          {(remote?.activeFile?.name ?? debug.file?.split("/").pop()) || "Source"}:{remote?.pausedLine ?? debug.line}
        </div>}
        {!remote && debug.reason && <div className="mt-1 text-zinc-500">{debug.reason}</div>}
      </section>
      {frames.length > 0 && <section className="p-3 border-b border-zinc-800">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Call stack</div>
        {frames.map((frame) => <button key={frame.id} type="button" onClick={() => frame.source?.path && void revealBreakpoint(frame.source.path, frame.line)}
          className="block w-full text-left px-1 py-1 rounded hover:bg-zinc-800 truncate" title={frame.source?.path}>
          <span className="text-zinc-200">{frame.name}</span><span className="ml-1 text-zinc-500">{frame.source?.name}:{frame.line}</span>
        </button>)}
      </section>}
      {variables.length > 0 && <section className="p-3 border-b border-zinc-800">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Variables</div>
        {variables.map((variable, index) => <div key={`${variable.name}-${index}`} className="py-0.5 flex gap-2">
          <span className="text-blue-300 truncate">{variable.name}</span><span className="text-zinc-300 truncate" title={variable.value}>{variable.value}</span>
        </div>)}
      </section>}
      <section className="p-3">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Breakpoints · {activePoints.length}</div>
        {activePoints.length ? activePoints.map((point) => <button key={`${point.file}:${point.line}`} type="button"
          onClick={() => void revealBreakpoint(point.file, point.line)} className="block w-full text-left px-1 py-1 rounded hover:bg-zinc-800 truncate"
          title={point.file}><span className="text-red-400 mr-1">●</span>{point.file.split("/").pop()}:{point.line}</button>)
          : <div className="text-zinc-600">Click the editor gutter to add one.</div>}
      </section>
    </div>
  </div>;
}
