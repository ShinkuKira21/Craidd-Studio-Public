import { create } from "zustand";

interface PreferencesState {
  fontSize: number;
  setFontSize: (n: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  wordWrap: boolean;
  toggleWordWrap: () => void;

  tabSize: number;
  setTabSize: (n: number) => void;

  theme: "vs-dark" | "vs-light";
  setTheme: (t: "vs-dark" | "vs-light") => void;

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
  zoomIn: () => set((s) => ({ fontSize: Math.min(FONT_MAX, s.fontSize + 1) })),
  zoomOut: () => set((s) => ({ fontSize: Math.max(FONT_MIN, s.fontSize - 1) })),
  resetZoom: () => set({ fontSize: FONT_DEFAULT }),

  wordWrap: false,
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),

  tabSize: 2,
  setTabSize: (n) => set({ tabSize: Math.max(1, Math.min(8, n)) }),

  theme: "vs-dark",
  setTheme: (t) => set({ theme: t }),

  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  bottomPanelVisible: true,
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),

  rightPanelVisible: true,
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
}));
