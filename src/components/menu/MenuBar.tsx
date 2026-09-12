import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../store/preferencesStore";
import { useSolution } from "../../store/solutionStore";

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: false;
}
interface MenuSeparator { separator: true; }
type MenuEntry = MenuItem | MenuSeparator;
interface Menu { label: string; items: MenuEntry[]; }

export default function MenuBar({ openCommandPalette }: { openCommandPalette: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const prefs = usePreferences();
  const openFolder = useSolution((s) => s.openFolder);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const doOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await openFolder(selected);
      }
    } catch (err) {
      console.error("[craidd] Open Folder failed:", err);
      alert("Failed to open folder. See console.");
    }
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New Solution…", shortcut: "Ctrl+Shift+N", disabled: true },
        { separator: true },
        { label: "Open Folder…", shortcut: "Ctrl+K Ctrl+O", action: doOpenFolder },
        { label: "Open Recent", disabled: true },
        { separator: true },
        { label: "Save", shortcut: "Ctrl+S", disabled: true },
        { label: "Save As…", shortcut: "Ctrl+Shift+S", disabled: true },
        { separator: true },
        { label: "Exit", shortcut: "Ctrl+Q", disabled: true },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", disabled: true },
        { label: "Redo", shortcut: "Ctrl+Y", disabled: true },
        { separator: true },
        { label: "Cut", shortcut: "Ctrl+X", disabled: true },
        { label: "Copy", shortcut: "Ctrl+C", disabled: true },
        { label: "Paste", shortcut: "Ctrl+V", disabled: true },
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
        { label: "Add New Project…", disabled: true },
        { label: "Add Project From Folder…", disabled: true },
        { separator: true },
        { label: "Project Properties…", disabled: true },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Start Debugging", shortcut: "F5", disabled: true },
        { label: "Run Without Debugging", shortcut: "Ctrl+F5", disabled: true },
        { label: "Stop", shortcut: "Shift+F5", disabled: true },
        { separator: true },
        { label: "Step Over", shortcut: "F10", disabled: true },
        { label: "Step Into", shortcut: "F11", disabled: true },
        { label: "Step Out", shortcut: "Shift+F11", disabled: true },
        { separator: true },
        { label: "Toggle Breakpoint", shortcut: "F9", disabled: true },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "About Craidd", action: () => alert("Craidd-Studio\nPhase 2.0 — Solutions & Projects\n\nA polyglot IDE.\nOne workspace. Many entrances.") },
      ],
    },
  ];

  const isDisabled = (item: MenuEntry): item is MenuItem =>
    "disabled" in item && !!item.disabled;
  const isSeparator = (item: MenuEntry): item is MenuSeparator =>
    "separator" in item && !!item.separator;

  return (
    <div
      ref={barRef}
      className="h-7 bg-zinc-900 border-b border-zinc-800 flex items-center px-2 text-xs shrink-0 select-none"
    >
      {menus.map((menu) => {
        const isOpen = openMenu === menu.label;
        return (
          <div key={menu.label} className="relative">
            <button
              onClick={() => setOpenMenu(isOpen ? null : menu.label)}
              onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
              className={
                "px-2.5 py-1 rounded transition-colors " +
                (isOpen ? "bg-zinc-800 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800")
              }
            >
              {menu.label}
            </button>
            {isOpen && (
              <div className="absolute top-full left-0 mt-0.5 min-w-[260px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 z-50">
                {menu.items.map((item, i) => {
                  if (isSeparator(item)) {
                    return <div key={i} className="my-1 h-px bg-zinc-800" />;
                  }
                  const disabled = isDisabled(item);
                  return (
                    <button
                      key={i}
                      disabled={disabled}
                      onClick={() => {
                        if (!disabled && item.action) {
                          item.action();
                          setOpenMenu(null);
                        }
                      }}
                      className={
                        "w-full flex items-center justify-between gap-8 px-3 py-1 text-left transition-colors " +
                        (disabled
                          ? "text-zinc-600 cursor-default"
                          : "text-zinc-200 hover:bg-blue-700 hover:text-white")
                      }
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className={"text-[10px] " + (disabled ? "text-zinc-700" : "text-zinc-500")}>
                          {item.shortcut}
                        </span>
                      )}
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
