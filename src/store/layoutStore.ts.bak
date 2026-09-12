import { create } from "zustand";

/**
 * Layout store: manages the split editor panes.
 *
 * A pane has its own active file. Panes are laid out left-to-right.
 * The focused pane determines which debug context is shown (see workspaceStore).
 *
 * Phase 1.5 supports at most 2 panes. The shape is intentionally
 * generic so it can grow to N panes later without changing consumers.
 */

export interface EditorPane {
  id: string;            // "pane-1", "pane-2"
  activeFileId: string | null;
}

interface LayoutState {
  panes: EditorPane[];
  focusedPaneId: string;

  setFocusedPane: (paneId: string) => void;
  setPaneFile: (paneId: string, fileId: string) => void;

  /** Split a pane to the right, moving the currently active file into it. */
  splitPane: (sourcePaneId: string) => void;

  /** Close a pane. Never closes the last pane. */
  closePane: (paneId: string) => void;

  /** Size of the left pane as a percentage 20..80 */
  splitRatio: number;
  setSplitRatio: (r: number) => void;

  /** Sidebar / right panel / bottom panel sizes */
  sidebarWidth: number;
  setSidebarWidth: (n: number) => void;

  rightPanelWidth: number;
  setRightPanelWidth: (n: number) => void;

  bottomPanelHeight: number;
  setBottomPanelHeight: (n: number) => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  panes: [
    { id: "pane-1", activeFileId: "rust-core/src/main.rs" },
  ],
  focusedPaneId: "pane-1",

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  setPaneFile: (paneId, fileId) =>
    set((s) => ({
      panes: s.panes.map((p) =>
        p.id === paneId ? { ...p, activeFileId: fileId } : p
      ),
    })),

  splitPane: (sourcePaneId) => {
    const s = get();
    if (s.panes.length >= 2) return;
    const source = s.panes.find((p) => p.id === sourcePaneId);
    if (!source) return;
    const newPaneId = `pane-${s.panes.length + 1}`;
    const newPane: EditorPane = { id: newPaneId, activeFileId: null };
    set({
      panes: [...s.panes, newPane],
      focusedPaneId: newPaneId,
    });
  },

  closePane: (paneId) =>
    set((s) => {
      if (s.panes.length <= 1) return s;
      const panes = s.panes.filter((p) => p.id !== paneId);
      const focusedPaneId = s.focusedPaneId === paneId ? panes[0].id : s.focusedPaneId;
      return { panes, focusedPaneId };
    }),

  splitRatio: 50,
  setSplitRatio: (r) => set({ splitRatio: Math.max(20, Math.min(80, r)) }),

  sidebarWidth: 288,
  setSidebarWidth: (n) => set({ sidebarWidth: Math.max(180, Math.min(500, n)) }),

  rightPanelWidth: 288,
  setRightPanelWidth: (n) => set({ rightPanelWidth: Math.max(180, Math.min(500, n)) }),

  bottomPanelHeight: 192,
  setBottomPanelHeight: (n) => set({ bottomPanelHeight: Math.max(80, Math.min(600, n)) }),
}));
