import "./monacoSetup";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppErrorBoundary from "./AppErrorBoundary";
import { usePreferences } from "./store/preferencesStore";
import './assets/styles/index.css'

function applyThemes() {
  const { theme, ideTheme } = usePreferences.getState();
  document.documentElement.dataset.editorTheme = theme;
  document.documentElement.dataset.ideTheme = ideTheme;
}

applyThemes();
usePreferences.subscribe((state, previous) => {
  if (state.theme !== previous.theme || state.ideTheme !== previous.ideTheme) applyThemes();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
