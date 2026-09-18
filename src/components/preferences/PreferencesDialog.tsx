import { useEffect, useState } from "react";
import { usePreferences } from "../../store/preferencesStore";

interface ToolEntry { role: string; name: string; path: string; version: string }
interface ToolchainSnapshot {
  language: string;
  scanned: boolean;
  tools: ToolEntry[];
  defaults: Record<string, string>;
  preferencesPath: string;
}

const languages = ["rust", "typescript", "javascript", "cpp", "csharp", "python", "config"] as const;
const roles: Record<string, string[]> = {
  rust: ["build", "compiler", "manager", "debugger"],
  typescript: ["runtime", "package_manager"],
  javascript: ["runtime", "package_manager"],
  cpp: ["compiler", "build_system"],
  csharp: ["sdk"],
  python: ["runtime", "package_manager"],
  config: [],
};

export default function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePreferences();
  const [area, setArea] = useState<"editor" | "toolchains">("editor");
  const [language, setLanguage] = useState<string>("rust");
  const [snapshot, setSnapshot] = useState<ToolchainSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (area !== "toolchains") return;
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    import("@tauri-apps/api/core").then(({ invoke }) => invoke<ToolchainSnapshot>("get_toolchain", { language }))
      .then((value) => { if (!cancelled) setSnapshot(value); })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [area, language]);

  const scan = async () => {
    setBusy(true); setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setSnapshot(await invoke<ToolchainSnapshot>("scan_toolchain", { language }));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const setDefault = async (role: string, path: string | null) => {
    setBusy(true); setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setSnapshot(await invoke<ToolchainSnapshot>("set_tool_default", { language, role, path }));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const choosePath = async (role: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const path = await open({ multiple: false });
      if (typeof path === "string") await setDefault(role, path);
    } catch (err) { setError(String(err)); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[620px] max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          Preferences
        </div>
        <div className="px-4 pt-3 flex gap-2 text-xs">
          {(["editor", "toolchains"] as const).map((item) => (
            <button key={item} onClick={() => setArea(item)}
              className={"px-3 py-1.5 rounded " + (area === item ? "bg-blue-700 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white")}
            >{item === "editor" ? "Editor" : "Toolchains"}</button>
          ))}
        </div>
        {area === "editor" ? <div className="px-4 py-4 space-y-3 text-xs overflow-y-auto">
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
        </div> : <div className="px-4 py-4 space-y-4 text-xs overflow-y-auto">
          <div className="flex items-center gap-3">
            <label htmlFor="toolchain-language" className="text-zinc-400">Language</label>
            <select id="toolchain-language" value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200">
              {languages.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button onClick={() => void scan()} disabled={busy} className="ml-auto px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50">{busy ? "Scanning…" : "Rescan my system"}</button>
          </div>
          {snapshot && <div className="text-zinc-500">{snapshot.scanned ? `${snapshot.tools.length} tool(s) detected` : "Not yet scanned"}</div>}
          {roles[language].map((role) => {
            const found = snapshot?.tools.filter((tool) => tool.role === role) ?? [];
            const selected = snapshot?.defaults[role] ?? "";
            return <div key={role} className="border-t border-zinc-800 pt-3 space-y-1.5">
              <div className="capitalize text-zinc-300">{role.replace(/_/g, " ")}</div>
              <div className="flex gap-2">
                <select value={selected} disabled={busy || !snapshot}
                  onChange={(e) => void setDefault(role, e.target.value || null)}
                  className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200">
                  <option value="">Automatic{found[0] ? ` (${found[0].name})` : ""}</option>
                  {found.map((tool) => <option key={tool.path} value={tool.path}>{tool.name} — {tool.path}</option>)}
                  {selected && !found.some((tool) => tool.path === selected) && <option value={selected}>{selected} (custom or missing)</option>}
                </select>
                <button onClick={() => void choosePath(role)} disabled={busy} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">Choose Path…</button>
              </div>
              {found.length === 0 && snapshot?.scanned && <div className="text-amber-400">Not found</div>}
              {found.map((tool) => <div key={tool.path} className="text-zinc-500 truncate" title={tool.path}>{tool.name}: {tool.version}</div>)}
            </div>;
          })}
          {language === "config" && <div className="text-zinc-500">Config projects do not need a toolchain.</div>}
          {snapshot && <div className="border-t border-zinc-800 pt-3 text-zinc-600 break-all">Saved in {snapshot.preferencesPath}</div>}
          {error && <div className="text-red-400">{error}</div>}
        </div>}
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
