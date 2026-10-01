import { useEffect, useRef, useState } from "react";
import {
  useLinkedWindows,
  setLinkedWindowVisible,
  focusLinkedWindow,
  isChromeOsGuest,
  prepareLinkedWindow,
  prepareApplicationWindow,
  waitForLinkedWindowReady,
} from "../../store/linkedWindowsStore";
import type { LinkedMember } from "../../store/linkedWindowsStore";
import { windowAttention } from "../../lib/windowAttention";

/**
 * The tray + close flow. Rules:
 *   - Native OS chrome stays. X always works.
 *   - File → Exit chooses Window / Solution / Application explicitly.
 *     Then, in solution/CS order, prompt for unsaved files before stopping
 *     the requested scope. Native OS X remains window-local.
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
  targets: LinkedMember[];           // all windows in the chosen scope
}

export default function WindowManager() {
  const windows = useLinkedWindows((s) => s.windows);
  const own = useLinkedWindows((s) => s.ownWindowLabel);
  const viewed = useLinkedWindows((s) => s.viewedWindowLabel);
  const select = useLinkedWindows((s) => s.selectWindow);

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [flow, setFlow] = useState<CloseFlow | null>(null);
  const inFlow = useRef(false);

  const problems = useLinkedWindows((s) => s.problems);
  const errorCount = windows.filter((item) => windowAttention(item, problems) === "error").length;
  const pausedCount = windows.filter((item) => item.windowLabel !== viewed && windowAttention(item, problems) === "paused").length;
  const hidden = windows.filter((w) => !w.visible && !w.restoring).length;
  const visible = windows.filter((w) => w.visible && !w.restoring).length;
  const current = windows.find((w) => w.windowLabel === viewed);

  // Retain the deferred native-close listener for older window flows.
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

  useEffect(() => {
    const onExit = (event: Event) => {
      const scope = (event as CustomEvent<Scope>).detail;
      if (scope === "window" || scope === "solution" || scope === "ide") void beginExitScope(scope);
    };
    window.addEventListener("craidd:exit-scope", onExit);
    return () => window.removeEventListener("craidd:exit-scope", onExit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, windows, flow]);

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
          await promptNext({ initiator, scope: "window", phase: "dirty", queue: [initiator], current: null, targets: item ? [item] : [] });
        } else {
          setFlow({ initiator, scope: "window", phase: "finalize", queue: [], current: null, targets: item ? [item] : [] });
        }
        return;
      }
      setFlow({ initiator, scope: "window", phase: "scope", queue: [], current: null, targets: [] });
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
        targets: item ? [item] : [],
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlow.current = false;
    }
  };

  // Called when the scope dialog resolves.
  const inspectScope = async (initiator: string, scope: Scope) => {
    const queue: string[] = [];
    try {
      const targets = scope === "ide"
        ? await import("@tauri-apps/api/core").then(({ invoke }) => invoke<LinkedMember[]>("get_application_windows"))
        : scope === "solution" ? windows : windows.filter((item) => item.windowLabel === initiator);
      const sorted = [...targets].sort((a, b) => a.solutionPath.localeCompare(b.solutionPath) || a.windowId - b.windowId);
      for (const item of sorted) {
        if (item.restoring) throw new Error(`Wait for ${shortName(item)} to finish opening before exiting.`);
        const dirty = item.visible ? await prepareApplicationWindow(item.windowLabel, item.solutionPath, "inspect") : item.dirtyCount;
        if (dirty > 0) queue.push(item.windowLabel);
      }
      await promptNext({ initiator, scope, phase: "dirty", queue, current: null, targets: sorted });
    } catch (cause) {
      setError(String(cause));
    }
  };

  const chooseScope = async (scope: Scope) => {
    if (flow) await inspectScope(flow.initiator, scope);
  };

  const beginExitScope = async (scope: Scope) => {
    if (!own || flow || inFlow.current) return;
    if (scope === "window") { await beginTrayClose(own); return; }
    inFlow.current = true;
    setError(null);
    try { await inspectScope(own, scope); }
    finally { inFlow.current = false; }
  };

  // Called when a dirty prompt resolves.
  const promptNext = async (f: CloseFlow) => {
    const next = f.queue[0];
    if (!next) {
      setFlow({ ...f, phase: "finalize", current: null });
      return;
    }
    const item = f.targets.find((w) => w.windowLabel === next);
    // If a hidden window has dirty tabs, show it before prompting.
    if (item && !item.visible && !item.restoring) {
      if (!windows.some((window) => window.windowLabel === next)) throw new Error("A hidden window in another solution has unsaved files; show and save it before exiting");
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
      const target = flow.targets.find((item) => item.windowLabel === flow.current);
      if (!target) throw new Error("The window being saved is no longer available");
      await prepareApplicationWindow(flow.current, target.solutionPath, "save");
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
    if (args.scope === "ide") { await invoke("exit_application"); return; }
    if (args.scope === "solution") await invoke("stop_solution_sessions");
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
      const targets = flow.targets.map((item) => item.windowLabel);
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

  const changeVisibility = async (label: string, show: boolean): Promise<boolean> => {
    setError(null);
    try {
      if (!show) {
        const item = windows.find((w) => w.windowLabel === label);
        if (item?.visible) {
          const dirty = await prepareLinkedWindow(label, "inspect");
          if (dirty > 0) {
            setError(`Save ${shortName(item)} before hiding it.`);
            return false;
          }
        }
      }
      await setLinkedWindowVisible(label, show);
      return true;
    } catch (cause) {
      setError(String(cause));
      return false;
    }
  };

  const onRowClick = async (item: LinkedMember) => {
    setError(null);
    setFocusNotice(null);
    try {
      if (item.visible && item.windowLabel !== own) {
        await focusVisibleWindow(item);
        return;
      }
      await select(item.windowLabel);
      setOpen(false);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const focusVisibleWindow = async (item: LinkedMember) => {
    setError(null);
    setFocusNotice(null);
    try {
      if (await focusLinkedWindow(item.windowLabel)) {
        setOpen(false);
      } else if (await isChromeOsGuest()) {
        setFocusNotice(`Focus was not confirmed for ${shortName(item)}. The ChromeOS host may prevent a Linux app from activating another window. Use Alt+Tab, the app bar/shelf, or Hide this window and then select it here to control it in one IDE window.`);
      } else {
        setOpen(false);
      }
    } catch (cause) {
      setError(`Could not request focus for ${shortName(item)}: ${String(cause)}`);
    }
  };

  // If a scope window's dirty prompt is the current one, its dialog renders
  // here (this component is mounted in every window's React tree, but only
  // the initiator's tree renders the flow dialogs).
  const renderFlow = flow && flow.initiator === own;

  if (windows.length < 2 && !flow && !error) return null;

  return (
    <div className="relative shrink-0 flex items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${windows.length} linked IDE windows, ${hidden} hidden${pausedCount ? `, ${pausedCount} need debugging attention` : ""}${errorCount ? `, ${errorCount} failed` : ""}`}
        className={
          "h-8 px-2.5 rounded border flex items-center gap-2 text-[11px] transition-colors " +
          (errorCount > 0
            ? "border-red-500 bg-red-950/50 text-red-200 craidd-attention-error"
            : pausedCount > 0
            ? "border-amber-400 bg-amber-900/30 text-amber-200 craidd-attention-warning"
            : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800")
        }
      >
        <span className="truncate max-w-36">
          Viewing: {current ? shortName(current) : "This window"}
        </span>
        <span className="text-zinc-500">{windows.length} windows · {hidden} hidden</span>
        {errorCount > 0 && <span className="text-red-300 font-semibold">{errorCount} error{errorCount === 1 ? "" : "s"}</span>}
        {pausedCount > 0 && <span className="text-amber-300 font-semibold">{pausedCount} paused</span>}
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
          <div className="absolute right-0 top-full mt-1 z-50 w-[min(30rem,calc(100vw-1rem))] rounded border border-zinc-700 bg-zinc-900 shadow-2xl p-1.5">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
              IDE windows in this solution
            </div>
            {windows.map((item) => {
              const selected = item.windowLabel === viewed;
              const canHide = visible > 1 || !item.visible;
              const attention = windowAttention(item, problems);
              const failed = attention === "error";
              const paused = attention === "paused";
              const primary = item.visible && item.windowLabel !== own ? "Focus" : item.visible ? null : "Adopt";
              return (
                <div
                  key={item.windowLabel}
                  className={
                    "flex items-center gap-1 rounded px-1 py-1 " +
                    (failed
                      ? "border border-red-700/60 bg-red-950/30 craidd-attention-error"
                      : paused
                      ? "border border-amber-600/50 bg-amber-950/25 craidd-attention-warning"
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
                      <span className={failed ? "text-red-400" : paused ? "text-amber-400" : item.visible ? (selected ? "text-blue-400" : "text-zinc-500") : "text-zinc-600"}>●</span>
                      <span className="truncate text-zinc-200">{shortName(item)}</span>
                      {failed && <span className="text-[10px] text-red-300">Error</span>}
                      {!failed && paused && <span className="text-[10px] text-amber-300">Paused</span>}
                      {item.windowLabel === own && <span className="text-[10px] text-zinc-500">this</span>}
                    </span>
                    <span className="block pl-4 text-[10px] text-zinc-500">{stateLabel(item)}</span>
                  </button>

                  {primary === "Focus" && (
                    <button
                      type="button"
                      onClick={() => void focusVisibleWindow(item)}
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
            {focusNotice && <div role="status" className="px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">{focusNotice}</div>}
            {error && <div role="alert" className="px-2 py-1 text-[11px] text-red-400">{error}</div>}
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
            Unsaved changes — {shortName(flow!.targets.find((w) => w.windowLabel === flow!.current) ?? windows[0])}
          </h2>
          <p className="text-zinc-400">
            {flow!.targets.find((w) => w.windowLabel === flow!.current)?.dirtyCount ?? 0} file
            {(flow!.targets.find((w) => w.windowLabel === flow!.current)?.dirtyCount ?? 0) === 1 ? "" : "s"} have unsaved changes.
          </p>
          <div className="mt-2 max-h-40 overflow-auto text-xs text-zinc-500">
            {(flow!.targets.find((w) => w.windowLabel === flow!.current)?.tabs ?? [])
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
