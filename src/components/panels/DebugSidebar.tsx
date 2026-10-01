import { useDebug } from "../../store/debugStore";
import { useBreakpoints } from "../../store/breakpointStore";
import { useSolution } from "../../store/solutionStore";
import { useLinkedWindows, dispatchLinkedWindowCommand } from "../../store/linkedWindowsStore";
import LdiSessionCard from "./LdiSessionCard";

export default function DebugSidebar() {
  const debug = useDebug();
  const points = useBreakpoints((state) => state.points);
  const windows = useLinkedWindows((state) => state.windows);
  const remote = useLinkedWindows((state) => state.windows.find((item) => item.windowLabel === state.viewedWindowLabel && item.windowLabel !== state.ownWindowLabel));
  const reveal = useSolution((state) => state.revealFile);
  const revealBreakpoint = async (file: string, line: number) => {
    if (!remote) { await reveal(file, line, 1); return; }
    await dispatchLinkedWindowCommand(remote.windowLabel, "reveal_file", JSON.stringify({ file, line }));
    await reveal(file, line, 1);
    if (useSolution.getState().tabs.some((tab) => tab.fileId === file)) {
      useLinkedWindows.getState().setRemoteEditing(true);
    }
  };
  const revealFrame = async (file: string, line: number) => {
    if (!remote) { await reveal(file, line, 1); return; }
    await dispatchLinkedWindowCommand(remote.windowLabel, "reveal_file", JSON.stringify({ file, line }));
    useLinkedWindows.getState().setRemoteEditing(false);
  };
  const pausedLine = remote ? remote.pausedLine : debug.line;
  const frames = remote?.debugFrames ?? debug.frames;
  const variables = remote?.debugVariables ?? debug.variables;
  const listedPoints = points.filter((point, index, all) =>
    all.findIndex((item) => item.file === point.file && item.line === point.line) === index);
  const removeBreakpoint = async (file: string, line: number) => {
    await useBreakpoints.getState().remove(file, line);
  };
  return <div className="h-full min-h-0 w-full bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden text-xs">
    <div className="h-9 px-3 flex items-center border-b border-zinc-800 shrink-0 font-semibold text-zinc-300 uppercase tracking-wide">Debug</div>
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-thin overscroll-contain" tabIndex={0} aria-label="Debugger details">
      <LdiSessionCard />
      <section className="p-3 border-b border-zinc-800">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Session</div>
        <div className={remote?.status === "paused" || (!remote && debug.status === "paused") ? "text-amber-300" : "text-zinc-300"}>
          {remote ? `${remote.projectName} · ${remote.debugging ? remote.status : "not debugging"}` : debug.status}
        </div>
        {pausedLine && <div className="mt-1 text-zinc-400 truncate" title={remote?.activeFile?.path ?? debug.file ?? ""}>
          {(remote?.activeFile?.name ?? debug.file?.split("/").pop()) || "Source"}:{pausedLine}
        </div>}
        {(remote?.pauseReason ?? (!remote ? debug.reason : null)) &&
          <div className="mt-1 text-zinc-500">{remote?.pauseReason ?? debug.reason}</div>}
        {remote?.failureMessage && <div role="alert" className="mt-2 text-red-300 break-words">{remote.failureMessage}</div>}
      </section>
      {windows.length > 1 && <section className="p-3 border-b border-zinc-800">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Linked debug sessions</div>
        {windows.map((item) => <div key={item.windowLabel} className="flex gap-2 py-0.5 text-zinc-400">
          <span className="min-w-0 flex-1 truncate" title={item.projectName}>{item.projectName} · CS{item.windowId}</span>
          <span className={item.debugging && item.status === "paused" ? "text-amber-300" : "text-zinc-500"}>
            {item.debugging ? item.status : "not debugging"}
          </span>
        </div>)}
      </section>}
      {frames.length > 0 && <section className="p-3 border-b border-zinc-800">
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Call stack</div>
        {frames.map((frame) => <button key={frame.id} type="button" onClick={() => frame.source?.path && void revealFrame(frame.source.path, frame.line)
          .catch((error) => alert(`Could not open frame: ${String(error)}`))}
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
        <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2">Breakpoints · {listedPoints.length}</div>
        <div className="text-zinc-500 mb-2">Shared by all debug sessions in this solution. Click a red marker to remove it, or the filename to open it.</div>
        {listedPoints.length ? listedPoints.map((point) => <div key={point.file + ":" + point.line}
          className="flex items-center gap-1 rounded hover:bg-zinc-800">
          <button type="button" onClick={() => void removeBreakpoint(point.file, point.line)
            .catch((error) => alert("Could not remove breakpoint: " + String(error)))}
            aria-label={"Remove breakpoint at " + point.file + ":" + point.line}
            title="Remove breakpoint"
            className="w-6 h-6 shrink-0 flex items-center justify-center">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-red-500" />
          </button>
          <button type="button" onClick={() => void revealBreakpoint(point.file, point.line)
            .catch((error) => alert("Could not open breakpoint: " + String(error)))}
            className="min-w-0 flex-1 text-left py-1 pr-1 truncate text-zinc-300"
            title={"Open " + point.file + ":" + point.line}>
            {point.file.split("/").pop()}:{point.line}
          </button>
        </div>) : <div className="text-zinc-600">Click the editor gutter to add one.</div>}
      </section>
    </div>
  </div>;
}
