import { useEffect, useRef, useState } from "react";
import { useDebug } from "../../store/debugStore";
import type { DebugThread } from "../../store/debugStore";

function elapsed(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function lacksDescriptiveName(thread: DebugThread): boolean {
  const name = thread.name.trim().replace(/^<(.+)>$/, "$1").trim().toLowerCase();
  return /^(?:no name(?:d)?(?: thread)?|unnamed(?: thread)?)$/.test(name)
    || name === `thread ${thread.id}`;
}

/** The thread choice belongs to the execution controls; stacks and locals
 * remain in the Debug panel after a thread is selected. */
export default function ThreadDropdown() {
  const threads = useDebug((state) => state.threads);
  const completed = useDebug((state) => state.completedThreads);
  const sessionKey = useDebug((state) => state.threadSessionKey);
  const selectedId = useDebug((state) => state.selectedThreadId);
  const frames = useDebug((state) => state.frames);
  const stale = useDebug((state) => state.threadsStale);
  const inspectionError = useDebug((state) => state.inspectionError);
  const selectThread = useDebug((state) => state.selectThread);
  const refreshThreads = useDebug((state) => state.refreshThreads);
  const priorSession = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showUnnamed, setShowUnnamed] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (priorSession.current !== sessionKey) {
      priorSession.current = sessionKey;
      setOpen(false);
      setShowUnnamed(false);
      setShowCompleted(false);
    }
    if (!sessionKey) return;
    setNow(performance.now());
  }, [threads, sessionKey]);

  useEffect(() => {
    if (!open || !sessionKey) return;
    void refreshThreads().catch((error) => console.error("Could not refresh debugger threads:", error));
    const refresh = window.setInterval(() => {
      void refreshThreads().catch((error) => console.error("Could not refresh debugger threads:", error));
    }, 2000);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        setNow(performance.now());
      }
    }, 200);
    return () => { window.clearInterval(timer); window.clearInterval(refresh); };
  }, [open, refreshThreads, sessionKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!sessionKey) return null;
  const hasException = threads.some((thread) => thread.state === "paused" && thread.reason === "exception");
  const hasPause = threads.some((thread) => thread.state === "paused");
  const triggerColor = hasException ? "text-red-300" : hasPause ? "text-amber-300" : "text-zinc-300";
  const focused = threads.find((thread) => thread.id === selectedId);
  const focusLabel = focused && (lacksDescriptiveName(focused) ? `Thread #${focused.id}` : focused.name);
  const others = threads.filter((thread) => thread.id !== selectedId);
  const otherStops = others.filter((thread) => thread.state === "paused" && thread.reason);
  const remaining = others.filter((thread) => !otherStops.includes(thread));
  const named = remaining.filter((thread) => !lacksDescriptiveName(thread));
  const unnamed = remaining.filter(lacksDescriptiveName);
  const renderThread = (thread: DebugThread) => {
    const paused = thread.state === "paused";
    const exception = paused && thread.reason === "exception";
    const color = exception ? "text-red-300" : paused ? "text-amber-300" : "text-zinc-500";
    const sinceSnapshot = Math.max(0, now - (thread.receivedAt ?? now));
    const observedFor = elapsed(thread.observedMs + sinceSnapshot);
    const ranFor = elapsed(thread.ranMs + (thread.state === "running" ? sinceSnapshot : 0));
    const duration = thread.runObserved ? `ran for ${ranFor}`
      : paused ? "running time unavailable" : `observed for ${observedFor}`;
    return <button key={thread.id} type="button" disabled={!paused}
      onClick={() => void selectThread(thread.id).catch((error) => alert(`Could not inspect thread: ${String(error)}`))}
      className={`block w-full text-left rounded px-1.5 py-1 ${paused ? "hover:bg-zinc-800" : "cursor-default opacity-75"} ${selectedId === thread.id ? "bg-zinc-800" : ""}`}
      aria-label={`${thread.name}, ID ${thread.id}, ${exception ? "exception, paused" : thread.state} ${duration}${paused ? ", inspect" : ", pause to inspect"}`}>
      <span className="block truncate text-zinc-200">{thread.name} <span className="text-zinc-500">#{thread.id}</span></span>
      <span className={color}>{exception ? "● exception · paused" : paused ? "● paused" : thread.state}</span>
      <span className="ml-2 text-zinc-500" title={thread.runObserved
        ? `Cumulative debugger-observed running time, excluding pauses; not CPU time. Total observed for ${observedFor}.`
        : `The debugger has not established a running interval for this thread. Total observed for ${observedFor}.`}>· {duration}</span>
    </button>;
  };

  return <div className="relative shrink-0">
    <button type="button" aria-label={focusLabel ? `Inspection focus ${focusLabel}, ${threads.length} threads` : `Threads, ${threads.length} reported`}
      title={focusLabel ? `${focused?.name} #${focused?.id} · ${threads.length} threads` : `${threads.length} reported threads`}
      aria-expanded={open}
      aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}
      className={`h-7 rounded px-2 flex items-center gap-1.5 hover:bg-zinc-800 ${triggerColor}`}>
      {focusLabel ? <>
        <span className="max-w-[130px] truncate">{focusLabel}</span>
        <span className="whitespace-nowrap text-zinc-400">· {threads.length} threads</span>
      </> : <span>Threads ({threads.length})</span>}
      <span aria-hidden="true" className="text-zinc-500">▾</span>
    </button>
    {open && <>
      <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      <div role="dialog" aria-label="Threads in this debugger session"
        className="absolute top-full left-0 mt-1 w-[320px] max-h-[min(60vh,440px)] overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-2xl z-50 p-2 text-xs">
        <div className="px-1 pb-2 text-zinc-500">Select a paused thread to inspect it. Step targets that thread when its current instruction has a source line. This debugger can resume all threads, so another worker may hit a breakpoint first.</div>
        {stale && <div role="status" className="px-1 pb-2 text-amber-300">Thread list may be stale; waiting for the debugger.</div>}
        {focused && frames.length > 0 && (!frames[0].source?.path || !frames[0].line) &&
          <div role="status" className="px-1 pb-2 text-amber-300">This thread is paused in code without a source line. You can inspect its stack or Continue, but Step is unavailable here.</div>}
        <div className="space-y-1">
          {focused && <div>
            <div className="px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Inspection focus</div>
            {renderThread(focused)}
          </div>}
          {otherStops.map(renderThread)}
          {named.map(renderThread)}
          {unnamed.length > 0 && <div>
            <button type="button" aria-expanded={showUnnamed} onClick={() => setShowUnnamed((value) => !value)}
              className="w-full rounded px-1.5 py-1 text-left text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
              <span aria-hidden="true">{showUnnamed ? "▾" : "▸"}</span> Other threads · {unnamed.length} without descriptive names
            </button>
            {showUnnamed && <div className="pl-2 border-l border-zinc-700 ml-2 space-y-1" aria-label="Threads without descriptive names">
              {unnamed.map(renderThread)}
            </div>}
          </div>}
          {completed.length > 0 && <div>
            <button type="button" aria-expanded={showCompleted} onClick={() => setShowCompleted((value) => !value)}
              className="w-full rounded px-1.5 py-1 text-left text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
              <span aria-hidden="true">{showCompleted ? "▾" : "▸"}</span> Recently completed · {completed.length}
            </button>
            {showCompleted && <div className="pl-2 border-l border-zinc-700 ml-2 space-y-1" aria-label="Recently completed threads">
              {[...completed].reverse().map((thread) => <button key={`done-${thread.id}-${thread.incarnation}`} type="button" disabled
                title={`Total observed for ${elapsed(thread.observedMs)}. Running time excludes debugger-reported pauses and is not CPU time.`}
                className="block w-full text-left px-1.5 py-1 text-zinc-600">
                {thread.name} #{thread.id} · Completed · {thread.runObserved ? `ran for ${elapsed(thread.ranMs)}` : "running time unavailable"}
              </button>)}
            </div>}
          </div>}
          {threads.length === 0 && <div className="px-1.5 py-1 text-zinc-500">Waiting for threads from the debugger.</div>}
        </div>
        {inspectionError && <div role="alert" className="mt-2 px-1 text-red-300">{inspectionError}</div>}
      </div>
    </>}
  </div>;
}
