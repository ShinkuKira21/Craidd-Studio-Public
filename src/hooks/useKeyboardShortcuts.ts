import { useEffect } from "react";
import { usePreferences } from "../store/preferencesStore";
import { useLayout } from "../store/layoutStore";

/**
 * Global keyboard shortcuts. Registered once, at AppShell level.
 *
 * We follow VS Code conventions exactly. Do NOT invent new bindings.
 */
export function useKeyboardShortcuts(openCommandPalette: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Zoom
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        usePreferences.getState().zoomIn();
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        usePreferences.getState().zoomOut();
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        usePreferences.getState().resetZoom();
        return;
      }

      // Word wrap (Alt+Z)
      if (e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        usePreferences.getState().toggleWordWrap();
        return;
      }

      // Sidebar toggle (Ctrl+B)
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        usePreferences.getState().toggleSidebar();
        return;
      }

      // Bottom panel toggle (Ctrl+J)
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        usePreferences.getState().toggleBottomPanel();
        return;
      }

      // Command palette (Ctrl+Shift+P)
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      // Reserved-but-not-yet-working shortcuts: intercept so the OS
      // doesn't do something else, and let the user know it registered.
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        console.log("[craidd] Ctrl+S is reserved for Phase 3 (Save)");
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        console.log("[craidd] Ctrl+Shift+S is reserved for Phase 3 (Save As)");
        return;
      }
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        // Close the active file in the focused pane (mirrors VS Code)
        const layout = useLayout.getState();
        const pane = layout.panes.find((p) => p.id === layout.focusedPaneId);
        if (pane?.activeFileId) {
          // Import workspace store lazily to avoid circular import
          import("../store/workspaceStore").then(({ useWorkspace }) => {
            useWorkspace.getState().closeTab(pane.activeFileId!);
            layout.setPaneFile(pane.id, null);
          });
        }
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommandPalette]);
}
