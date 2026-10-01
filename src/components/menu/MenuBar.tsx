import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../store/preferencesStore";
import { useSolution } from "../../store/solutionStore";
import { saveActiveFile, saveActiveFileAs } from "../../lib/fileActions";
import { choicesForConfig, useBuild } from "../../store/buildStore";
import { startViewedAction, stopViewedAction } from "../../lib/viewedActions";
import { useDebug } from "../../store/debugStore";
import { useLinkedWindows } from "../../store/linkedWindowsStore";

interface MenuItem { label: string; shortcut?: string; action?: () => void; disabled?: boolean; submenu?: MenuItem[]; }
interface MenuSeparator { separator: true; }
type MenuEntry = MenuItem | MenuSeparator;
interface Menu { label: string; items: MenuEntry[]; }

export default function MenuBar({ openCommandPalette, openPreferences }: { openCommandPalette: () => void; openPreferences: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const prefs = usePreferences();
  const activeFileId = useSolution((s) => s.activeFileId);
  const clnPath = useSolution((s) => s.clnPath);
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
    : ["starting", "building", "running", "paused"].includes(buildStatus) || ["building", "running", "paused"].includes(debugStatus);
  const canRun = (kind: "build" | "run" | "debug") => Boolean(viewed ? remoteChoices?.[kind] : mainChoices[kind]);
  const runViewed = (kind: "build" | "run" | "debug") => void startViewedAction(kind)
    .catch((error) => alert(`${kind} failed: ${String(error)}`));
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
      await invoke("open_workspace_window", { entry: {
        path: clnPath, kind: "solution", name: clnPath.split("/").filter(Boolean).pop() ?? clnPath,
        windowLabel: "", selectedConfigName: viewed?.selectedConfigName ?? selectedConfigName,
        selectedProfileName: viewed?.selectedProfileName ?? selectedProfileName,
      } });
    } catch (error) { alert(`Could not duplicate window: ${String(error)}`); }
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

  const doOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_workspace_window", { entry: {
        path: selected, kind: "folder", name: selected.split("/").filter(Boolean).pop() ?? selected, windowLabel: "",
      } });
    } catch (err) {
      console.error("[craidd] Open Folder failed:", err);
      alert(`Could not open folder: ${String(err)}`);
    }
  };

  const doOpenSolution = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Craidd Solution", extensions: ["cln"] }],
      });
      if (typeof selected !== "string") return;
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_workspace_window", { entry: {
        path: selected, kind: "solution", name: selected.split("/").filter(Boolean).pop() ?? selected, windowLabel: "",
      } });
    } catch (err) {
      console.error("[craidd] Open Solution failed:", err);
      alert(`Could not open solution: ${String(err)}`);
    }
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New Solution…", shortcut: "Ctrl+Shift+N", disabled: true },
        { label: "Open Folder…", shortcut: "Ctrl+K Ctrl+O", action: doOpenFolder },
        { label: "Open Solution…", shortcut: "Ctrl+Shift+O", action: doOpenSolution },
        { label: "Open Recent…", action: openWelcome },
        { label: "Get Started…", action: openWelcome },
        { label: "Duplicate Window", disabled: !clnPath, action: () => void duplicateWindow() },
        { separator: true },
        { label: "Save", shortcut: "Ctrl+S", disabled: !activeFileId || (!!viewed && !remoteEditing), action: () => runSave(saveActiveFile) },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", disabled: !activeFileId || (!!viewed && !remoteEditing), action: () => runSave(saveActiveFileAs) },
        { separator: true },
        { label: "Preferences…", shortcut: "Ctrl+,", action: openPreferences },
        { separator: true },
        { label: "Exit", submenu: [
          { label: "This Window", shortcut: "Ctrl+Q", action: () => exitScope("window") },
          { label: "This Solution", shortcut: "Ctrl+Shift+Q", disabled: !clnPath, action: () => exitScope("solution") },
          { label: "This Application", shortcut: "Ctrl+Alt+Q", action: () => exitScope("ide") },
        ] },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", disabled: true },
        { label: "Redo", shortcut: "Ctrl+Y", disabled: true },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette…", shortcut: "Ctrl+Shift+P", action: openCommandPalette },
        { separator: true },
        { label: "Toggle Solution Sidebar", shortcut: "Ctrl+B", action: prefs.toggleSidebar },
        { label: "Toggle Panel", shortcut: "Ctrl+J", action: prefs.toggleBottomPanel },
        { label: "Toggle Debug Panel", action: prefs.toggleRightPanel },
        { separator: true },
        { label: "Toggle Word Wrap", shortcut: "Alt+Z", action: prefs.toggleWordWrap },
        { separator: true },
        { label: "Zoom In", shortcut: "Ctrl+=", action: prefs.zoomIn },
        { label: "Zoom Out", shortcut: "Ctrl+-", action: prefs.zoomOut },
        { label: "Reset Zoom", shortcut: "Ctrl+0", action: prefs.resetZoom },
      ],
    },
    {
      label: "Project",
      items: [
        { label: "Add → New Blank Project…", disabled: true },
        { label: "Add → Existing Project…", disabled: true },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Build", shortcut: "Ctrl+Shift+B", action: () => runViewed("build"), disabled: !canRun("build") || busy },
        { label: "Run Without Debugging", shortcut: "Ctrl+F5", action: () => runViewed("run"), disabled: !canRun("run") || busy },
        { label: "Start Debugging", shortcut: "F5", action: () => runViewed("debug"), disabled: !canRun("debug") || busy },
        { label: "Stop", shortcut: "Shift+F5", action: stopViewed, disabled: !busy },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About Craidd", action: () => alert("Craidd-Studio\nPhase 2.0.6.1\n\nA polyglot IDE.\nOne workspace. Many entrances.") },
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
    </div>
  );
}
