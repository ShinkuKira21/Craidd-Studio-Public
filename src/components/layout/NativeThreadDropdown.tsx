import { useEffect, useState } from "react";
import { refreshNativeThreads, selectNativeThread, useNativeDebug } from "../../store/nativeDebugStore";

function elapsed(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** B inspects A's one LLDB session. Selecting here changes the shared step target. */
export default function NativeThreadDropdown() {
  const context = useNativeDebug((state) => state.context);
  const snapshot = useNativeDebug((state) => state.threads);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!context) return;
    let disposed = false;
    const refresh = () => void refreshNativeThreads().catch((failure) => {
      if (!disposed) setError(String(failure));
    });
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [context?.token]);

  useEffect(() => { setOpen(false); setError(null); }, [context?.token]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) setNow(performance.now());
    }, 200);
    return () => window.clearInterval(timer);
  }, [open]);
  if (!context) return null;
  const current = snapshot?.token === context.token ? snapshot : null;
  const selected = current?.threads.find((thread) => thread.id === current.selectedThreadId);
  return <div className="relative shrink-0">
    <button type="button" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Shared Rust debugger threads, ${current?.threads.length ?? 0} reported`}
      title="Native threads in the shared Rust LLDB session"
      onClick={() => setOpen((value) => !value)}
      className="h-7 rounded px-2 flex items-center gap-1.5 text-amber-300 hover:bg-zinc-800">
      <span className="max-w-[100px] truncate">{selected?.name ?? "Native threads"}</span>
      {selected && <span className="text-zinc-400">#{selected.id}</span>}
      <span className="text-zinc-400">· {current?.threads.length ?? 0}</span>
      <span className="text-zinc-500">▾</span>
    </button>
    {open && <>
      <button type="button" className="fixed inset-0 z-40 cursor-default" aria-label="Close native threads" onClick={() => setOpen(false)} />
      <div role="dialog" aria-label="Shared Rust and native threads"
        className="absolute top-full left-0 mt-1 w-[320px] max-h-[min(60vh,440px)] overflow-y-auto rounded border border-zinc-700 bg-zinc-900 shadow-2xl z-50 p-2 text-xs">
        <p className="px-1 pb-2 text-zinc-400">One Rust process and LLDB session. Choosing a thread here also changes A’s inspection and step target. ⇥ steps the selected native thread only at a source line.</p>
        {current?.stale && <p role="status" className="px-1 pb-2 text-amber-300">Thread list may be stale; waiting for LLDB.</p>}
        {error && <p role="alert" className="px-1 pb-2 text-red-300">{error}</p>}
        <div className="space-y-1">
          {current?.threads.map((thread) => {
            const sinceSnapshot = Math.max(0, now - (thread.receivedAt ?? now));
            const observedFor = elapsed(thread.observedMs + sinceSnapshot);
            const ranFor = elapsed(thread.ranMs + (thread.state === "running" ? sinceSnapshot : 0));
            const duration = thread.runObserved ? `ran for ${ranFor}`
              : thread.state === "paused" ? "running time unavailable" : `observed for ${observedFor}`;
            return <button key={`${current.sessionKey}:${thread.incarnation}`}
            type="button" disabled={thread.state !== "paused" || current.stepPending}
            aria-label={`${thread.name}, ID ${thread.id}, ${thread.state} ${duration}${thread.state === "paused" ? ", inspect" : ", pause to inspect"}`}
            onClick={() => void selectNativeThread(thread.id).then(() => setOpen(false))
              .catch((failure) => setError(String(failure)))}
            className={`block w-full rounded px-1.5 py-1 text-left ${thread.state === "paused" ? "hover:bg-zinc-800" : "opacity-70 cursor-default"} ${thread.id === current.selectedThreadId ? "bg-zinc-800" : ""}`}>
            <span className="block truncate text-zinc-200">{thread.name} <span className="text-zinc-500">#{thread.id}</span></span>
            <span className={thread.reason === "exception" ? "text-red-300" : thread.state === "paused" ? "text-amber-300" : "text-zinc-500"}>{thread.reason === "exception" ? "● exception · paused" : thread.state === "paused" ? "● paused" : thread.state}</span>
            <span className="ml-2 text-zinc-500" title={thread.runObserved
              ? `Cumulative debugger-observed running time, excluding pauses; not CPU time. Total observed for ${observedFor}.`
              : `The debugger has not established a running interval for this thread. Total observed for ${observedFor}.`}>· {duration}</span>
          </button>})}
          {!current?.threads.length && <p className="px-1 text-zinc-500">Waiting for LLDB threads.</p>}
        </div>
      </div>
    </>}
  </div>;
}
