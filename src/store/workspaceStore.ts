import { create } from "zustand";
import type {
  Project,
  EditorTab,
  DebugContext,
  StackFrame,
  Breakpoint,
} from "../types/project";
import {
  mockProject,
  mockTabs,
  mockDebugContexts,
  mockStackFrames,
  mockBreakpoints,
} from "../data/mockProject";
import { useLayout } from "./layoutStore";

type BottomPanelTab = "debug" | "problems" | "terminal" | "breakpoints";

interface WorkspaceState {
  project: Project;

  // Trees
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;

  // Tabs (global list — panes reference into it)
  tabs: EditorTab[];
  openTab: (tab: EditorTab) => void;
  closeTab: (fileId: string) => void;

  // Debug
  debugContexts: DebugContext[];
  // MANUAL OVERRIDE — null means "auto-follow focused pane"
  manualDebugContextId: string | null;
  setManualDebugContext: (id: string | null) => void;

  stackFrames: StackFrame[];
  breakpoints: Breakpoint[];

  // Bottom panel
  bottomTab: BottomPanelTab;
  setBottomTab: (tab: BottomPanelTab) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  project: mockProject,

  expandedNodes: new Set<string>([
    "root",
    "rust-core", "rust-core/src",
    "ts-frontend",
  ]),
  toggleNode: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { expandedNodes: next };
    }),

  tabs: mockTabs,
  openTab: (tab) =>
    set((state) => {
      if (state.tabs.some((t) => t.fileId === tab.fileId)) return state;
      return { tabs: [...state.tabs, tab] };
    }),
  closeTab: (fileId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.fileId !== fileId);
      return { tabs };
    }),

  debugContexts: mockDebugContexts,
  manualDebugContextId: null,
  setManualDebugContext: (id) => set({ manualDebugContextId: id }),

  stackFrames: mockStackFrames,
  breakpoints: mockBreakpoints,

  bottomTab: "debug",
  setBottomTab: (tab) => set({ bottomTab: tab }),
}));

/**
 * DERIVED SELECTORS
 *
 * These compute values from other stores. Components should always
 * read through these, never directly from the raw fields they derive
 * from. That's what makes it safe to change the derivation rule later
 * without touching any component.
 */

/** Which tree does the fileId belong to? "rust-core/src/main.rs" → "rust-core" */
export function treeIdOfFile(fileId: string | null): string | null {
  if (!fileId) return null;
  const ix = fileId.indexOf("/");
  return ix === -1 ? fileId : fileId.slice(0, ix);
}

/** The active file ID for the currently focused pane. */
export function useActiveFileId(): string | null {
  const focusedPaneId = useLayout((s) => s.focusedPaneId);
  const pane = useLayout((s) => s.panes.find((p) => p.id === focusedPaneId));
  return pane?.activeFileId ?? null;
}

/** The debug context ID that should be shown right now. */
export function useActiveDebugContextId(): string {
  const manual = useWorkspace((s) => s.manualDebugContextId);
  const activeFileId = useActiveFileId();

  if (manual) return manual;

  // Auto-follow: derive from the tree of the focused pane's file
  const treeId = treeIdOfFile(activeFileId);
  const contexts = useWorkspace.getState().debugContexts;
  const match = contexts.find((c) => c.treeId === treeId);
  return match?.id ?? contexts[0]?.id ?? "";
}

/** The active tab object (for the focused pane). */
export function useActiveTab(): EditorTab | null {
  const activeFileId = useActiveFileId();
  const tabs = useWorkspace((s) => s.tabs);
  return tabs.find((t) => t.fileId === activeFileId) ?? null;
}
