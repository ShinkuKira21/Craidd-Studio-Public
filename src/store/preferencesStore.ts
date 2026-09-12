import { create } from "zustand";

/**
 * Preferences: pure UI state that persists across the session.
 *
 * Note: NONE of this is written to disk yet. Persistence comes
 * in a later phase via tauri-plugin-store. For now, these reset
 * every time the app restarts. That's intentional — we're proving
 * the UI wiring first.
 */

interface PreferencesState {
  // Zoom affects both Monaco font size and UI text scale
  fontSize: number;         // 8..24, step 1
  setFontSize: (n: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  wordWrap: boolean;
  toggleWordWrap: () => void;

  sidebarVisible: boolean;
  toggleSidebar: () => void;

  bottomPanelVisible: boolean;
  toggleBottomPanel: () => void;

  rightPanelVisible: boolean;
  toggleRightPanel: () => void;
}

const FONT_MIN = 8;
const FONT_MAX = 24;
const FONT_DEFAULT = 12.5;

export const usePreferences = create<PreferencesState>((set) => ({
  fontSize: FONT_DEFAULT,
  setFontSize: (n) =>
    set({ fontSize: Math.max(FONT_MIN, Math.min(FONT_MAX, n)) }),
  zoomIn: () =>
    set((s) => ({ fontSize: Math.min(FONT_MAX, s.fontSize + 1) })),
  zoomOut: () =>
    set((s) => ({ fontSize: Math.max(FONT_MIN, s.fontSize - 1) })),
  resetZoom: () => set({ fontSize: FONT_DEFAULT }),

  wordWrap: false,
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),

  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  bottomPanelVisible: true,
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),

  rightPanelVisible: true,
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
}));
