import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../store/preferencesStore";
import { useSolution } from "../../store/solutionStore";
import { saveActiveFile, saveActiveFileAs } from "../../lib/fileActions";
import { choicesForConfig, useBuild } from "../../store/buildStore";
import { debugKeyViewed, debugOrContinueViewed, startViewedAction, stopViewedAction } from "../../lib/viewedActions";
import { useDebug } from "../../store/debugStore";
import { useLinkedWindows, waitForLinkedWindowSession } from "../../store/linkedWindowsStore";
import type { LinkedMember } from "../../store/linkedWindowsStore";
import { shouldShowDuplicate } from "../../lib/duplicateWindowPolicy";
import { openFolderDialog, openSolutionDialog } from "../../lib/workspaceActions";
import { shortcutLabel as key } from "../../lib/shortcuts";
import { triggerEditorCommand } from "../../lib/activeEditor";
import { useLayout } from "../../store/layoutStore";
import AboutDialog from "../dialogs/AboutDialog";

interface MenuItem { label: string; shortcut?: string; action?: () => void; disabled?: boolean; submenu?: MenuItem[]; }
interface MenuSeparator { separator: true; }
type MenuEntry = MenuItem | MenuSeparator;
interface Menu { label: string; items: MenuEntry[]; }

export default function MenuBar({ openCommandPalette, openPreferences }: { openCommandPalette: () => void; openPreferences: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const prefs = usePreferences();
  const activeFileId = useSolution((s) => s.activeFileId);
  const clnPath = useSolution((s) => s.clnPath);
  const rootPath = useSolution((s) => s.rootPath);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const solution = useSolution((s) => s.solution);
  const selectedProfileName = useBuild((s) => s.selectedProfileName);
  const buildStatus = useBuild((s) => s.status);
  const mainChoices = useBuild((s) => s.mainChoices);
  const debugStatus = useDebug((s) => s.status);
  const viewed = useLinkedWindows((s) => s.windows.find((item) => item.windowLabel === s.viewedWindowLabel && item.windowLabel !== s.ownWindowLabel));
  const remoteEditing = useLinkedWindows((s) => s.remoteEditing);
  const remoteConfig = solution && viewed ? [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])]
    .find((item) => item.name === viewed.selectedConfigName) : null;
  const remoteChoices = remoteConfig && solution ? choicesForConfig(solution, remoteConfig) : null;
  const busy = viewed ? ["starting", "building", "running", "paused"].includes(viewed.status)
    : ["starting", "building", "running", "paused"].includes(buildStatus) || ["building", "starting", "running", "paused"].includes(debugStatus);
  const canRun = (kind: "build" | "run" | "debug") => Boolean(viewed ? remoteChoices?.[kind] : mainChoices[kind]);
  const runViewed = (kind: "build" | "run" | "debug") => void startViewedAction(kind)
    .catch((error) => alert(`${kind} failed: ${String(error)}`));
  const debugState = viewed && !viewed.visible ? viewed.status : debugStatus;
  const paused = debugState === "paused";
  const debugKey = (action: () => Promise<void>) => () => void action().catch((error) => alert(`Debug failed: ${String(error)}`));
  const stopViewed = () => void stopViewedAction().catch((error) => alert(`Stop failed: ${String(error)}`));
  const runSave = (action: () => Promise<void>) => {
    void action().catch((err) => alert(`Save failed: ${String(err)}`));
  };
  const openWelcome = () => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("open_welcome_window"))
      .catch((error) => alert(`Could not open Get Started: ${String(error)}`));
  };
  const duplicateWindow = async () => {
    if (!clnPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { duplicateWindowMode, duplicateWindowLimit } = usePreferences.getState();
      const visibleCount = duplicateWindowMode === "limit"
        ? (await invoke<LinkedMember[]>("get_application_windows")).filter((item) => item.visible).length
        : 0;
      const show = shouldShowDuplicate(duplicateWindowMode, visibleCount, duplicateWindowLimit);
      const label = await invoke<string>("open_workspace_window", { entry: {
        path: clnPath, kind: "solution", name: clnPath.split("/").filter(Boolean).pop() ?? clnPath,
        windowLabel: "", selectedConfigName: viewed?.selectedConfigName ?? selectedConfigName,
        selectedProfileName: viewed?.selectedProfileName ?? selectedProfileName,
        startHidden: !show,
      } });
      if (!show) {
        await waitForLinkedWindowSession(label);
        await useLinkedWindows.getState().selectWindow(label);
      }
    } catch (error) { alert(`Could not duplicate window: ${String(error)}`); }
  };
  // The dialog lives in the Solution Explorer, which owns the Fine Tune
  // follow-up, so make sure it is mounted before asking it to open.
  const openNewProject = () => {
    if (!usePreferences.getState().sidebarVisible) usePreferences.getState().toggleSidebar();
    useLayout.getState().setActiveView("solution");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("craidd:new-project")), 0);
  };
  const exitScope = (scope: "window" | "solution" | "ide") =>
    window.dispatchEvent(new CustomEvent("craidd:exit-scope", { detail: scope }));

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const doOpenFolder = () => void openFolderDialog().catch((err) => {
    console.error("[craidd] Open Folder failed:", err);
    alert(`Could not open folder: ${String(err)}`);
  });
  const doOpenSolution = () => void openSolutionDialog().catch((err) => {
    console.error("[craidd] Open Solution failed:", err);
    alert(`Could not open solution: ${String(err)}`);
  });

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New Solution… (Coming soon)", disabled: true },
        { label: "Open Folder…", shortcut: key("openFolder"), action: doOpenFolder },
        { label: "Open Solution…", shortcut: key("openSolution"), action: doOpenSolution },
        { label: "Open Recent…", action: openWelcome },
        { label: "Get Started…", action: openWelcome },
        { label: "Duplicate Window", disabled: !clnPath, action: () => void duplicateWindow() },
        { separator: true },
        { label: "Save", shortcut: key("save"), disabled: !activeFileId || (!!viewed && !remoteEditing), action: () => runSave(saveActiveFile) },
        { label: "Save As…", shortcut: key("saveAs"), disabled: !activeFileId || (!!viewed && !remoteEditing), action: () => runSave(saveActiveFileAs) },
        { separator: true },
        { label: "Preferences…", shortcut: key("preferences"), action: openPreferences },
        { separator: true },
        { label: "Exit", submenu: [
          { label: "This Window", shortcut: key("exitWindow"), action: () => exitScope("window") },
          { label: "This Solution", shortcut: key("exitSolution"), disabled: !clnPath, action: () => exitScope("solution") },
          { label: "This Application", shortcut: key("exitIde"), action: () => exitScope("ide") },
        ] },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: key("undo"), disabled: !activeFileId, action: () => triggerEditorCommand("undo") },
        { label: "Redo", shortcut: key("redo"), disabled: !activeFileId, action: () => triggerEditorCommand("redo") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette…", shortcut: key("commandPalette"), action: openCommandPalette },
        { separator: true },
        { label: "Toggle Solution Sidebar", shortcut: key("toggleSidebar"), action: prefs.toggleSidebar },
        { label: "Toggle Panel", shortcut: key("togglePanel"), action: prefs.toggleBottomPanel },
        { label: "Toggle Debugger & Profiler Panel", action: prefs.toggleRightPanel },
        { separator: true },
        { label: "Toggle Word Wrap", shortcut: key("wordWrap"), action: prefs.toggleWordWrap },
        { separator: true },
        { label: "Zoom In", shortcut: key("zoomIn"), action: prefs.zoomIn },
        { label: "Zoom Out", shortcut: key("zoomOut"), action: prefs.zoomOut },
        { label: "Reset Zoom", shortcut: key("resetZoom"), action: prefs.resetZoom },
      ],
    },
    {
      label: "Project",
      items: [
        { label: "Add → New Blank Project…", disabled: !rootPath, action: openNewProject },
        { label: "Add → Existing Project… (Coming soon)", disabled: true },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Build", shortcut: key("build"), action: () => runViewed("build"), disabled: !canRun("build") || busy },
        { label: "Run Without Debugging", shortcut: key("run"), action: () => runViewed("run"), disabled: !canRun("run") || busy },
        { label: paused ? "Continue" : "Start Debugging", shortcut: key("debugOrContinue"), action: debugKey(debugOrContinueViewed), disabled: paused ? false : !canRun("debug") || busy },
        { label: "Stop", shortcut: key("stop"), action: stopViewed, disabled: !busy },
        { separator: true },
        { label: "Pause", shortcut: key("pause"), action: debugKey(() => debugKeyViewed("pause")), disabled: debugState !== "running" },
        { label: "Step Over", shortcut: key("stepOver"), action: debugKey(() => debugKeyViewed("stepOver")), disabled: !paused },
        { label: "Step Into", shortcut: key("stepInto"), action: debugKey(() => debugKeyViewed("stepInto")), disabled: !paused },
        { label: "Step Out", shortcut: key("stepOut"), action: debugKey(() => debugKeyViewed("stepOut")), disabled: !paused },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About Craidd Studio", action: () => setAboutOpen(true) },
      ],
    },
  ];

  const isDisabled = (item: MenuEntry): item is MenuItem => "disabled" in item && !!item.disabled;
  const isSeparator = (item: MenuEntry): item is MenuSeparator => "separator" in item && !!item.separator;

  return (
    <div ref={barRef} className="h-7 bg-zinc-900 border-b border-zinc-800 flex items-center px-2 text-xs shrink-0 select-none">
      {menus.map((menu) => {
        const isOpen = openMenu === menu.label;
        return (
          <div key={menu.label} className="relative">
            <button
              onClick={() => { setOpenMenu(isOpen ? null : menu.label); setOpenSubmenu(null); }}
              onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
              className={"px-2.5 py-1 rounded transition-colors " + (isOpen ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800")}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="absolute top-full left-0 mt-0.5 min-w-[260px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 z-50">
                {menu.items.map((item, i) => {
                  if (isSeparator(item)) return <div key={i} className="my-1 h-px bg-zinc-800" />;
                  if (item.submenu) return <div key={i} className="relative"
                    onMouseEnter={() => setOpenSubmenu(item.label)} onMouseLeave={() => setOpenSubmenu(null)}>
                    <button type="button" onClick={() => setOpenSubmenu(openSubmenu === item.label ? null : item.label)}
                      className="w-full flex items-center justify-between gap-8 px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white">
                      <span>{item.label}</span><span aria-hidden="true">▸</span>
                    </button>
                    {openSubmenu === item.label && <div className="absolute left-full top-0 min-w-[260px] rounded border border-zinc-700 bg-zinc-900 shadow-2xl py-1 z-[60]">
                      {item.submenu.map((child) => <button key={child.label} type="button" disabled={child.disabled}
                        onClick={() => { child.action?.(); setOpenSubmenu(null); setOpenMenu(null); }}
                        className={"w-full flex items-center justify-between gap-8 px-3 py-1 text-left " +
                          (child.disabled ? "text-zinc-600 cursor-default" : "text-zinc-200 hover:bg-blue-700 hover:text-white")}>
                        <span>{child.label}</span><span className="text-[10px] text-zinc-500">{child.shortcut}</span>
                      </button>)}
                    </div>}
                  </div>;
                  const disabled = isDisabled(item);
                  return (
                    <button
                      key={i}
                      disabled={disabled}
                      onClick={() => { const it = item as MenuItem; if (!disabled && it.action) { it.action(); setOpenMenu(null); } }}
                      className={
                        "w-full flex items-center justify-between gap-8 px-3 py-1 text-left transition-colors " +
                        (disabled ? "text-zinc-600 cursor-default" : "text-zinc-200 hover:bg-blue-700 hover:text-white")
                      }
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className={"text-[10px] " + (disabled ? "text-zinc-700" : "text-zinc-500")}>{item.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}
