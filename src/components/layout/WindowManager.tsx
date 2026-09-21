import { useEffect, useMemo, useRef, useState } from "react";
import { useLinkedWindows, setLinkedWindowVisible, focusLinkedWindow, prepareLinkedWindow, waitForLinkedWindowReady } from "../../store/linkedWindowsStore";

function shortName(project: string, id: number) { return `${project}: CS${id}`; }

export default function WindowManager() {
  const windows = useLinkedWindows((state) => state.windows);
  const own = useLinkedWindows((state) => state.ownWindowLabel);
  const viewed = useLinkedWindows((state) => state.viewedWindowLabel);
  const select = useLinkedWindows((state) => state.selectWindow);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ label: string; dirtyCount: number } | null>(null);
  const [closeFlow, setCloseFlow] = useState<{ target: string; dirtyLabels: string[]; phase: "unsaved" | "scope" } | null>(null);
  const closeInspection = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const paused = windows.filter((item) => item.status === "paused").length;
  const hidden = windows.filter((item) => !item.visible && !item.restoring).length;
  const visible = windows.filter((item) => item.visible && !item.restoring).length;
  const current = windows.find((item) => item.windowLabel === viewed);
  const exception = windows.find((item) => item.windowLabel !== viewed && item.status === "paused" && item.pauseReason?.toLowerCase().includes("exception"));
  const failure = windows.find((item) => item.windowLabel !== viewed && item.status === "failed" && item.failureMessage);
  const attention = exception ?? failure;
  const pausedKey = useMemo(() => windows.filter((item) => item.status === "paused").map((item) => item.windowLabel).join("|"), [windows]);

  const beginClose = async (target: string) => {
    if (closeInspection.current || closeFlow) return;
    closeInspection.current = true;
    setError(null);
    try {
      const dirtyLabels: string[] = [];
      for (const item of useLinkedWindows.getState().windows) {
        const count = item.visible ? await prepareLinkedWindow(item.windowLabel, "inspect") : item.dirtyCount;
        if (count > 0) dirtyLabels.push(item.windowLabel);
      }
      setOpen(false);
      setCloseFlow({ target, dirtyLabels, phase: dirtyLabels.length ? "unsaved" : "scope" });
    } catch (cause) { setError(String(cause)); setOpen(true); }
    finally { closeInspection.current = false; }
  };

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
      listen<{ targetLabel: string }>("craidd:linked-native-close-blocked", (event) => {
        if (own && event.payload.targetLabel === own) void beginClose(own);
      })
    ).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch((cause) => console.error("[craidd] Could not listen for native close:", cause));
    return () => { disposed = true; unlisten?.(); };
  }, [own, closeFlow]);

  if (windows.length < 2 && !pending && !closeFlow && !error) return null;

  const changeVisibility = async (label: string, show: boolean) => {
    setError(null);
    try {
      const item = windows.find((entry) => entry.windowLabel === label);
      if (!show && item?.visible) {
        const dirtyCount = await prepareLinkedWindow(label, "inspect");
        if (dirtyCount > 0) { setPending({ label, dirtyCount }); return; }
      }
      await setLinkedWindowVisible(label, show);
    } catch (cause) { setError(String(cause)); }
  };
  const resolveUnsaved = async (decision: "save" | "discard") => {
    if (!closeFlow) return;
    setPreparing(true);
    setError(null);
    try {
      for (const label of closeFlow.dirtyLabels) await prepareLinkedWindow(label, decision);
      setCloseFlow({ ...closeFlow, dirtyLabels: [], phase: "scope" });
    } catch (cause) { setError(String(cause)); }
    finally { setPreparing(false); }
  };
  const finishClose = async (scope: "this" | "all" | "others") => {
    if (!closeFlow || !own) return;
    setPreparing(true);
    setError(null);
    try {
      const current = useLinkedWindows.getState().windows;
      const targets = scope === "this" ? current.filter((item) => item.windowLabel === closeFlow.target)
        : scope === "others" ? current.filter((item) => item.windowLabel !== own) : current;
      const lastVisible = scope === "this" && targets[0]?.visible
        && current.filter((item) => item.visible && !item.restoring).length === 1;
      if (lastVisible) {
        const hiddenSibling = current.find((item) => item.windowLabel !== closeFlow.target && !item.visible && !item.restoring);
        if (hiddenSibling) {
          await setLinkedWindowVisible(hiddenSibling.windowLabel, true);
          await waitForLinkedWindowReady(hiddenSibling.windowLabel);
        }
      }
      const { invoke } = await import("@tauri-apps/api/core");
      for (const item of targets.sort((a, b) => Number(a.windowLabel === own) - Number(b.windowLabel === own))) {
        await invoke("close_linked_window", { targetLabel: item.windowLabel });
      }
      setCloseFlow(null);
    } catch (cause) { setError(String(cause)); }
    finally { setPreparing(false); }
  };
  const finishPending = async (decision: "save" | "discard") => {
    if (!pending) return;
    setPreparing(true);
    setError(null);
    try {
      const item = windows.find((entry) => entry.windowLabel === pending.label);
      if (pending.dirtyCount && item?.visible) await prepareLinkedWindow(pending.label, decision);
      await setLinkedWindowVisible(pending.label, false);
      setPending(null);
      setOpen(false);
    } catch (cause) { setError(String(cause)); }
    finally { setPreparing(false); }
  };

  return (
    <div className="relative shrink-0 flex items-center gap-1">
      {attention && attention.windowLabel !== viewed && <button type="button"
        title={`View ${attention.projectName}'s ${exception ? "exception" : "failure"} in this IDE window`}
        onClick={() => void select(attention.windowLabel).catch((cause) => setError(String(cause)))}
        className="h-8 px-2 rounded border border-amber-600/70 bg-amber-900/30 text-amber-200 text-[11px] hover:bg-amber-900/50">
        {exception ? "Exception" : "Failed"}: {shortName(attention.projectName, attention.windowId)} · View here
      </button>}
      <button type="button" onClick={() => setOpen((value) => !value)}
        title={`${windows.length} linked IDE windows, ${hidden} hidden${paused ? `, ${paused} paused` : ""}`}
        className={"h-8 px-2.5 rounded border flex items-center gap-2 text-[11px] transition-colors " +
          (flash ? "border-amber-400 bg-amber-900/30 text-amber-200" : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800")}
      >
        <span className="truncate max-w-36">Viewing: {current ? shortName(current.projectName, current.windowId) : "This window"}</span>
        <span className="text-zinc-500">{windows.length} windows · {hidden} hidden</span>
        {paused > 0 && <span className="text-amber-400 font-semibold">{paused} paused</span>}
        <span className="text-zinc-500">▾</span>
      </button>
      {open && <>
        <button type="button" aria-label="Close window list" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded border border-zinc-700 bg-zinc-900 shadow-2xl p-1.5">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">IDE windows in this solution</div>
          {windows.map((item) => {
            const name = shortName(item.projectName, item.windowId);
            const selected = item.windowLabel === viewed;
            const cannotHide = visible <= 1;
            return <div key={item.windowLabel} className={"flex items-center gap-1 rounded px-1 py-1 " + (selected ? "bg-blue-900/30" : "hover:bg-zinc-800/70")}>
              <button type="button" onClick={() => { void select(item.windowLabel).catch((cause) => setError(String(cause))); setOpen(false); }}
                className="flex-1 min-w-0 text-left px-1.5 py-1 rounded hover:bg-zinc-700/70"
                title={item.failureMessage ?? `View ${name} in this IDE window`}>
                <span className="flex items-center gap-1.5"><span className={item.status === "paused" ? "text-amber-400" : selected ? "text-blue-400" : "text-zinc-600"}>{selected ? "●" : item.status === "paused" ? "●" : "○"}</span>
                  <span className="truncate text-zinc-200">{name}</span>
                  {item.windowLabel === own && <span className="text-[10px] text-zinc-500">here</span>}
                </span>
                <span className="block pl-4 text-[10px] text-zinc-500">{item.restoring ? "Opening" : item.visible ? "Visible" : "Hidden"} · <span className={item.status === "paused" || item.failureMessage ? "text-amber-400" : ""}>{item.status}{item.pauseReason ? ` (${item.pauseReason})` : ""}</span>{item.dirtyCount ? ` · ${item.dirtyCount} unsaved` : ""}</span>
              </button>
              {item.visible && item.windowLabel !== own && <button type="button"
                onClick={() => void focusLinkedWindow(item.windowLabel).catch((cause) => setError(String(cause)))}
                title={`Focus ${name}'s IDE window`} className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-white">Focus</button>}
              <button type="button" onClick={() => void changeVisibility(item.windowLabel, !item.visible)}
                disabled={item.restoring || (item.visible && cannotHide)}
                title={item.visible && visible <= 1 ? "Keep one IDE window visible" : item.visible ? `Hide ${name}` : `Show ${name}`}
                className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-white disabled:text-zinc-600 disabled:cursor-default"
              >{item.restoring ? "Opening…" : item.visible ? "Hide" : "Show"}</button>
              <button type="button" onClick={() => void beginClose(item.windowLabel)}
                disabled={item.restoring}
                title={`Close ${name}`}
                className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-red-300 disabled:text-zinc-600 disabled:cursor-default">Close</button>
            </div>;
          })}
          {error && <div className="px-2 py-1 text-[11px] text-red-400">{error}</div>}
        </div>
      </>}
      {pending && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65">
        <div role="dialog" aria-modal="true" aria-label="Hide IDE window"
          className="w-[min(440px,calc(100vw-32px))] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl p-5 text-sm text-zinc-200">
          <h2 className="text-base font-medium mb-2">Hide {windows.find((item) => item.windowLabel === pending.label)?.projectName ?? "IDE window"}?</h2>
          {pending.dirtyCount > 0 &&
            <p className="text-zinc-400 mb-2">Unsaved files belong to that IDE window. Save keeps the changes; Discard closes those unsaved tabs.</p>}
          {error && <p className="text-red-400 mb-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" disabled={preparing} onClick={() => { setPending(null); setError(null); }} className="px-3 py-1.5 rounded hover:bg-zinc-800">Cancel</button>
            {pending.dirtyCount > 0 &&
              <button type="button" disabled={preparing} onClick={() => void finishPending("discard")} className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800">Discard and Hide</button>}
            <button type="button" disabled={preparing} onClick={() => void finishPending("save")} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">{preparing ? "Working…" : "Save and Hide"}</button>
          </div>
        </div>
      </div>}
      {closeFlow && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65">
        <div role="dialog" aria-modal="true" aria-label={closeFlow.phase === "unsaved" ? "Unsaved Work" : "Closing Linked Project"}
          className="w-[min(460px,calc(100vw-32px))] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl p-5 text-sm text-zinc-200">
          {closeFlow.phase === "unsaved" ? <>
            <h2 className="text-base font-medium mb-2">Unsaved Work</h2>
            <p className="text-zinc-400">{closeFlow.dirtyLabels.length} linked IDE {closeFlow.dirtyLabels.length === 1 ? "window has" : "windows have"} unsaved files. Resolve them before choosing which windows to close.</p>
            <p className="text-zinc-500 mt-2 text-xs">Save checks for disk conflicts. Discard drops unsaved changes in every listed window.</p>
            <div className="mt-2 max-h-40 overflow-auto text-xs text-zinc-500">{closeFlow.dirtyLabels.map((label) => {
              const item = windows.find((entry) => entry.windowLabel === label);
              return <div key={label} className="mb-1">
                <span className="text-zinc-300">{item ? shortName(item.projectName, item.windowId) : label}</span>
                {item?.tabs.filter((tab) => tab.dirty).map((tab) => <span key={tab.path} className="block pl-3 truncate" title={tab.path}>{tab.name}</span>)}
              </div>;
            })}</div>
          </> : <>
            <h2 className="text-base font-medium mb-2">Closing Linked Project</h2>
            <p className="text-zinc-400">Choose what to close in this solution. Closing a session stops its application and debugger. “Close all but 1” keeps this IDE window.</p>
          </>}
          {error && <p className="text-red-400 mt-3">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 mt-5">
            {closeFlow.phase === "unsaved" && <button type="button" disabled={preparing} onClick={() => { setCloseFlow(null); setError(null); }}
              className="px-3 py-1.5 rounded hover:bg-zinc-800">Cancel</button>}
            {closeFlow.phase === "unsaved" ? <>
              <button type="button" disabled={preparing} onClick={() => void resolveUnsaved("discard")}
                className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800">Discard all</button>
              <button type="button" disabled={preparing} onClick={() => void resolveUnsaved("save")}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white">{preparing ? "Working…" : "Save all and continue"}</button>
            </> : <>
              <button type="button" disabled={preparing} onClick={() => void finishClose("this")}
                className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800">Close this Window</button>
              {windows.length > 1 && <button type="button" disabled={preparing} onClick={() => void finishClose("others")}
                title="Keep this IDE window and close every other session in the solution"
                className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800">Close all but 1</button>}
              <button type="button" disabled={preparing} onClick={() => void finishClose("all")}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white">Close all Windows</button>
            </>}
          </div>
        </div>
      </div>}
    </div>
  );
}
