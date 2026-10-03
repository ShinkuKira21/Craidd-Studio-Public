import { useEffect, useState } from "react";
import { useSessionFeedback } from "../../store/sessionFeedbackStore";

export default function SessionNotice() {
  const notice = useSessionFeedback((state) => state.notice);
  const [seconds, setSeconds] = useState(5);
  const [hovered, setHovered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSeconds(5); setHovered(false); setBusy(false); setError(null); }, [notice]);
  useEffect(() => {
    if (!notice || hovered || busy) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [notice, hovered, busy]);
  useEffect(() => { if (notice && seconds === 0) useSessionFeedback.setState({ notice: null }); }, [notice, seconds]);
  if (!notice) return null;
  return <div role="status" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocus={() => setHovered(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHovered(false); }}
    className="fixed bottom-10 right-4 z-[130] max-w-md rounded border border-amber-700 bg-zinc-900 px-4 py-3 text-xs text-zinc-200 shadow-xl">
    <p>{notice.message}</p>
    {error && <p role="alert" className="mt-2 text-amber-300 break-words">{error}</p>}
    <div className="mt-2 flex justify-end gap-3">
      {notice.action && <button type="button" disabled={busy} className="text-blue-300 disabled:text-zinc-500" onClick={() => {
        setBusy(true);
        void notice.action!().then(() => useSessionFeedback.setState({ notice: null }))
          .catch((cause) => { setError(String(cause)); setSeconds(5); }).finally(() => setBusy(false));
      }}>{busy ? "Restarting…" : notice.actionLabel}</button>}
      <button type="button" disabled={busy} className="text-zinc-400 disabled:opacity-40" onClick={() => useSessionFeedback.setState({ notice: null })}>
        Dismiss{!busy ? ` (${seconds})` : ""}
      </button>
    </div>
  </div>;
}
