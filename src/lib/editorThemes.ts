import type { Monaco } from "@monaco-editor/react";

export const CRAIDD_DARK_THEME = "craidd-dark";

export function defineCraiddDarkTheme(monaco: Monaco) {
  monaco.editor.defineTheme(CRAIDD_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0e1117",
      "editor.foreground": "#d4dbe5",
      "editorGutter.background": "#0e1117",
      "editorLineNumber.foreground": "#798697",
      "editorLineNumber.activeForeground": "#d4dbe5",
      "editor.lineHighlightBackground": "#1b2330",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#80bcff",
      "editor.selectionBackground": "#244668",
      "editor.inactiveSelectionBackground": "#1f354d",
      "editorIndentGuide.background1": "#2a3140",
      "editorIndentGuide.activeBackground1": "#5b687a",
      "editorWhitespace.foreground": "#404a5a",
      "editorWidget.background": "#171b23",
      "editorWidget.border": "#404a5a",
      "editorHoverWidget.background": "#171b23",
      "editorSuggestWidget.background": "#171b23",
      "editorSuggestWidget.selectedBackground": "#2a3140",
      "editorOverviewRuler.border": "#0e1117",
    },
  });
}
