import { useEffect, useState } from "react";
import MenuBar from "../menu/MenuBar";
import Toolbar from "./Toolbar";
import StatusBar from "./StatusBar";
import ActivityBar from "./ActivityBar";
import Sidebar from "../sidebar/Sidebar";
import EditorPane from "../editor/EditorPane";
import DebugSidebar from "../panels/DebugSidebar";
import BottomPanel from "../panels/BottomPanel";
import ResizeHandle from "./ResizeHandle";
import CommandPalette from "../command-palette/CommandPalette";
import AncestorSolutionDialog from "../dialogs/AncestorSolutionDialog";
import PreferencesDialog from "../preferences/PreferencesDialog";
import DeletedFileDialog from "../dialogs/DeletedFileDialog";
import SaveConflictDialog from "../dialogs/SaveConflictDialog";
import CriticalWorkspaceBanner from "./CriticalWorkspaceBanner";
import { usePreferences } from "../../store/preferencesStore";
import { useLayout } from "../../store/layoutStore";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useSolution } from "../../store/solutionStore";

export default function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const pendingSave = useSolution((s) => s.pendingSave);
  const setPendingSave = useSolution((s) => s.setPendingSave);
  useKeyboardShortcuts(
    () => setPaletteOpen(true),
    () => setPrefsOpen(true),
  );

  // Show the native window only after React has mounted.
  // The window is created hidden (visible: false in tauri.conf.json).
  // Combined with the inline dark style in index.html, this eliminates
  // the white flash between native window creation and first paint.
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("show_main_window");
      } catch {
        // Running in a plain browser (npm run dev) — no Tauri. Fine.
      }
    })();
  }, []);

  // Refresh disk state for all open tabs whenever the window regains focus.
  useEffect(() => {
    const onFocus = () => {
      void useSolution.getState().refreshDiskStates();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const sidebarVisible = usePreferences((s) => s.sidebarVisible);
  const bottomPanelVisible = usePreferences((s) => s.bottomPanelVisible);
  const rightPanelVisible = usePreferences((s) => s.rightPanelVisible);

  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const setSidebarWidth = useLayout((s) => s.setSidebarWidth);
  const rightPanelWidth = useLayout((s) => s.rightPanelWidth);
  const setRightPanelWidth = useLayout((s) => s.setRightPanelWidth);
  const bottomPanelHeight = useLayout((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useLayout((s) => s.setBottomPanelHeight);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-300 text-[13px] overflow-hidden">
      <MenuBar openCommandPalette={() => setPaletteOpen(true)} openPreferences={() => setPrefsOpen(true)} />
      <Toolbar />

      <div className="flex-1 flex min-h-0">
        <ActivityBar />
        {sidebarVisible && (
          <>
            <div style={{ width: sidebarWidth }} className="h-full shrink-0"><Sidebar /></div>
            <ResizeHandle orientation="vertical" onDrag={(delta) => setSidebarWidth(sidebarWidth + delta)} />
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <EditorPane />
          {bottomPanelVisible && (
            <>
              <ResizeHandle orientation="horizontal" onDrag={(delta) => setBottomPanelHeight(bottomPanelHeight - delta)} />
              <div style={{ height: bottomPanelHeight }} className="shrink-0"><BottomPanel /></div>
            </>
          )}
        </div>

        {rightPanelVisible && (
          <>
            <ResizeHandle orientation="vertical" onDrag={(delta) => setRightPanelWidth(rightPanelWidth - delta)} />
            <div style={{ width: rightPanelWidth }} className="h-full shrink-0"><DebugSidebar /></div>
          </>
        )}
      </div>

      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AncestorSolutionDialog />
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}
      {pendingSave?.kind === "deleted" && (
        <DeletedFileDialog
          fileId={pendingSave.fileId}
          onClose={() => setPendingSave(null)}
        />
      )}
      {pendingSave?.kind === "newer" && (
        <SaveConflictDialog
          fileId={pendingSave.fileId}
          onClose={() => setPendingSave(null)}
        />
      )}
      <CriticalWorkspaceBanner />
    </div>
  );
}
