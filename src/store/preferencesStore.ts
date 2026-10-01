import { create } from "zustand";

export type BreakpointFocusMode = "always" | "idle" | "never";
export type EditorTheme = "craidd-dark" | "vs-dark" | "vs-light";
export type IdeTheme = "craidd-dark" | "classic-dark" | "light";
export type LdiDuplicateMode = "open" | "hide";
export type DuplicateWindowMode = "show" | "hide-and-view" | "limit";
const FOCUS_KEY = "craidd:breakpoint-focus-mode";
const EDITOR_THEME_KEY = "craidd:editor-theme";
const IDE_THEME_KEY = "craidd:ide-theme";
const LDI_DUPLICATE_KEY = "craidd:ldi-duplicate-mode";
const DUPLICATE_WINDOW_MODE_KEY = "craidd:duplicate-window-mode";
const DUPLICATE_WINDOW_LIMIT_KEY = "craidd:duplicate-window-limit";

function readDuplicateWindowMode(): DuplicateWindowMode {
  try {
    const value = localStorage.getItem(DUPLICATE_WINDOW_MODE_KEY);
    return value === "show" || value === "hide-and-view" ? value : "limit";
  } catch { return "limit"; }
}

function readDuplicateWindowLimit(): number {
  try {
    const value = Number(localStorage.getItem(DUPLICATE_WINDOW_LIMIT_KEY));
    return Number.isInteger(value) && value >= 1 && value <= 24 ? value : 3;
  } catch { return 3; }
}

function readLdiDuplicateMode(): LdiDuplicateMode {
  try { return localStorage.getItem(LDI_DUPLICATE_KEY) === "hide" ? "hide" : "open"; }
  catch { return "open"; }
}

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
  ldiDuplicateMode: LdiDuplicateMode;
  setLdiDuplicateMode: (mode: LdiDuplicateMode) => void;
  duplicateWindowMode: DuplicateWindowMode;
  setDuplicateWindowMode: (mode: DuplicateWindowMode) => void;
  duplicateWindowLimit: number;
  setDuplicateWindowLimit: (limit: number) => void;
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
  ldiDuplicateMode: readLdiDuplicateMode(),
  setLdiDuplicateMode: (mode) => {
    try { localStorage.setItem(LDI_DUPLICATE_KEY, mode); } catch { /* Keep this window's choice. */ }
    set({ ldiDuplicateMode: mode });
  },
  duplicateWindowMode: readDuplicateWindowMode(),
  setDuplicateWindowMode: (mode) => {
    try { localStorage.setItem(DUPLICATE_WINDOW_MODE_KEY, mode); } catch { /* Keep this window's choice. */ }
    set({ duplicateWindowMode: mode });
  },
  duplicateWindowLimit: readDuplicateWindowLimit(),
  setDuplicateWindowLimit: (limit) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 24) return;
    try { localStorage.setItem(DUPLICATE_WINDOW_LIMIT_KEY, String(limit)); } catch { /* Keep this window's choice. */ }
    set({ duplicateWindowLimit: limit });
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === FOCUS_KEY) usePreferences.setState({ breakpointFocusMode: readBreakpointFocusMode() });
    if (event.key === EDITOR_THEME_KEY) usePreferences.setState({ theme: readEditorTheme() });
    if (event.key === IDE_THEME_KEY) usePreferences.setState({ ideTheme: readIdeTheme() });
    if (event.key === LDI_DUPLICATE_KEY) usePreferences.setState({ ldiDuplicateMode: readLdiDuplicateMode() });
    if (event.key === DUPLICATE_WINDOW_MODE_KEY) usePreferences.setState({ duplicateWindowMode: readDuplicateWindowMode() });
    if (event.key === DUPLICATE_WINDOW_LIMIT_KEY) usePreferences.setState({ duplicateWindowLimit: readDuplicateWindowLimit() });
  });
}
