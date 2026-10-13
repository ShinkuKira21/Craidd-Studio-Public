import { useEffect } from "react";
import { usePreferences } from "../store/preferencesStore";
import { useSolution } from "../store/solutionStore";
import { saveActiveFile, saveActiveFileAs, saveOpenFile } from "../lib/fileActions";
import { useSplit } from "../store/splitStore";
import { useLinkedWindows } from "../store/linkedWindowsStore";
import { debugKeyViewed, debugOrContinueViewed, startViewedAction, stopViewedAction } from "../lib/viewedActions";
import { useSessionFeedback } from "../store/sessionFeedbackStore";
import { focusAreaOf, isChordPrefix, matchShortcut, type ShortcutId } from "../lib/shortcuts";
import { openFolderDialog, openSolutionDialog } from "../lib/workspaceActions";
import { getActiveEditor, getActiveEditorFile } from "../lib/activeEditor";
import { useBreakpoints } from "../store/breakpointStore";

const CHORD_WINDOW_MS = 1500;

function report(what: string, error: unknown) {
  alert(`${what} failed: ${String(error)}`);
}

export function useKeyboardShortcuts(
  openCommandPalette: () => void,
  openPreferences: () => void,
) {
  useEffect(() => {
    let chordAt = 0;

    const canEditViewed = () => {
      const linked = useLinkedWindows.getState();
      return linked.viewedWindowLabel === linked.ownWindowLabel || linked.remoteEditing;
    };

    const run = async (id: ShortcutId) => {
      switch (id) {
        case "exitWindow": case "exitSolution": case "exitIde": {
          const scope = id === "exitIde" ? "ide" : id === "exitSolution" ? "solution" : "window";
          window.dispatchEvent(new CustomEvent("craidd:exit-scope", { detail: scope }));
          return;
        }
        case "openFolder": try { await openFolderDialog(); } catch (error) { report("Open Folder", error); } return;
        case "openSolution": try { await openSolutionDialog(); } catch (error) { report("Open Solution", error); } return;
        case "build": try { await startViewedAction("build"); } catch (error) { report("Build", error); } return;
        case "run": try { await startViewedAction("run"); } catch (error) { report("Run", error); } return;
        case "debugOrContinue": try { await debugOrContinueViewed(); } catch (error) { report("Debug", error); } return;
        case "stop": try { await stopViewedAction(); } catch (error) { report("Stop", error); } return;
        case "pause": case "stepOver": case "stepInto": case "stepOut":
          try { await debugKeyViewed(id); } catch (error) { report("Debug control", error); }
          return;
        case "toggleBreakpoint": {
          const file = getActiveEditorFile() ?? useSolution.getState().activeFileId;
          const line = getActiveEditor()?.getPosition()?.lineNumber;
          if (!file || !line) return;
          // Red breakpoints only. LDI blue markers keep their gutter and context-menu flow.
          try { await useBreakpoints.getState().toggle(file, line); } catch (error) { report("Toggle breakpoint", error); }
          return;
        }
        case "save":
          if (!canEditViewed()) return;
          try {
            const side = useSplit.getState();
            if (side.sideFocused && side.sideFileId) await saveOpenFile(side.sideFileId); else await saveActiveFile();
          } catch (error) { report("Save", error); }
          return;
        case "saveAs":
          if (!canEditViewed()) return;
          try { await saveActiveFileAs(); } catch (error) {
            console.error("[craidd] Save As failed:", error);
            report("Save As", error);
          }
          return;
        case "rename": {
          // Fires the same path as right-click → Rename on the focused tree row.
          // Cleared first so a second F2 does not rename the same node again;
          // this matches Visual Studio's explorer behaviour.
          const s = useSolution.getState();
          if (!s.focusedTreeTarget) return;
          const target = s.focusedTreeTarget;
          s.setFocusedTreeTarget(null);
          s.requestRename(target.path, target.source);
          return;
        }
        case "preferences": openPreferences(); return;
        case "commandPalette": openCommandPalette(); return;
        case "zoomIn": usePreferences.getState().zoomIn(); return;
        case "zoomOut": usePreferences.getState().zoomOut(); return;
        case "resetZoom": usePreferences.getState().resetZoom(); return;
        case "wordWrap": usePreferences.getState().toggleWordWrap(); return;
        case "toggleSidebar": usePreferences.getState().toggleSidebar(); return;
        case "togglePanel": usePreferences.getState().toggleBottomPanel(); return;
        case "closeTab": {
          // Ctrl+W in the side group closes the group, not the tab.
          if (useSplit.getState().sideFocused && useSplit.getState().sideFileId) { useSplit.getState().closeSide(); return; }
          // A dirty or deleted tab goes through the pane's close prompt.
          const s = useSolution.getState();
          if (!s.activeFileId) return;
          const tab = s.tabs.find((t) => t.fileId === s.activeFileId);
          if (tab && (tab.dirty || tab.diskState === "deleted")) {
            window.dispatchEvent(new CustomEvent("craidd:request-close", { detail: s.activeFileId }));
          } else {
            s.closeTab(s.activeFileId);
          }
          return;
        }
        case "undo": case "redo": return;
      }
    };

    // Capture phase, so IDE keys win over Monaco's own bindings and the
    // second half of Ctrl+K Ctrl+O is seen even inside the editor.
    const onKey = (e: KeyboardEvent) => {
      if (useSessionFeedback.getState().savePrompt) return;
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      if (isChordPrefix(e)) { chordAt = Date.now(); return; }
      const afterChord = chordAt > 0 && Date.now() - chordAt < CHORD_WINDOW_MS;
      chordAt = 0;
      const id = matchShortcut(e, focusAreaOf(e.target), afterChord);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      void run(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openCommandPalette, openPreferences]);
}
