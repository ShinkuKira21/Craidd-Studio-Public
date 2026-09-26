import { create } from "zustand";

export type BreakpointFocusMode = "always" | "idle" | "never";
export type EditorTheme = "craidd-dark" | "vs-dark" | "vs-light";
export type IdeTheme = "craidd-dark" | "classic-dark" | "light";
const FOCUS_KEY = "craidd:breakpoint-focus-mode";
const EDITOR_THEME_KEY = "craidd:editor-theme";
const IDE_THEME_KEY = "craidd:ide-theme";

function readEditorTheme(): EditorTheme {
  try {
    const value = localStorage.getItem(EDITOR_THEME_KEY);
    return value === "vs-dark" || value === "vs-light" ? value : "craidd-dark";
  } catch { return "craidd-dark"; }
}

function readIdeTheme(): IdeTheme {
  try {
    const value = localStorage.getItem(IDE_THEME_KEY);
    return value === "classic-dark" || value === "light" ? value : "craidd-dark";
  } catch { return "craidd-dark"; }
}

export function readBreakpointFocusMode(): BreakpointFocusMode {
  try {
    const value = localStorage.getItem(FOCUS_KEY);
    return value === "always" || value === "idle" ? value : "never";
  } catch { return "never"; }
}

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

  theme: EditorTheme;
  setTheme: (theme: EditorTheme) => void;
  ideTheme: IdeTheme;
  setIdeTheme: (theme: IdeTheme) => void;

  sidebarVisible: boolean;
  toggleSidebar: () => void;

  bottomPanelVisible: boolean;
  toggleBottomPanel: () => void;

  rightPanelVisible: boolean;
  toggleRightPanel: () => void;
  breakpointFocusMode: BreakpointFocusMode;
  setBreakpointFocusMode: (mode: BreakpointFocusMode) => void;
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

  theme: readEditorTheme(),
  setTheme: (theme) => {
    try { localStorage.setItem(EDITOR_THEME_KEY, theme); } catch { /* Keep the choice in this window. */ }
    set({ theme });
  },
  ideTheme: readIdeTheme(),
  setIdeTheme: (ideTheme) => {
    try { localStorage.setItem(IDE_THEME_KEY, ideTheme); } catch { /* Keep the choice in this window. */ }
    set({ ideTheme });
  },

  sidebarVisible: true,
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  bottomPanelVisible: true,
  toggleBottomPanel: () => set((s) => ({ bottomPanelVisible: !s.bottomPanelVisible })),

  rightPanelVisible: true,
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
  breakpointFocusMode: readBreakpointFocusMode(),
  setBreakpointFocusMode: (mode) => {
    try { localStorage.setItem(FOCUS_KEY, mode); } catch { /* The current window still uses the choice. */ }
    set({ breakpointFocusMode: mode });
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === FOCUS_KEY) usePreferences.setState({ breakpointFocusMode: readBreakpointFocusMode() });
    if (event.key === EDITOR_THEME_KEY) usePreferences.setState({ theme: readEditorTheme() });
    if (event.key === IDE_THEME_KEY) usePreferences.setState({ ideTheme: readIdeTheme() });
  });
}
