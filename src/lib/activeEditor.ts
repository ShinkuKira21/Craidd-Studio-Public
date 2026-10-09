import type { editor } from "monaco-editor";

// The mounted code editor, for commands that act on it from outside the
// editor component (F9, Edit → Undo/Redo).
let current: editor.IStandaloneCodeEditor | null = null;

export function setActiveEditor(instance: editor.IStandaloneCodeEditor | null): void { current = instance; }
export function getActiveEditor(): editor.IStandaloneCodeEditor | null { return current; }

export function triggerEditorCommand(command: "undo" | "redo"): void {
  if (!current) return;
  current.focus();
  current.trigger("menu", command, null);
}
