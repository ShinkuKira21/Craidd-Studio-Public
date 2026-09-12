import { useEffect, useRef, useState } from "react";
import { usePreferences } from "../../store/preferencesStore";

interface Command {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prefs = usePreferences();

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const commands: Command[] = [
    { id: "view.wordWrap",   label: "View: Toggle Word Wrap",      shortcut: "Alt+Z",  run: prefs.toggleWordWrap },
    { id: "view.zoomIn",     label: "View: Zoom In",               shortcut: "Ctrl+=", run: prefs.zoomIn },
    { id: "view.zoomOut",    label: "View: Zoom Out",              shortcut: "Ctrl+-", run: prefs.zoomOut },
    { id: "view.resetZoom",  label: "View: Reset Zoom",            shortcut: "Ctrl+0", run: prefs.resetZoom },
    { id: "view.sidebar",    label: "View: Toggle Primary Sidebar",shortcut: "Ctrl+B", run: prefs.toggleSidebar },
    { id: "view.panel",      label: "View: Toggle Bottom Panel",   shortcut: "Ctrl+J", run: prefs.toggleBottomPanel },
    { id: "view.debug",      label: "View: Toggle Debug Panel",                        run: prefs.toggleRightPanel },
  ];

  const filtered = query.trim()
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-32 bg-black/40"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command…"
          className="w-full bg-zinc-900 text-zinc-100 px-4 py-3 text-sm outline-none border-b border-zinc-800 placeholder:text-zinc-600"
        />
        <div className="max-h-[400px] overflow-y-auto scroll-thin py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-xs text-zinc-500 italic">No matching commands</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => { c.run(); onClose(); }}
                className="w-full flex items-center justify-between px-4 py-1.5 text-left text-xs text-zinc-200 hover:bg-blue-700 hover:text-white"
              >
                <span>{c.label}</span>
                {c.shortcut && <span className="text-[10px] text-zinc-500">{c.shortcut}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
