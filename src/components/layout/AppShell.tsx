import { useEffect, useState } from "react";
import MenuBar from "../menu/MenuBar";
import Toolbar from "./Toolbar";
import StatusBar from "./StatusBar";
import ActivityBar from "./ActivityBar";
import Sidebar from "../sidebar/Sidebar";
import EditorPane from "../editor/EditorPane";
import DebugSidebar from "../panels/DebugSidebar";
import BottomPanel from "../panels/BottomPanel";
import ResizeHandle from "./ResizeHandle";
import CommandPalette from "../command-palette/CommandPalette";
import AncestorSolutionDialog from "../dialogs/AncestorSolutionDialog";
import PreferencesDialog from "../preferences/PreferencesDialog";
import DeletedFileDialog from "../dialogs/DeletedFileDialog";
import SaveConflictDialog from "../dialogs/SaveConflictDialog";
import CriticalWorkspaceBanner from "./CriticalWorkspaceBanner";
import EnvironmentNotice from "./EnvironmentNotice";
import NewProjectDialog from "../dialogs/NewProjectDialog";
import { usePreferences } from "../../store/preferencesStore";
import { useLayout } from "../../store/layoutStore";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useSolution } from "../../store/solutionStore";
import { useBuild } from "../../store/buildStore";
import { listenToLinkedWindows, publishLinkedWindow, useLinkedWindows } from "../../store/linkedWindowsStore";
import { listenForBreakpointFocus } from "../../lib/breakpointFocus";
import { RemoteEditorPane, RemoteOutputPanel } from "./RemoteContext";
import { listenForBreakpointChanges, useBreakpoints } from "../../store/breakpointStore";
import { listenToDebug, useDebug } from "../../store/debugStore";

interface ProjectToolchainCheck {
  language: string;
  missing: string[];
  newlyFound: boolean;
  debuggerMissing: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = {
  rust: "Rust", typescript: "TypeScript", javascript: "JavaScript",
  cpp: "C++", csharp: "C#", python: "Python",
};

export default function AppShell({ startProjectDialog = false, onCloseStartProjectDialog }: { startProjectDialog?: boolean; onCloseStartProjectDialog?: () => void }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsArea, setPrefsArea] = useState<"editor" | "toolchains">("editor");
  const [prefsLanguage, setPrefsLanguage] = useState("rust");
  const [toolchainChecks, setToolchainChecks] = useState<ProjectToolchainCheck[]>([]);
  const [toolchainError, setToolchainError] = useState<string | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [issuesDismissed, setIssuesDismissed] = useState(false);
  const [debugDismissed, setDebugDismissed] = useState(false);
  const [debugDetailsOpen, setDebugDetailsOpen] = useState(false);
  const pendingSave = useSolution((s) => s.pendingSave);
  const setPendingSave = useSolution((s) => s.setPendingSave);
  const rootPath = useSolution((s) => s.rootPath);
  const clnPath = useSolution((s) => s.clnPath);
  const hasSolution = useSolution((s) => !!s.solution);
  const solution = useSolution((s) => s.solution);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const selectedProfileName = useBuild((s) => s.selectedProfileName);
  const mainChoices = useBuild((s) => s.mainChoices);
  const buildStatus = useBuild((s) => s.status);
  const debugStatus = useDebug((s) => s.status);
  const ownInstanceId = useLinkedWindows((s) => s.ownInstanceId);
  const buildProblems = useBuild((s) => s.problems);
  const remoteContext = useLinkedWindows((state) => state.windows.find((item) => item.windowLabel === state.viewedWindowLabel && item.windowLabel !== state.ownWindowLabel));
  const bannerState = useSolution((s) => s.bannerState);
  const isSolutionLoading = useSolution((s) => s.isSolutionLoading);
  const projectLanguages = [...new Set((solution?.projects ?? [])
    .filter((project) => !project.missing && project.language && project.language !== "config")
    .map((project) => project.language!))].sort().join(",");
  const savedConfig = [...(solution?.inferredConfigs ?? []), ...(solution?.configs ?? [])]
    .find((config) => config.name === selectedConfigName);
  const savedProject = solution?.projects.find((project) => project.path === savedConfig?.target);
  const selectionName = savedConfig?.bestFit ? savedConfig.name : savedProject?.name ?? savedConfig?.name ?? null;
  const missingChecks = toolchainChecks.filter((check) => check.missing.length > 0);
  const rustDebugConfigured = Boolean(solution && [...(solution.configs ?? []), ...(solution.inferredConfigs ?? [])]
    .some((config) => config.kind === "debug" && config.method === "cargo"
      && (config.target === "." || solution.projects.some((project) => project.language === "rust" && project.path === config.target))));
  const debuggerMissing = rustDebugConfigured && toolchainChecks.some((check) => check.language === "rust" && check.debuggerMissing);
  const openPreferences = (area: "editor" | "toolchains" = "editor", language = "rust") => {
    setPrefsArea(area);
    setPrefsLanguage(language);
    setPrefsOpen(true);
  };
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToLinkedWindows().then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    }).catch((error) => console.error("[craidd] Linked window listener failed:", error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToDebug().then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch((error) => console.error("[craidd] Debug listener failed:", error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForBreakpointChanges().then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    }).catch((error) => console.error("[craidd] Breakpoint listener failed:", error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    void useBreakpoints.getState().load(clnPath)
      .catch((error) => console.error("[craidd] Could not load breakpoints:", error));
  }, [clnPath]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForBreakpointFocus().then((cleanup) => {
      if (disposed) cleanup(); else unlisten = cleanup;
    }).catch((error) => console.error("[craidd] Breakpoint focus listener failed:", error));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    void publishLinkedWindow(solution, clnPath)
      .catch((error) => console.error("[craidd] Could not update linked window:", error));
  }, [solution, clnPath, selectedConfigName, mainChoices, buildStatus, debugStatus]);

  useEffect(() => {
    if (!clnPath) return;
    const timer = window.setTimeout(() => {
      void publishLinkedWindow(solution, clnPath)
        .catch((error) => console.error("[craidd] Could not share build problems:", error));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [buildProblems]);
  useEffect(() => {
    let timer: number | undefined;
    const publish = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const state = useSolution.getState();
        void publishLinkedWindow(state.solution, state.clnPath)
          .catch((error) => console.error("[craidd] Could not share window context:", error));
      }, 180);
    };
    let previousFile = "";
    const unlistenSolution = useSolution.subscribe((state) => {
      const tab = state.tabs.find((item) => item.fileId === state.activeFileId);
      const key = `${state.activeFileId ?? ""}\0${tab?.content ?? ""}\0${state.tabs.map((item) => `${item.fileId}:${item.dirty}`).join("|")}`;
      if (key !== previousFile) { previousFile = key; publish(); }
    });
    let previousOutput = "";
    const unlistenBuild = useBuild.subscribe((state) => {
      const key = `${state.selectedProfileName ?? ""}\0${state.output}`;
      if (key !== previousOutput) { previousOutput = key; publish(); }
    });
    const unlistenDebug = useDebug.subscribe((state, previous) => {
      if (state.output !== previous.output || state.status !== previous.status ||
        state.file !== previous.file || state.line !== previous.line ||
        state.frames !== previous.frames || state.variables !== previous.variables) publish();
    });
    return () => { window.clearTimeout(timer); unlistenSolution(); unlistenBuild(); unlistenDebug(); };
  }, []);
  useKeyboardShortcuts(
    () => setPaletteOpen(true),
    () => openPreferences(),
  );

  useEffect(() => {
    let cancelled = false;
    setToolchainChecks([]);
    setToolchainError(null);
    setSuccessVisible(false);
    setIssuesDismissed(false);
    setDebugDismissed(false);
    setDebugDetailsOpen(false);
    if (isSolutionLoading || !solution || !projectLanguages) return;
    const languages = projectLanguages.split(",");
    const api = import("@tauri-apps/api/core");
    for (const language of languages) {
      void api.then(({ invoke }) =>
        invoke<ProjectToolchainCheck>("ensure_project_toolchain", { language })
      ).then((check) => {
        if (cancelled) return;
        setToolchainChecks((previous) => [...previous.filter((item) => item.language !== language), check]);
        if (check.newlyFound) setSuccessVisible(true);
        if (check.missing.length > 0) setIssuesDismissed(false);
        if (check.debuggerMissing) setDebugDismissed(false);
        window.dispatchEvent(new CustomEvent("craidd:toolchains-checked", { detail: [language] }));
      }).catch((error) => {
        if (!cancelled) setToolchainError(`${LANGUAGE_LABELS[language] ?? language}: ${String(error)}`);
      });
    }
    return () => { cancelled = true; };
  }, [rootPath, projectLanguages, isSolutionLoading]);

  useEffect(() => {
    if (!successVisible) return;
    const timer = window.setTimeout(() => setSuccessVisible(false), 7000);
    return () => window.clearTimeout(timer);
  }, [successVisible, toolchainChecks]);

  useEffect(() => {
    if (isSolutionLoading || !rootPath) return;
    const kind = hasSolution && clnPath ? "solution" :
      !hasSolution && (bannerState === "no-solution" || bannerState === "inside-parent") ? "folder" : null;
    if (!kind) return;
    const path = kind === "solution" ? clnPath! : rootPath;
    const timer = window.setTimeout(() => {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("record_workspace_open", {
          path, kind, selectedConfigName, selectedProfileName, selectionName, instanceId: ownInstanceId,
        })
      ).catch((error) => console.error("[craidd] Could not record recent workspace:", error));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [rootPath, clnPath, hasSolution, bannerState, isSolutionLoading, selectedConfigName, selectedProfileName, selectionName, ownInstanceId]);

  // Refresh disk state for all open tabs whenever the window regains focus.
  useEffect(() => {
    const onFocus = () => {
      void useSolution.getState().refreshDiskStates();
      void useSolution.getState().refreshProjectMarkers();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const sidebarVisible = usePreferences((s) => s.sidebarVisible);
  const bottomPanelVisible = usePreferences((s) => s.bottomPanelVisible);
  const rightPanelVisible = usePreferences((s) => s.rightPanelVisible);

  const sidebarWidth = useLayout((s) => s.sidebarWidth);
  const setSidebarWidth = useLayout((s) => s.setSidebarWidth);
  const rightPanelWidth = useLayout((s) => s.rightPanelWidth);
  const setRightPanelWidth = useLayout((s) => s.setRightPanelWidth);
  const bottomPanelHeight = useLayout((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useLayout((s) => s.setBottomPanelHeight);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-300 text-[13px] overflow-hidden">
      <MenuBar openCommandPalette={() => setPaletteOpen(true)} openPreferences={() => openPreferences()} />
      <Toolbar />
      {successVisible && (
        <EnvironmentNotice tone="info" title="Toolchain found" action="Inspect here"
          onAction={() => { setSuccessVisible(false); openPreferences("toolchains", toolchainChecks.find((check) => check.newlyFound)?.language ?? "rust"); }}
          onDismiss={() => setSuccessVisible(false)}>
          Found a toolchain for your project(s). This notice closes automatically.
        </EnvironmentNotice>
      )}
      {!issuesDismissed && (missingChecks.length > 0 || toolchainError) && (
        <EnvironmentNotice tone="danger" title="Tools missing" action="Inspect tools"
          onAction={() => { setIssuesDismissed(true); openPreferences("toolchains", missingChecks[0]?.language ?? "rust"); }}
          onDismiss={() => setIssuesDismissed(true)}>
          {missingChecks.map((check) => `${LANGUAGE_LABELS[check.language] ?? check.language}: ${check.missing.join(", ")}`).join(" · ")}
          {toolchainError && <span className="block">Detection failed: {toolchainError}</span>}
        </EnvironmentNotice>
      )}
      {!debugDismissed && debuggerMissing && (
        <EnvironmentNotice tone="warning" title="Rust debugger not detected" action="Learn more"
          onAction={() => setDebugDetailsOpen((open) => !open)} onDismiss={() => setDebugDismissed(true)}>
          lldb-dap is missing for this Rust debug configuration.
          {debugDetailsOpen && <span className="block mt-1">Install lldb-dap, then rescan Rust tools in File → Preferences → Toolchain. Craidd uses it for breakpoints, stepping, stack frames, and variables.</span>}
        </EnvironmentNotice>
      )}

      <div className="flex-1 flex min-h-0">
        <ActivityBar />
        {sidebarVisible && (
          <>
            <div style={{ width: sidebarWidth }} className="h-full shrink-0"><Sidebar /></div>
            <ResizeHandle orientation="vertical" onDrag={(delta) => setSidebarWidth(sidebarWidth + delta)} />
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {remoteContext ? <RemoteEditorPane context={remoteContext} /> : <EditorPane />}
          {bottomPanelVisible && (
            <>
              <ResizeHandle orientation="horizontal" onDrag={(delta) => setBottomPanelHeight(bottomPanelHeight - delta)} />
              <div style={{ height: bottomPanelHeight }} className="shrink-0">{remoteContext ? <RemoteOutputPanel context={remoteContext} /> : <BottomPanel />}</div>
            </>
          )}
        </div>

        {rightPanelVisible && (
          <>
            <ResizeHandle orientation="vertical" onDrag={(delta) => setRightPanelWidth(rightPanelWidth - delta)} />
            <div style={{ width: rightPanelWidth }} className="h-full shrink-0"><DebugSidebar /></div>
          </>
        )}
      </div>

      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AncestorSolutionDialog />
      {prefsOpen && <PreferencesDialog initialArea={prefsArea} initialLanguage={prefsLanguage} onClose={() => setPrefsOpen(false)} />}
      {pendingSave?.kind === "deleted" && (
        <DeletedFileDialog
          fileId={pendingSave.fileId}
          onClose={() => setPendingSave(null)}
        />
      )}
      {pendingSave?.kind === "newer" && (
        <SaveConflictDialog
          fileId={pendingSave.fileId}
          onClose={() => setPendingSave(null)}
        />
      )}
      <CriticalWorkspaceBanner />
      {startProjectDialog && <NewProjectDialog onClose={(options) => {
        onCloseStartProjectDialog?.();
        if (options?.fineTuneAfter && options.projectName) {
          const project = useSolution.getState().solution?.projects.find((item) => item.name === options.projectName);
          if (project) window.dispatchEvent(new CustomEvent("craidd:fine-tune-project", { detail: project.id }));
        }
      }} />}
    </div>
  );
}
