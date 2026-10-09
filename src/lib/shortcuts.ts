// One table for every IDE shortcut. The keydown handler dispatches from it
// and the menu bar reads its labels from it, so a shortcut cannot be shown
// without being handled. See docs/uiux/design-public-release-sweep.md §5.

export type ShortcutId =
  | "exitWindow" | "exitSolution" | "exitIde"
  | "openFolder" | "openSolution"
  | "build" | "run" | "debugOrContinue" | "stop" | "pause"
  | "stepOver" | "stepInto" | "stepOut" | "toggleBreakpoint"
  | "save" | "saveAs" | "rename" | "preferences" | "commandPalette"
  | "zoomIn" | "zoomOut" | "resetZoom" | "wordWrap" | "toggleSidebar" | "togglePanel"
  | "closeTab" | "undo" | "redo";

export interface KeyLike {
  key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; repeat?: boolean;
}

/** Where focus is when the key arrives. */
export type FocusArea = "editor" | "text" | "other";

interface Shortcut {
  id: ShortcutId;
  label: string;
  /** "Ctrl+K" means the key must follow a Ctrl+K press. */
  chord?: "Ctrl+K";
  match: (e: KeyLike) => boolean;
  /** Also fires while typing in a dialog field or other non-editor input. */
  inText?: boolean;
  /** Fires while focus is in the code editor. Defaults to true. */
  inEditor?: boolean;
  /** Fires again while the key is held. Defaults to false. */
  repeats?: boolean;
  /** Monaco handles the key itself; the table only supplies the menu label. */
  labelOnly?: boolean;
}

const mod = (e: KeyLike) => e.ctrlKey || e.metaKey;
const plain = (e: KeyLike) => !mod(e) && !e.shiftKey && !e.altKey;
const letter = (e: KeyLike, value: string) => e.key.toLowerCase() === value;

export const SHORTCUTS: Shortcut[] = [
  { id: "exitWindow", label: "Ctrl+Q", match: (e) => mod(e) && !e.shiftKey && !e.altKey && letter(e, "q"), inText: true },
  { id: "exitSolution", label: "Ctrl+Shift+Q", match: (e) => mod(e) && e.shiftKey && !e.altKey && letter(e, "q"), inText: true },
  { id: "exitIde", label: "Ctrl+Alt+Q", match: (e) => mod(e) && e.altKey && !e.shiftKey && letter(e, "q"), inText: true },
  { id: "openFolder", label: "Ctrl+K Ctrl+O", chord: "Ctrl+K", match: (e) => mod(e) && !e.shiftKey && !e.altKey && letter(e, "o") },
  { id: "openSolution", label: "Ctrl+Shift+O", match: (e) => mod(e) && e.shiftKey && !e.altKey && letter(e, "o"), inEditor: false },
  { id: "build", label: "Ctrl+Shift+B", match: (e) => mod(e) && e.shiftKey && !e.altKey && letter(e, "b"), inText: true },
  { id: "run", label: "Ctrl+F5", match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key === "F5", inText: true },
  { id: "debugOrContinue", label: "F5", match: (e) => plain(e) && e.key === "F5", inText: true },
  { id: "stop", label: "Shift+F5", match: (e) => !mod(e) && e.shiftKey && !e.altKey && e.key === "F5", inText: true },
  { id: "pause", label: "F6", match: (e) => plain(e) && e.key === "F6", inText: true },
  { id: "stepOver", label: "F10", match: (e) => plain(e) && e.key === "F10", inText: true, repeats: true },
  { id: "stepInto", label: "F11", match: (e) => plain(e) && e.key === "F11", inText: true, repeats: true },
  { id: "stepOut", label: "Shift+F11", match: (e) => !mod(e) && e.shiftKey && !e.altKey && e.key === "F11", inText: true, repeats: true },
  { id: "toggleBreakpoint", label: "F9", match: (e) => plain(e) && e.key === "F9" },
  { id: "save", label: "Ctrl+S", match: (e) => mod(e) && !e.shiftKey && !e.altKey && letter(e, "s"), inText: true },
  { id: "saveAs", label: "Ctrl+Shift+S", match: (e) => mod(e) && e.shiftKey && !e.altKey && letter(e, "s"), inText: true },
  { id: "rename", label: "F2", match: (e) => plain(e) && e.key === "F2", inEditor: false },
  { id: "preferences", label: "Ctrl+,", match: (e) => mod(e) && !e.altKey && e.key === ",", inText: true },
  { id: "commandPalette", label: "Ctrl+Shift+P", match: (e) => mod(e) && e.shiftKey && !e.altKey && letter(e, "p"), inText: true },
  { id: "zoomIn", label: "Ctrl+=", match: (e) => mod(e) && !e.altKey && (e.key === "=" || e.key === "+"), repeats: true, inText: true },
  { id: "zoomOut", label: "Ctrl+-", match: (e) => mod(e) && !e.altKey && e.key === "-", repeats: true, inText: true },
  { id: "resetZoom", label: "Ctrl+0", match: (e) => mod(e) && !e.altKey && e.key === "0", inText: true },
  { id: "wordWrap", label: "Alt+Z", match: (e) => e.altKey && !mod(e) && !e.shiftKey && letter(e, "z") },
  { id: "toggleSidebar", label: "Ctrl+B", match: (e) => mod(e) && !e.shiftKey && !e.altKey && letter(e, "b") },
  { id: "togglePanel", label: "Ctrl+J", match: (e) => mod(e) && !e.shiftKey && !e.altKey && letter(e, "j") },
  { id: "closeTab", label: "Ctrl+W", match: (e) => mod(e) && !e.shiftKey && !e.altKey && letter(e, "w") },
  { id: "undo", label: "Ctrl+Z", match: () => false, labelOnly: true },
  { id: "redo", label: "Ctrl+Y", match: () => false, labelOnly: true },
];

export function shortcutLabel(id: ShortcutId): string {
  return SHORTCUTS.find((item) => item.id === id)?.label ?? "";
}

/** True for Ctrl+K on its own, the first half of a chord. */
export function isChordPrefix(e: KeyLike): boolean {
  return mod(e) && !e.shiftKey && !e.altKey && letter(e, "k");
}

/**
 * Resolve a key press to a shortcut, or null. `afterChord` is true when the
 * previous key was a Ctrl+K prefix. Chorded shortcuts match only after it,
 * and an unchorded shortcut never matches the key that completes a chord.
 */
export function matchShortcut(e: KeyLike, area: FocusArea, afterChord = false): ShortcutId | null {
  for (const item of SHORTCUTS) {
    if (item.labelOnly || Boolean(item.chord) !== afterChord || !item.match(e)) continue;
    if (e.repeat && !item.repeats) return null;
    if (area === "text" && !item.inText) return null;
    if (area === "editor" && item.inEditor === false) return null;
    return item.id;
  }
  return null;
}

/** Classify a key event target. Monaco's hidden textarea counts as the editor. */
export function focusAreaOf(target: EventTarget | null): FocusArea {
  const element = target as { closest?: (selector: string) => unknown; isContentEditable?: boolean; tagName?: string } | null;
  if (!element || typeof element.closest !== "function") return "other";
  if (element.closest(".monaco-editor")) return "editor";
  const tag = element.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable) return "text";
  return "other";
}
