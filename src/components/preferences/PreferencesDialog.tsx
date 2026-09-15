import { usePreferences } from "../../store/preferencesStore";

export default function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePreferences();

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          Preferences
        </div>
        <div className="px-4 py-4 space-y-3 text-xs">
          <div className="text-zinc-500">Editor</div>

          <label className="flex items-center justify-between">
            <span className="text-zinc-400">Font size</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={8}
                max={24}
                step={0.5}
                value={prefs.fontSize}
                onChange={(e) => prefs.setFontSize(Number(e.target.value))}
                className="w-40 accent-blue-500"
              />
              <span className="text-zinc-300 w-10 text-right">{prefs.fontSize}px</span>
            </div>
          </label>

          <label className="flex items-center justify-between">
            <span className="text-zinc-400">Tab size</span>
            <select
              value={prefs.tabSize}
              onChange={(e) => prefs.setTabSize(Number(e.target.value))}
              className="rounded px-2 py-1 outline-none"
            >
              {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label className="flex items-center justify-between">
            <span className="text-zinc-400">Word wrap</span>
            <input
              type="checkbox"
              checked={prefs.wordWrap}
              onChange={prefs.toggleWordWrap}
              className="accent-blue-500"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-zinc-400">Theme</span>
            <select
              value={prefs.theme}
              onChange={(e) => prefs.setTheme(e.target.value as "vs-dark" | "vs-light")}
              className="rounded px-2 py-1 outline-none"
            >
              <option value="vs-dark">Dark</option>
              <option value="vs-light">Light</option>
            </select>
          </label>
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
