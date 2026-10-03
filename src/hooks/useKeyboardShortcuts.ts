import { useEffect } from "react";
import { usePreferences } from "../store/preferencesStore";
import { useSolution } from "../store/solutionStore";
import { saveActiveFile, saveActiveFileAs } from "../lib/fileActions";
import { useLinkedWindows } from "../store/linkedWindowsStore";
import { startViewedAction, stopViewedAction } from "../lib/viewedActions";
import { useSessionFeedback } from "../store/sessionFeedbackStore";

export function useKeyboardShortcuts(
  openCommandPalette: () => void,
  openPreferences: () => void,
) {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (useSessionFeedback.getState().savePrompt) return;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "q") {
        const scope = e.altKey && !e.shiftKey ? "ide" : e.shiftKey && !e.altKey ? "solution" : !e.altKey && !e.shiftKey ? "window" : null;
        if (scope) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("craidd:exit-scope", { detail: scope }));
          return;
        }
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        try { await startViewedAction("build"); } catch (error) { alert(`Build failed: ${String(error)}`); }
        return;
      }
      if (mod && e.key === "F5") {
        e.preventDefault();
        try { await startViewedAction("run"); } catch (error) { alert(`Run failed: ${String(error)}`); }
        return;
      }
      if (!mod && !e.shiftKey && e.key === "F5") {
        e.preventDefault();
        try { await startViewedAction("debug"); } catch (error) { alert(`Debug failed: ${String(error)}`); }
        return;
      }
      if (e.shiftKey && e.key === "F5") {
        e.preventDefault();
        try { await stopViewedAction(); } catch (error) { alert(`Stop failed: ${String(error)}`); }
        return;
      }

      // ── Save ─────────────────────────────────────────────
      if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const linked = useLinkedWindows.getState();
        if (linked.viewedWindowLabel !== linked.ownWindowLabel && !linked.remoteEditing) return;
        try { await saveActiveFile(); }
        catch (err) { alert(`Save failed: ${String(err)}`); }
        return;
      }

      // ── Save As ──────────────────────────────────────────
      if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const linked = useLinkedWindows.getState();
        if (linked.viewedWindowLabel !== linked.ownWindowLabel && !linked.remoteEditing) return;
        try {
          await saveActiveFileAs();
        } catch (err) {
          console.error("[craidd] Save As failed:", err);
          alert(`Save As failed: ${String(err)}`);
        }
        return;
      }

      // ── Rename (F2) ─────────────────────────────────────
      // Fires the same event path as right-click → Rename. The
      // focused tree item handler lives in the sidebar.
      if (e.key === "F2") {
        e.preventDefault();
        const s = useSolution.getState();
        if (s.focusedTreeTarget) {
          const target = s.focusedTreeTarget;
          // Clear before firing so a second F2 does not re-trigger the
          // same node. The user must click a tree row again to rename
          // another item; this matches Visual Studio's explorer behaviour.
          s.setFocusedTreeTarget(null);
          s.requestRename(target.path, target.source);
        }
        return;
      }

      // ── Preferences ──────────────────────────────────────
      if (mod && e.key === ",") {
        e.preventDefault();
        openPreferences();
        return;
      }

      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); usePreferences.getState().zoomIn(); return; }
      if (mod && e.key === "-") { e.preventDefault(); usePreferences.getState().zoomOut(); return; }
      if (mod && e.key === "0") { e.preventDefault(); usePreferences.getState().resetZoom(); return; }
      if (e.altKey && e.key.toLowerCase() === "z") { e.preventDefault(); usePreferences.getState().toggleWordWrap(); return; }
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); usePreferences.getState().toggleSidebar(); return; }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); usePreferences.getState().toggleBottomPanel(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); openCommandPalette(); return; }

      // Ctrl+W: close active tab (prompts if dirty via EditorTabs; here
      // we just do a raw close, the prompt flow lives in the pane).
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        const s = useSolution.getState();
        if (s.activeFileId) {
          const tab = s.tabs.find((t) => t.fileId === s.activeFileId);
          if (tab && (tab.dirty || tab.diskState === "deleted")) {
            // Let the pane handle it — dispatch a custom event.
            window.dispatchEvent(new CustomEvent("craidd:request-close", { detail: s.activeFileId }));
          } else {
            s.closeTab(s.activeFileId);
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommandPalette, openPreferences]);
}
