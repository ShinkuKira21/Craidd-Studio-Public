import { lazy, Suspense, useEffect, useState } from "react";
import { useSolution } from "./store/solutionStore";
import { emptyStartupState, type StartupState, type WorkspaceEntry } from "./types/startup";
import { selectConfiguration, useBuild } from "./store/buildStore";

const AppShell = lazy(() => import("./components/layout/AppShell"));
const GetStarted = lazy(() => import("./components/startup/GetStarted"));

async function openEntry(entry: WorkspaceEntry): Promise<void> {
  const result = entry.kind === "solution"
    ? await useSolution.getState().openSolution(entry.path)
    : await useSolution.getState().openFolder(entry.path);
  if (result.status === "error") throw new Error(result.message);
  if (result.status === "loaded") {
    const solution = useSolution.getState().solution;
    if (solution && entry.selectedConfigName) {
      selectConfiguration(solution, entry.selectedConfigName);
      if (entry.selectedProfileName) useBuild.getState().setSelectedProfile(entry.selectedProfileName);
    }
    try { await useSolution.getState().heal(); }
    catch (error) { console.error("[craidd] Could not recover orphan projects:", error); }
  }
}

let startupPromise: Promise<{ state: StartupState; workspace: boolean; error: string | null }> | null = null;

function bootstrap() {
  if (startupPromise) return startupPromise;
  startupPromise = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const state = await invoke<StartupState>("get_startup_state");
      const request = await invoke<WorkspaceEntry | null>("take_window_open_request");
      const entry = request;
      if (entry) {
        try { await openEntry(entry); return { state, workspace: true, error: null }; }
        catch (error) { return { state, workspace: false, error: `Could not reopen ${entry.path}: ${String(error)}` }; }
      }
      return { state, workspace: false, error: null };
    } catch (error) {
      // Plain browser preview has no Tauri backend. Keep the welcome UI useful.
      return { state: emptyStartupState, workspace: false, error: "__TAURI_INTERNALS__" in window ? String(error) : null };
    }
  })();
  return startupPromise;
}

export default function App() {
  const [startup, setStartup] = useState<StartupState>(emptyStartupState);
  const [mode, setMode] = useState<"loading" | "welcome" | "workspace">("loading");
  const [error, setError] = useState<string | null>(null);
  const [startProjectDialog, setStartProjectDialog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("show_main_window"))
      .catch(() => {});
    void bootstrap().then((result) => {
      if (cancelled) return;
      setStartup(result.state);
      setError(result.error);
      setMode(result.workspace ? "workspace" : "welcome");
    });
    return () => { cancelled = true; };
  }, []);

  if (mode === "loading") return <div className="h-screen bg-zinc-950 flex items-center justify-center text-sm text-zinc-500">Opening Craidd Studio…</div>;
  if (mode === "workspace") return <Suspense fallback={<div className="h-screen bg-zinc-950" />}><AppShell startProjectDialog={startProjectDialog} onCloseStartProjectDialog={() => setStartProjectDialog(false)} /></Suspense>;
  return <Suspense fallback={<div className="h-screen bg-zinc-950" />}><GetStarted startup={startup} initialError={error} onOpen={async (entry) => {
    await openEntry(entry);
    setMode("workspace");
  }} onStartProject={async (path) => {
    const result = await useSolution.getState().openFolder(path);
    if (result.status === "error") throw new Error(result.message);
    setStartProjectDialog(result.status !== "needs-decision");
    setMode("workspace");
  }} /></Suspense>;
}
