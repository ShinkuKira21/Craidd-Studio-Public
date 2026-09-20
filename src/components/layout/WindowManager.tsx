import { useEffect, useMemo, useState } from "react";
import { useLinkedWindows, setLinkedWindowVisible, prepareLinkedWindow } from "../../store/linkedWindowsStore";

function shortName(label: string, project: string, all: { projectName: string; windowLabel: string }[]) {
  const siblings = all.filter((item) => item.projectName === project);
  const index = siblings.findIndex((item) => item.windowLabel === label);
  return siblings.length > 1 ? `${project} · ${index + 1}` : project;
}

export default function WindowManager() {
  const windows = useLinkedWindows((state) => state.windows);
  const own = useLinkedWindows((state) => state.ownWindowLabel);
  const viewed = useLinkedWindows((state) => state.viewedWindowLabel);
  const select = useLinkedWindows((state) => state.selectWindow);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ label: string; action: "hide" | "close" } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const paused = windows.filter((item) => item.status === "paused").length;
  const hidden = windows.filter((item) => !item.visible).length;
  const visible = windows.length - hidden;
  const current = windows.find((item) => item.windowLabel === viewed);
  const pausedKey = useMemo(() => windows.filter((item) => item.status === "paused").map((item) => item.windowLabel).join("|"), [windows]);

  useEffect(() => {
    if (!pausedKey) return;
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 1600);
    return () => window.clearTimeout(timer);
  }, [pausedKey]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("craidd:linked-native-close-blocked", () => {
        if (own) { setOpen(true); setPending({ label: own, action: "close" }); }
      })
    ).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch((cause) => console.error("[craidd] Could not listen for native close:", cause));
    return () => { disposed = true; unlisten?.(); };
  }, [own]);

  if (windows.length < 2) return null;

  const changeVisibility = async (label: string, show: boolean) => {
    setError(null);
    try {
      const item = windows.find((entry) => entry.windowLabel === label);
      if (!show && item && item.dirtyCount > 0) { setPending({ label, action: "hide" }); return; }
      await setLinkedWindowVisible(label, show);
      if (!show && viewed === label && own !== label && own) await select(own);
    } catch (cause) { setError(String(cause)); }
  };
  const closeWindow = async (label: string) => {
    setError(null);
    try {
      const item = windows.find((entry) => entry.windowLabel === label);
      if (item && (item.dirtyCount > 0 || ["starting", "building", "running", "paused"].includes(item.status))) {
        setPending({ label, action: "close" }); return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("close_linked_window", { targetLabel: label });
    } catch (cause) { setError(String(cause)); }
  };
  const finishPending = async (decision: "save" | "discard") => {
    if (!pending) return;
    setPreparing(true);
    setError(null);
    try {
      const item = windows.find((entry) => entry.windowLabel === pending.label);
      if (item?.dirtyCount) await prepareLinkedWindow(pending.label, decision);
      if (pending.action === "hide") await setLinkedWindowVisible(pending.label, false);
      else {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("close_linked_window", { targetLabel: pending.label });
      }
      setPending(null);
      setOpen(false);
    } catch (cause) { setError(String(cause)); }
    finally { setPreparing(false); }
  };

  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen((value) => !value)}
        title={`${windows.length} linked IDE windows, ${hidden} hidden${paused ? `, ${paused} paused` : ""}`}
        className={"h-8 px-2.5 rounded border flex items-center gap-2 text-[11px] transition-colors " +
          (flash ? "border-amber-400 bg-amber-900/30 text-amber-200" : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800")}
      >
        <span className="truncate max-w-36">Viewing: {current ? shortName(current.windowLabel, current.projectName, windows) : "This window"}</span>
        <span className="text-zinc-500">{windows.length} windows · {hidden} hidden</span>
        {paused > 0 && <span className="text-amber-400 font-semibold">{paused} paused</span>}
        <span className="text-zinc-500">▾</span>
      </button>
      {open && <>
        <button type="button" aria-label="Close window list" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded border border-zinc-700 bg-zinc-900 shadow-2xl p-1.5">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">IDE windows in this solution</div>
          {windows.map((item) => {
            const name = shortName(item.windowLabel, item.projectName, windows);
            const selected = item.windowLabel === viewed;
            const cannotHide = visible <= 1;
            return <div key={item.windowLabel} className={"flex items-center gap-1 rounded px-1 py-1 " + (selected ? "bg-blue-900/30" : "hover:bg-zinc-800/70")}>
              <button type="button" onClick={() => { void select(item.windowLabel).catch((cause) => setError(String(cause))); setOpen(false); }}
                className="flex-1 min-w-0 text-left px-1.5 py-1 rounded hover:bg-zinc-700/70"
                title={`View ${name} in this IDE window`}>
                <span className="flex items-center gap-1.5"><span className={item.status === "paused" ? "text-amber-400" : selected ? "text-blue-400" : "text-zinc-600"}>{selected ? "●" : item.status === "paused" ? "●" : "○"}</span>
                  <span className="truncate text-zinc-200">{name}</span>
                  {item.windowLabel === own && <span className="text-[10px] text-zinc-500">here</span>}
                </span>
                <span className="block pl-4 text-[10px] text-zinc-500">{item.visible ? "Visible" : "Hidden"} · <span className={item.status === "paused" ? "text-amber-400" : ""}>{item.status}</span>{item.dirtyCount ? ` · ${item.dirtyCount} unsaved` : ""}</span>
              </button>
              <button type="button" onClick={() => void changeVisibility(item.windowLabel, !item.visible)}
                disabled={item.visible && cannotHide}
                title={item.visible && visible <= 1 ? "Keep one IDE window visible" : item.visible ? `Hide ${name}` : `Show ${name}`}
                className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-white disabled:text-zinc-600 disabled:cursor-default"
              >{item.visible ? "Hide" : "Show"}</button>
              <button type="button" onClick={() => void closeWindow(item.windowLabel)}
                title={`Close ${name}`}
                className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-red-300 disabled:text-zinc-600 disabled:cursor-default">Close</button>
            </div>;
          })}
          {error && <div className="px-2 py-1 text-[11px] text-red-400">{error}</div>}
        </div>
      </>}
      {pending && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65">
        <div role="dialog" aria-modal="true" aria-label={`${pending.action === "hide" ? "Hide" : "Close"} IDE window`}
          className="w-[min(440px,calc(100vw-32px))] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl p-5 text-sm text-zinc-200">
          <h2 className="text-base font-medium mb-2">{pending.action === "hide" ? "Hide" : "Close"} {windows.find((item) => item.windowLabel === pending.label)?.projectName ?? "IDE window"}?</h2>
          {(windows.find((item) => item.windowLabel === pending.label)?.dirtyCount ?? 0) > 0 &&
            <p className="text-zinc-400 mb-2">Unsaved files belong to that IDE window. Save keeps the changes; Discard closes those unsaved tabs.</p>}
          {pending.action === "close" && <p className="text-amber-300/90 mb-2">Closing ends this window's active build, run, or debugger session.</p>}
          {error && <p className="text-red-400 mb-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" disabled={preparing} onClick={() => { setPending(null); setError(null); }} className="px-3 py-1.5 rounded hover:bg-zinc-800">Cancel</button>
            {(windows.find((item) => item.windowLabel === pending.label)?.dirtyCount ?? 0) > 0 &&
              <button type="button" disabled={preparing} onClick={() => void finishPending("discard")} className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800">Discard and {pending.action}</button>}
            <button type="button" disabled={preparing} onClick={() => void finishPending("save")} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">{preparing ? "Working…" : (windows.find((item) => item.windowLabel === pending.label)?.dirtyCount ?? 0) > 0 ? `Save and ${pending.action}` : "Close window"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
