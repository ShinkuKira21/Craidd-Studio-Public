import { lazy, Suspense, useEffect, useState } from "react";
import { useSolution } from "./store/solutionStore";
import { emptyStartupState, type StartupState, type WorkspaceEntry } from "./types/startup";
import { listenToBuildEvents, selectConfiguration, useBuild } from "./store/buildStore";
import { useDebug } from "./store/debugStore";
import { setWindowInstanceId } from "./store/linkedWindowsStore";

const AppShell = lazy(() => import("./components/layout/AppShell"));
const GetStarted = lazy(() => import("./components/startup/GetStarted"));

async function openEntry(entry: WorkspaceEntry): Promise<void> {
  setWindowInstanceId(entry.instanceId ?? crypto.randomUUID());
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
    if (entry.restoredFromHidden) {
      for (const path of entry.restoredTabs ?? []) {
        await useSolution.getState().openFile(path, path.split("/").pop() ?? path);
      }
      if (entry.restoredActiveFile && useSolution.getState().tabs.some((tab) => tab.fileId === entry.restoredActiveFile)) {
        useSolution.getState().setActiveFile(entry.restoredActiveFile);
      }
      await listenToBuildEvents();
      const { invoke } = await import("@tauri-apps/api/core");
      const runtime = await invoke<{ status: string; output: string; activeId: number | null; debugging: boolean;
        file: string | null; line: number | null; frames: ReturnType<typeof useDebug.getState>["frames"];
        variables: ReturnType<typeof useDebug.getState>["variables"] } | null>("get_linked_runtime");
      if (runtime) {
        if (runtime.debugging) {
          useDebug.setState({ status: runtime.status === "paused" ? "paused" : runtime.status === "building" ? "building" : "running",
            output: runtime.output, file: runtime.file, line: runtime.line,
            frames: runtime.frames, variables: runtime.variables });
        } else {
          const status = runtime.activeId !== null ? "running"
            : runtime.status === "success" ? "success" : runtime.status === "failed" ? "failed" : "idle";
          useBuild.setState({ status, activeId: runtime.activeId, output: runtime.output,
            activeConfigName: runtime.activeId !== null ? entry.selectedConfigName ?? null : null });
        }
      }
    }
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
        catch (error) {
          if (entry.restoredFromHidden) {
            try { await invoke("abort_parked_restore", { error: String(error) }); }
            catch (abortError) { console.error("[craidd] Could not park failed restore:", abortError); }
          }
          return { state, workspace: false, error: `Could not reopen ${entry.path}: ${String(error)}` };
        }
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
    // The loading view is mounted before the native window becomes visible.
    // A short timer also runs when an initially hidden WebKit view throttles
    // animation frames, so duplicate windows cannot stay hidden indefinitely.
    let showRequested = false;
    const show = () => {
      if (showRequested) return;
      showRequested = true;
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("show_main_window"))
        .catch((cause) => console.error("[craidd] Could not show window:", cause));
    };
    const showFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(show);
    });
    const showTimer = window.setTimeout(show, 400);
    void bootstrap().then((result) => {
      if (cancelled) return;
      setStartup(result.state);
      setError(result.error);
      setMode(result.workspace ? "workspace" : "welcome");
    });
    return () => { cancelled = true; window.cancelAnimationFrame(showFrame); window.clearTimeout(showTimer); };
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
