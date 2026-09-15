import { useEffect } from "react";
import { usePreferences } from "../store/preferencesStore";
import { useSolution } from "../store/solutionStore";

export function useKeyboardShortcuts(
  openCommandPalette: () => void,
  openPreferences: () => void,
) {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // ── Save ─────────────────────────────────────────────
      if (mod && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const s = useSolution.getState();
        if (!s.activeFileId) return;
        const tab = s.tabs.find((t) => t.fileId === s.activeFileId);
        if (!tab) return;
        if (tab.diskState === "deleted") {
          s.setPendingSave({ fileId: s.activeFileId, kind: "deleted" });
          return;
        }
        if (tab.diskState === "newer") {
          s.setPendingSave({ fileId: s.activeFileId, kind: "newer" });
          return;
        }
        await s.saveFile(s.activeFileId);
        return;
      }

      // ── Save As ──────────────────────────────────────────
      if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const s = useSolution.getState();
        if (!s.activeFileId) return;
        const tab = s.tabs.find((t) => t.fileId === s.activeFileId);
        if (!tab) return;
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const chosen = await save({ defaultPath: tab.fileId });
          if (typeof chosen === "string") {
            await s.saveFileAs(s.activeFileId, chosen);
          }
        } catch (err) {
          console.error("[craidd] Save As failed:", err);
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
          s.requestRename(s.focusedTreeTarget.path, s.focusedTreeTarget.source);
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
