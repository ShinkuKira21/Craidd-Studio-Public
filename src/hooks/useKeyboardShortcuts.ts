import { useEffect } from "react";
import { usePreferences } from "../store/preferencesStore";
import { useSolution } from "../store/solutionStore";

export function useKeyboardShortcuts(openCommandPalette: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); usePreferences.getState().zoomIn(); return; }
      if (mod && e.key === "-") { e.preventDefault(); usePreferences.getState().zoomOut(); return; }
      if (mod && e.key === "0") { e.preventDefault(); usePreferences.getState().resetZoom(); return; }
      if (e.altKey && e.key.toLowerCase() === "z") { e.preventDefault(); usePreferences.getState().toggleWordWrap(); return; }
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); usePreferences.getState().toggleSidebar(); return; }
      if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); usePreferences.getState().toggleBottomPanel(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); openCommandPalette(); return; }

      // Ctrl+W: close active tab
      if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        const s = useSolution.getState();
        if (s.activeFileId) s.closeTab(s.activeFileId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openCommandPalette]);
}
