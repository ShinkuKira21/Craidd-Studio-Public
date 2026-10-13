import type { editor } from "monaco-editor";

// The code editor that last had focus (main or side group), for commands that
// act on it from outside the editor components (F9, Edit → Undo/Redo).
let current: editor.IStandaloneCodeEditor | null = null;
let currentFile: (() => string | null) | null = null;

export function setActiveEditor(instance: editor.IStandaloneCodeEditor | null, file?: () => string | null): void {
  current = instance;
  currentFile = instance ? file ?? null : null;
}
export function getActiveEditor(): editor.IStandaloneCodeEditor | null { return current; }
/** The file shown in the focused editor, when the editor knows it. */
export function getActiveEditorFile(): string | null { return currentFile?.() ?? null; }

export function triggerEditorCommand(command: "undo" | "redo"): void {
  if (!current) return;
  current.focus();
  current.trigger("menu", command, null);
}
