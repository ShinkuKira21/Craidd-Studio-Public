import { useEffect, useMemo, useRef, useState } from "react";
import {
  useLinkedWindows,
  setLinkedWindowVisible,
  focusLinkedWindow,
  prepareLinkedWindow,
  waitForLinkedWindowReady,
} from "../../store/linkedWindowsStore";
import type { LinkedMember } from "../../store/linkedWindowsStore";

/**
 * The tray + close flow. Rules:
 *   - Native OS chrome stays. X always works.
 *   - OS X in linked mode (2+ windows): scope dialog first.
 *       Close this Window / Close the Solution / Exit the IDE
 *     Then, in CS order, per-window Save All / Manual Intervention prompts.
 *   - OS X on a single-window solution: no scope dialog; just the dirty
 *     prompt if needed.
 *   - Tray Close: closes that window directly. Dirty prompt if needed.
 *   - Hidden + dirty windows are shown before their prompt appears.
 *   - Manual Intervention or Cancel anywhere halts the whole flow.
 *   - The window that got the X stays open until the flow completes.
 */

function shortName(item: LinkedMember) {
  return `${item.projectName}: CS${item.windowId}`;
}

function stateLabel(item: LinkedMember): string {
  if (item.restoring) return "Opening";
  const parts: string[] = [item.visible ? "Visible" : "Hidden", item.status];
  if (item.status === "paused" && item.pauseReason) parts.push(`(${item.pauseReason})`);
  if (item.dirtyCount > 0) parts.push(`${item.dirtyCount} unsaved`);
  return parts.join(" · ");
}

type Scope = "window" | "solution" | "ide";
type FlowPhase = "scope" | "dirty" | "finalize";

interface CloseFlow {
  initiator: string;                 // label of the window that got the close
  scope: Scope;
  phase: FlowPhase;
  queue: string[];                   // dirty-window labels, in CS order
  current: string | null;            // the window being prompted
}

export default function WindowManager() {
  const windows = useLinkedWindows((s) => s.windows);
  const own = useLinkedWindows((s) => s.ownWindowLabel);
  const viewed = useLinkedWindows((s) => s.viewedWindowLabel);
  const select = useLinkedWindows((s) => s.selectWindow);

  const [open, setOpen] = useState(false);
  const [pulseOn, setPulseOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [flow, setFlow] = useState<CloseFlow | null>(null);
  const inFlow = useRef(false);

  const pausedHidden = windows.filter((w) => !w.visible && !w.restoring && w.status === "paused");
  const pausedKey = useMemo(() => pausedHidden.map((w) => w.windowLabel).sort().join("|"), [windows]);
  const hidden = windows.filter((w) => !w.visible && !w.restoring).length;
  const visible = windows.filter((w) => w.visible && !w.restoring).length;
  const current = windows.find((w) => w.windowLabel === viewed);

  useEffect(() => {
    if (!pausedKey) return;
    setPulseOn(true);
    const t = window.setTimeout(() => setPulseOn(false), 1600);
    return () => window.clearTimeout(t);
  }, [pausedKey]);

  // Native close: Rust deferred it. We own the flow now.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ targetLabel: string }>("craidd:linked-native-close-blocked", (event) => {
          if (disposed) return;
          if (event.payload.targetLabel !== own) return;
          void beginNativeClose(event.payload.targetLabel);
        }),
      )
      .then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch((c) => console.error("[craidd] native close listener failed:", c));
    return () => { disposed = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own]);

  if (windows.length < 2 && !flow && !error) return null;

  const orderedWindows = (labels: string[]) =>
    [...labels].sort((a, b) => {
      const ai = windows.find((w) => w.windowLabel === a)?.windowId ?? 0;
      const bi = windows.find((w) => w.windowLabel === b)?.windowId ?? 0;
      return ai - bi;
    });

  // Entry point for the OS X gesture. A linked solution asks scope first;
  // a single-window solution or a tray-initiated close goes straight in.
  const beginNativeClose = async (initiator: string) => {
    if (inFlow.current) return;
    inFlow.current = true;
    setError(null);
    try {
      const linked = windows.length > 1;
      if (!linked) {
        // No scope question, but the single window still needs its dirty
        // tabs checked. An empty queue would skip straight to finalize
        // and close with unsaved edits.
        const item = windows.find((w) => w.windowLabel === initiator);
        const dirty = item && item.visible
          ? await prepareLinkedWindow(initiator, "inspect")
          : item?.dirtyCount ?? 0;
        if (dirty > 0) {
          await promptNext({ initiator, scope: "window", phase: "dirty", queue: [initiator], current: null });
        } else {
          setFlow({ initiator, scope: "window", phase: "finalize", queue: [], current: null });
        }
        return;
      }
      setFlow({ initiator, scope: "window", phase: "scope", queue: [], current: null });
    } catch (cause) {
      setError(String(cause));
      await releaseGuard(initiator);
    } finally {
      inFlow.current = false;
    }
  };

  // Entry point for tray Close. No scope dialog. Closes one window.
  const beginTrayClose = async (target: string) => {
    if (inFlow.current) return;
    inFlow.current = true;
    setError(null);
    try {
      const item = windows.find((w) => w.windowLabel === target);
      const dirty = item?.visible ? await prepareLinkedWindow(target, "inspect") : item?.dirtyCount ?? 0;
      if (dirty === 0) {
        await finalize({ scope: "window", initiator: target, targets: [target] });
        return;
      }
      await promptNext({
        initiator: target,
        scope: "window",
        phase: "dirty",
        queue: [target],
        current: null,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlow.current = false;
    }
  };

  // Called when the scope dialog resolves.
  const chooseScope = async (scope: Scope) => {
    if (!flow) return;
    const targets = scope === "window"
      ? [flow.initiator]
      : windows.map((w) => w.windowLabel);
    // CS-order, dirty-check each one.
    const queue: string[] = [];
    try {
      for (const label of orderedWindows(targets)) {
        const item = windows.find((w) => w.windowLabel === label);
        if (!item || item.restoring) continue;
        const dirty = item.visible ? await prepareLinkedWindow(label, "inspect") : item.dirtyCount;
        if (dirty > 0) queue.push(label);
      }
      await promptNext({ ...flow, scope, phase: "dirty", queue, current: null });
    } catch (cause) {
      setError(String(cause));
    }
  };

  // Called when a dirty prompt resolves.
  const promptNext = async (f: CloseFlow) => {
    const next = f.queue[0];
    if (!next) {
      setFlow({ ...f, phase: "finalize", current: null });
      return;
    }
    const item = windows.find((w) => w.windowLabel === next);
    // If a hidden window has dirty tabs, show it before prompting.
    if (item && !item.visible && !item.restoring) {
      await setLinkedWindowVisible(next, true);
      await waitForLinkedWindowReady(next);
    }
    setFlow({ ...f, phase: "dirty", current: next, queue: f.queue.slice(1) });
  };

  const resolveDirty = async (decision: "save" | "manual") => {
    if (!flow || !flow.current) return;
    setPreparing(true);
    setError(null);
    try {
      if (decision === "manual") {
        // Halt everything. The user will look through the tabs and close again.
        setFlow(null);
        if (flow.initiator === own) await releaseGuard(own);
        return;
      }
      await prepareLinkedWindow(flow.current, "save");
      await promptNext(flow);
    } catch (cause) {
      setError(String(cause));
      if (flow.initiator === own) await releaseGuard(own);
    } finally {
      setPreparing(false);
    }
  };

  const finalize = async (args: { scope: Scope; initiator: string; targets: string[] }) => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Keep one visible window if scope is "window" and it's the last visible.
    if (args.scope === "window" && args.targets.length === 1) {
      const only = args.targets[0];
      const item = windows.find((w) => w.windowLabel === only);
      if (item?.visible) {
        const othersVisible = windows.filter((w) => w.visible && !w.restoring && w.windowLabel !== only);
        if (othersVisible.length === 0) {
          const hiddenSibling = windows.find((w) => !w.visible && !w.restoring && w.windowLabel !== only);
          if (hiddenSibling) {
            await setLinkedWindowVisible(hiddenSibling.windowLabel, true);
            await waitForLinkedWindowReady(hiddenSibling.windowLabel);
          }
        }
      }
    }
    // Close initiator last so the flow survives to the end. The
    // comparator returns a positive number when `a` is the initiator,
    // pushing it to the end of the sorted list; if it returned negative
    // the initiator would close first and its React tree — with the flow
    // state and dialogs — would unmount before the remaining windows
    // were closed.
    const ordered = [...args.targets].sort(
      (a, b) => Number(a === args.initiator) - Number(b === args.initiator),
    );
    for (const label of ordered) {
      await invoke("close_linked_window", { targetLabel: label });
    }
    setFlow(null);
  };

  // Called by the finalize phase.
  const runFinalize = async () => {
    if (!flow) return;
    setPreparing(true);
    setError(null);
    try {
      const targets = flow.scope === "window"
        ? [flow.initiator]
        : windows.map((w) => w.windowLabel);
      await finalize({ scope: flow.scope, initiator: flow.initiator, targets });
    } catch (cause) {
      setError(String(cause));
      if (flow.initiator === own) await releaseGuard(own);
    } finally {
      setPreparing(false);
    }
  };

  const cancelFlow = async () => {
    if (!flow) return;
    await releaseGuard(flow.initiator);
    setFlow(null);
    setError(null);
  };

  const releaseGuard = async (initiator: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clear_native_close_guard", { targetLabel: initiator });
    } catch { /* harmless if it fails */ }
  };

  const changeVisibility = async (label: string, show: boolean) => {
    setError(null);
    try {
      if (!show) {
        const item = windows.find((w) => w.windowLabel === label);
        if (item?.visible) {
          const dirty = await prepareLinkedWindow(label, "inspect");
          if (dirty > 0) {
            await promptNext({ initiator: label, scope: "window", phase: "dirty", queue: [label], current: null });
            return;
          }
        }
      }
      await setLinkedWindowVisible(label, show);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const onRowClick = async (item: LinkedMember) => {
    setError(null);
    try {
      await select(item.windowLabel);
      setOpen(false);
    } catch (cause) {
      setError(String(cause));
    }
  };

  // If a scope window's dirty prompt is the current one, its dialog renders
  // here (this component is mounted in every window's React tree, but only
  // the initiator's tree renders the flow dialogs).
  const renderFlow = flow && flow.initiator === own;

  const buttonPulse = pulseOn || pausedHidden.length > 0;

  return (
    <div className="relative shrink-0 flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${windows.length} linked IDE windows, ${hidden} hidden${pausedHidden.length ? `, ${pausedHidden.length} paused` : ""}`}
        className={
          "h-8 px-2.5 rounded border flex items-center gap-2 text-[11px] transition-colors " +
          (buttonPulse
            ? "border-amber-400 bg-amber-900/30 text-amber-200 animate-pulse-soft"
            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800")
        }
      >
        <span className="truncate max-w-36">
          Viewing: {current ? shortName(current) : "This window"}
        </span>
        <span className="text-zinc-500">{windows.length} windows · {hidden} hidden</span>
        {pausedHidden.length > 0 && (
          <span className="text-amber-400 font-semibold">{pausedHidden.length} paused</span>
        )}
        <span className="text-zinc-500">▾</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close window list"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-[24rem] rounded border border-zinc-700 bg-zinc-900 shadow-2xl p-1.5">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
              IDE windows in this solution
            </div>
            {windows.map((item) => {
              const selected = item.windowLabel === viewed;
              const canHide = visible > 1 || !item.visible;
              const isPausedHidden = !item.visible && !item.restoring && item.status === "paused";
              const primary = item.visible && item.windowLabel !== own ? "Focus" : item.visible ? null : "Adopt";
              return (
                <div
                  key={item.windowLabel}
                  className={
                    "flex items-center gap-1 rounded px-1 py-1 " +
                    (isPausedHidden
                      ? "bg-amber-900/20 animate-pulse-soft"
                      : selected
                      ? "bg-blue-900/30"
                      : "hover:bg-zinc-800/70")
                  }
                >
                  <button
                    type="button"
                    onClick={() => void onRowClick(item)}
                    className="flex-1 min-w-0 text-left px-1.5 py-1 rounded hover:bg-zinc-700/70"
                    title={item.failureMessage ?? `View ${shortName(item)} in this IDE window`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={isPausedHidden ? "text-amber-400" : item.visible ? (selected ? "text-blue-400" : "text-zinc-500") : "text-zinc-600"}>●</span>
                      <span className="truncate text-zinc-200">{shortName(item)}</span>
                      {item.windowLabel === own && <span className="text-[10px] text-zinc-500">this</span>}
                    </span>
                    <span className="block pl-4 text-[10px] text-zinc-500">{stateLabel(item)}</span>
                  </button>

                  {primary === "Focus" && (
                    <button
                      type="button"
                      onClick={() => void focusLinkedWindow(item.windowLabel).catch((c) => setError(String(c)))}
                      className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-white"
                      title={`Focus ${shortName(item)}'s IDE window`}
                    >
                      Focus
                    </button>
                  )}

                  {item.visible ? (
                    <button
                      type="button"
                      onClick={() => void changeVisibility(item.windowLabel, false)}
                      disabled={!canHide || item.restoring}
                      title={canHide ? `Hide ${shortName(item)}` : "Keep one IDE window visible"}
                      className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-white disabled:text-zinc-600 disabled:cursor-default"
                    >
                      Hide
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void changeVisibility(item.windowLabel, true)}
                      disabled={item.restoring}
                      title={`Show ${shortName(item)}`}
                      className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-white disabled:text-zinc-600 disabled:cursor-default"
                    >
                      {item.restoring ? "Opening…" : "Show"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void beginTrayClose(item.windowLabel)}
                    disabled={item.restoring}
                    title={`Close ${shortName(item)}`}
                    className="px-1.5 py-1 text-[10px] text-zinc-400 hover:text-red-300 disabled:text-zinc-600 disabled:cursor-default"
                  >
                    Close
                  </button>
                </div>
              );
            })}
            {error && <div className="px-2 py-1 text-[11px] text-red-400">{error}</div>}
          </div>
        </>
      )}

      {renderFlow && flow!.phase === "scope" && (
        <Modal>
          <h2 className="text-base font-medium mb-2">Closing in Linked Mode</h2>
          <p className="text-zinc-400">Choose what to close.</p>
          <div className="mt-4 grid gap-2 text-[12.5px]">
            <button
              onClick={() => void chooseScope("window")}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Close this Window</div>
              <div className="text-zinc-500 text-[11px]">Only {shortName(windows.find((w) => w.windowLabel === flow!.initiator) ?? windows[0])}</div>
            </button>
            <button
              onClick={() => void chooseScope("solution")}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Close the Solution</div>
              <div className="text-zinc-500 text-[11px]">All shown and hidden windows in this solution</div>
            </button>
            <button
              onClick={() => void chooseScope("ide")}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Exit the IDE</div>
              <div className="text-zinc-500 text-[11px]">Close everything, regardless of solution</div>
            </button>
          </div>
          {error && <p className="text-red-400 mt-3">{error}</p>}
          <div className="flex justify-end mt-4">
            <button onClick={() => void cancelFlow()} className="px-3 py-1.5 rounded hover:bg-zinc-800">Cancel</button>
          </div>
        </Modal>
      )}

      {renderFlow && flow!.phase === "dirty" && flow!.current && (
        <Modal>
          <h2 className="text-base font-medium mb-2">
            Unsaved changes — {shortName(windows.find((w) => w.windowLabel === flow!.current) ?? windows[0])}
          </h2>
          <p className="text-zinc-400">
            {windows.find((w) => w.windowLabel === flow!.current)?.dirtyCount ?? 0} file
            {(windows.find((w) => w.windowLabel === flow!.current)?.dirtyCount ?? 0) === 1 ? "" : "s"} have unsaved changes.
          </p>
          <div className="mt-2 max-h-40 overflow-auto text-xs text-zinc-500">
            {(windows.find((w) => w.windowLabel === flow!.current)?.tabs ?? [])
              .filter((t) => t.dirty)
              .map((t) => (
                <div key={t.path} className="truncate pl-1" title={t.path}>• {t.name}</div>
              ))}
          </div>
          {error && <p className="text-red-400 mt-3">{error}</p>}
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => void resolveDirty("manual")}
              disabled={preparing}
              className="px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800"
              title="Look through each tab yourself, then close again"
            >
              Manual Intervention
            </button>
            <button
              onClick={() => void resolveDirty("save")}
              disabled={preparing}
              className="px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white"
            >
              {preparing ? "Saving…" : "Save All"}
            </button>
          </div>
        </Modal>
      )}

      {renderFlow && flow!.phase === "finalize" && (
        <Modal>
          <h2 className="text-base font-medium mb-2">Closing…</h2>
          <p className="text-zinc-400 text-[12px]">
            {flow!.scope === "window"
              ? "Closing this window."
              : flow!.scope === "solution"
              ? "Closing all windows in this solution."
              : "Exiting the IDE."}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => void cancelFlow()}
              disabled={preparing}
              className="px-3 py-1.5 rounded hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={() => void runFinalize()}
              disabled={preparing}
              className="px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white"
            >
              {preparing ? "Closing…" : "Close"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65">
      <div
        role="dialog"
        aria-modal="true"
        className="w-[min(520px,calc(100vw-32px))] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl p-5 text-sm text-zinc-200"
      >
        {children}
      </div>
    </div>
  );
}
