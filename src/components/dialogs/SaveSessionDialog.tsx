import { useEffect, useRef, useState } from "react";
import { useSessionFeedback } from "../../store/sessionFeedbackStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";
import { restartLabel } from "../../lib/saveRestartPolicy";
import { restartSessions } from "../../lib/sessionRestart";

export default function SaveSessionDialog() {
  const prompt = useSessionFeedback((state) => state.savePrompt);
  const windows = useLinkedWindows((state) => state.windows);
  const [phase, setPhase] = useState<"ready" | "saving" | "restarting" | "failed">("ready");
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(false);
  const busy = phase === "saving" || phase === "restarting";
  const close = () => { if (!busy) useSessionFeedback.setState({ savePrompt: null }); };
  useEffect(() => { setPhase("ready"); setError(null); saved.current = false; }, [prompt]);
  useEffect(() => {
    if (!prompt) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prompt, busy]);
  if (!prompt) return null;
  const save = async (restart: boolean) => {
    if (busy) return;
    setError(null);
    setPhase("saving");
    try {
      if (!saved.current) {
        if (!await prompt.save()) { useSessionFeedback.setState({ savePrompt: null }); return; }
        saved.current = true;
      }
      if (restart) {
        setPhase("restarting");
        await restartSessions(prompt.plan);
      }
      useSessionFeedback.setState({ savePrompt: null });
    } catch (cause) {
      setPhase("failed");
      setError(`${saved.current ? "File saved. " : ""}${String(cause)}`);
    }
  };
  return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60">
    <div role="dialog" aria-modal="true" aria-labelledby="session-save-title"
      className="flex max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="border-b border-zinc-800 px-5 py-3">
        <h2 id="session-save-title" className="text-sm font-medium text-zinc-100">Save while running or debugging?</h2>
      </div>
      <div className="overflow-y-auto px-5 py-4 text-xs leading-5 text-zinc-400">
        <p><span className="font-mono text-zinc-200">{prompt.fileId.split("/").pop()}</span> has changes. Save keeps the current session running. Restart rebuilds and loads your changes.</p>
        <p className="mt-2 text-zinc-500">A running debugger keeps its loaded binary and original Blue bindings until restarted.</p>
        <p className="mt-3">{prompt.plan.reason}</p>
        <div className="mt-3 text-zinc-500">{prompt.plan.scope === "gold" ? "Gold restart affects all linked windows:" : "Restart affects:"}</div>
        <ul className="mt-1 space-y-1 text-zinc-300">{prompt.plan.targets.map((target) => {
          const item = windows.find((window) => window.windowLabel === target.windowLabel);
          return <li key={target.windowLabel}>{target.configName ?? item?.projectName ?? target.windowLabel}
            <span className="ml-2 text-zinc-500">CS{item?.windowId ?? "?"}</span></li>;
        })}</ul>
        <p className="mt-3 text-zinc-500">Restart also saves pending edits in these windows. A disk conflict stops the restart before any process is stopped.</p>
        {error && <p role="alert" className="mt-3 break-words text-amber-300">{error}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 px-5 py-3 text-xs">
        <button type="button" disabled={busy} onClick={close} className="rounded px-3 py-1.5 text-zinc-400 disabled:opacity-40">{saved.current ? "Close" : "Cancel"}</button>
        {phase !== "failed" && <>
          <button autoFocus type="button" disabled={busy} onClick={() => void save(false)} className="rounded bg-zinc-800 px-3 py-1.5 text-zinc-200 disabled:opacity-40">Save</button>
          <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded bg-blue-700 px-3 py-1.5 text-white disabled:opacity-40">
            {phase === "restarting" ? "Restarting…" : phase === "saving" ? "Saving…" : `Save and ${restartLabel(prompt.plan)}`}
          </button>
        </>}
      </div>
    </div>
  </div>;
}
