import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePreferences } from "../../store/preferencesStore";
import type { EditorTheme, IdeTheme } from "../../store/preferencesStore";

interface ThemeChoice<T extends string> {
  value: T;
  label: string;
  detail: string;
  background: string;
  panel: string;
  foreground: string;
  accent: string;
}

const editorThemes: ThemeChoice<EditorTheme>[] = [
  { value: "craidd-dark", label: "Dark", detail: "Craidd's original dark editor", background: "#0e1117", panel: "#171b23", foreground: "#d4dbe5", accent: "#80bcff" },
  { value: "vs-dark", label: "Traditional", detail: "Familiar VS Code-style editor", background: "#1e1e1e", panel: "#252526", foreground: "#d4d4d4", accent: "#569cd6" },
  { value: "vs-light", label: "Light", detail: "Bright editor canvas", background: "#ffffff", panel: "#f4f5f7", foreground: "#344255", accent: "#176eaf" },
];

const ideThemes: ThemeChoice<IdeTheme>[] = [
  { value: "craidd-dark", label: "Craidd Dark", detail: "Current high-contrast workspace", background: "#0e1117", panel: "#171b23", foreground: "#d4dbe5", accent: "#429eed" },
  { value: "classic-dark", label: "Classic Dark", detail: "Softer charcoal workspace", background: "#1e1e1e", panel: "#252526", foreground: "#d4d4d4", accent: "#429eed" },
  { value: "light", label: "Light", detail: "Bright workspace and dialogs", background: "#ffffff", panel: "#f4f5f7", foreground: "#253346", accent: "#176eaf" },
];

function ThemeCard<T extends string>({ choice, selected, onSelect }: { choice: ThemeChoice<T>; selected: boolean; onSelect: (value: T) => void }) {
  return <button type="button" onClick={() => onSelect(choice.value)} aria-pressed={selected}
    className={"rounded-md border p-2.5 text-left min-w-0 transition-colors focus-visible:outline-2 focus-visible:outline-blue-400 " +
      (selected ? "border-blue-500 ring-1 ring-blue-500/40" : "border-zinc-700 hover:border-zinc-500")}>
    <span className="h-12 rounded border border-zinc-700/50 flex overflow-hidden mb-2" style={{ backgroundColor: choice.background }}>
      <span className="w-5 shrink-0" style={{ backgroundColor: choice.panel }} />
      <span className="flex-1 px-2 py-1 font-mono text-[10px]" style={{ color: choice.foreground }}>
        <span style={{ color: choice.accent }}>Aa</span> 01<br />const theme
      </span>
    </span>
    <span className="block text-xs font-medium text-zinc-100">{choice.label}{selected && <span className="text-blue-400 ml-1">✓</span>}</span>
    <span className="block text-[10.5px] text-zinc-500 mt-0.5 leading-snug">{choice.detail}</span>
  </button>;
}

interface ToolEntry { role: string; name: string; path: string; version: string }
interface ToolchainSnapshot {
  language: string;
  scanned: boolean;
  tools: ToolEntry[];
  defaults: Record<string, string>;
  preferencesPath: string;
}

const languages = ["rust", "typescript", "javascript", "cpp", "csharp", "python", "config"] as const;
const languageLabels: Record<string, string> = {
  rust: "Rust", typescript: "TypeScript", javascript: "JavaScript", cpp: "C++",
  csharp: "C#", python: "Python", config: "Config",
};
const roles: Record<string, string[]> = {
  rust: ["build", "compiler", "manager", "debugger"],
  typescript: ["runtime", "package_manager"],
  javascript: ["runtime", "package_manager"],
  cpp: ["compiler", "build_system", "debugger"],
  csharp: ["sdk", "debugger"],
  python: ["runtime", "package_manager"],
  config: [],
};

export default function PreferencesDialog({ onClose, initialArea = "editor", initialLanguage = "rust" }: { onClose: () => void; initialArea?: "editor" | "toolchains"; initialLanguage?: string }) {
  const prefs = usePreferences(useShallow((state) => ({
    fontSize: state.fontSize,
    setFontSize: state.setFontSize,
    tabSize: state.tabSize,
    setTabSize: state.setTabSize,
    wordWrap: state.wordWrap,
    toggleWordWrap: state.toggleWordWrap,
    theme: state.theme,
    setTheme: state.setTheme,
    ideTheme: state.ideTheme,
    setIdeTheme: state.setIdeTheme,
    breakpointFocusMode: state.breakpointFocusMode,
    setBreakpointFocusMode: state.setBreakpointFocusMode,
  })));
  const [area, setArea] = useState<"editor" | "ide" | "toolchains" | "debugging">(initialArea);
  const [language, setLanguage] = useState<string>(initialLanguage);
  const [snapshot, setSnapshot] = useState<ToolchainSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const onChecked = (event: Event) => {
      if ((event as CustomEvent<string[]>).detail.includes(language)) {
        setRefreshToken((value) => value + 1);
      }
    };
    window.addEventListener("craidd:toolchains-checked", onChecked);
    return () => window.removeEventListener("craidd:toolchains-checked", onChecked);
  }, [language]);

  useEffect(() => {
    if (area !== "toolchains") return;
    let cancelled = false;
    setSnapshot(null);
    setError(null);
    import("@tauri-apps/api/core").then(({ invoke }) => invoke<ToolchainSnapshot>("get_toolchain", { language }))
      .then((value) => { if (!cancelled) setSnapshot(value); })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [area, language, refreshToken]);

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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="User Preferences"
        className="w-[900px] max-w-[calc(100vw-32px)] h-[640px] max-h-[calc(100vh-32px)] flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3 shrink-0">
          <span className="text-sm text-zinc-100 font-medium">User Preferences</span>
          <span className="text-[11px] text-zinc-500">Settings for your editor, workspace, and installed tools</span>
          <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2" aria-label="Close preferences">×</button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <nav aria-label="Preference sections" className="w-44 shrink-0 border-r border-zinc-800 py-3">
            {(["editor", "ide", "toolchains", "debugging"] as const).map((item) => (
              <button key={item} onClick={() => setArea(item)} aria-current={area === item ? "page" : undefined}
                className={"w-full text-left px-4 py-2 text-[12.5px] transition-colors border-l-2 " +
                  (area === item
                    ? "bg-zinc-800 text-zinc-100 border-l-blue-500"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 border-l-transparent")}
              >{item === "editor" ? "Text Editor" : item === "ide" ? "IDE Style" : item === "toolchains" ? "Toolchain" : "Debugging"}</button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 flex flex-col">
            {area === "editor" ? <>
              <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
                <h2 className="text-[13px] text-zinc-100 font-medium">Text Editor</h2>
                <p className="text-[11px] text-zinc-500 mt-1">Choose how files look and behave while you edit.</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
                <div className="px-6 py-5 border-b border-zinc-800">
                  <h3 className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-2">Themes</h3>
                  <p className="text-[11px] text-zinc-500 mb-3">Only the code editor and its tabs change. IDE Style is separate.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    {editorThemes.map((choice) => <ThemeCard key={choice.value} choice={choice}
                      selected={prefs.theme === choice.value} onSelect={prefs.setTheme} />)}
                  </div>
                  <div className="divide-y divide-zinc-800/80">
                    <label className="flex items-center justify-between gap-6 py-3 text-xs">
                      <span className="text-zinc-300">Font size</span>
                      <span className="flex items-center gap-3 min-w-0">
                        <input type="range" min={8} max={24} step={0.5} value={prefs.fontSize}
                          onChange={(e) => prefs.setFontSize(Number(e.target.value))} className="w-36 max-w-[30vw] accent-blue-500" />
                        <span className="text-zinc-300 w-12 text-right tabular-nums">{prefs.fontSize}px</span>
                      </span>
                    </label>
                  </div>
                </div>
                <div className="px-6 py-5">
                  <h3 className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-2">Editing</h3>
                  <div className="divide-y divide-zinc-800/80">
                    <label className="flex items-center justify-between gap-6 py-3 text-xs">
                      <span className="text-zinc-300">Tab size</span>
                      <select value={prefs.tabSize} onChange={(e) => prefs.setTabSize(Number(e.target.value))}
                        className="w-48 max-w-[55%] bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-blue-500">
                        {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center justify-between gap-6 py-3 text-xs">
                      <span className="text-zinc-300">Word wrap</span>
                      <input type="checkbox" checked={prefs.wordWrap} onChange={prefs.toggleWordWrap} className="accent-blue-500" />
                    </label>
                  </div>
                </div>
              </div>
            </> : area === "ide" ? <>
              <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
                <h2 className="text-[13px] text-zinc-100 font-medium">IDE Style</h2>
                <p className="text-[11px] text-zinc-500 mt-1">Change the workspace chrome, panels, menus, and dialogs without changing code colours.</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-6 py-5">
                <h3 className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-2">Themes</h3>
                <p className="text-[11px] text-zinc-500 mb-3">The text editor keeps its own theme, including in linked-window previews.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {ideThemes.map((choice) => <ThemeCard key={choice.value} choice={choice}
                    selected={prefs.ideTheme === choice.value} onSelect={prefs.setIdeTheme} />)}
                </div>
              </div>
            </> : area === "debugging" ? <>
              <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
                <h2 className="text-[13px] text-zinc-100 font-medium">Debugging</h2>
                <p className="text-[11px] text-zinc-500 mt-1">How Craidd responds when a debugger pauses in a linked window.</p>
              </div>
              <div className="px-6 py-5">
                <label htmlFor="breakpoint-focus" className="block text-xs text-zinc-300 mb-2">Focus follows breakpoint</label>
                <select id="breakpoint-focus" value={prefs.breakpointFocusMode}
                  onChange={(event) => prefs.setBreakpointFocusMode(event.target.value as "always" | "idle" | "never")}
                  className="w-56 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500">
                  <option value="always">Always raise</option>
                  <option value="idle">Raise when idle</option>
                  <option value="never">Never raise (default)</option>
                </select>
                <p className="text-[11px] text-zinc-500 mt-3 max-w-md">
                  When idle waits about two seconds after typing in any Craidd window. Never raise marks the paused window in its title instead.
                </p>
                <p className="text-[11px] text-zinc-600 mt-3 max-w-md">
                  This takes effect when a debugger adapter reports a pause. Debugger integration is still in development.
                </p>
              </div>
            </> : <>
              <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
                <h2 className="text-[13px] text-zinc-100 font-medium">Toolchain</h2>
                <p className="text-[11px] text-zinc-500 mt-1">Select the tools Craidd Studio uses for each language.</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
                <div className="px-6 py-5 border-b border-zinc-800">
                  <h3 className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-3">Language</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <select id="toolchain-language" aria-label="Language" value={language} disabled={busy} onChange={(e) => setLanguage(e.target.value)}
                      className="w-48 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500">
                      {languages.map((item) => <option key={item} value={item}>{languageLabels[item]}</option>)}
                    </select>
                    <span className="text-[11px] text-zinc-500">
                      {snapshot ? (snapshot.scanned ? `${snapshot.tools.length} tools detected` : "Not yet scanned") : "Loading…"}
                    </span>
                    <button onClick={() => void scan()} disabled={busy || !snapshot}
                      className="ml-auto px-3 py-1.5 rounded border border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                      {busy ? "Scanning…" : "Rescan my system"}
                    </button>
                  </div>
                </div>
                <div className="px-6 py-5">
                  <h3 className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-2">Tool defaults</h3>
                  {roles[language].map((role) => {
                    const found = snapshot?.tools.filter((tool) => tool.role === role) ?? [];
                    const selected = snapshot?.defaults[role] ?? "";
                    return <div key={role} className="border-b border-zinc-800 last:border-b-0 py-4 first:pt-2">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <label htmlFor={`tool-${role}`} className="capitalize text-xs text-zinc-300">{role.replace(/_/g, " ")}</label>
                        {found.length === 0 && snapshot?.scanned && <span className="text-[11px] text-amber-400">Not found</span>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select id={`tool-${role}`} value={selected} disabled={busy || !snapshot}
                          onChange={(e) => void setDefault(role, e.target.value || null)}
                          className="flex-1 min-w-40 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500 disabled:opacity-50">
                          <option value="">Automatic{found[0] ? ` (${found[0].name})` : ""}</option>
                          {found.map((tool) => <option key={tool.path} value={tool.path}>{tool.name} — {tool.path}</option>)}
                          {selected && !found.some((tool) => tool.path === selected) && <option value={selected}>{selected} (custom or missing)</option>}
                        </select>
                        <button onClick={() => void choosePath(role)} disabled={busy}
                          className="px-3 py-1.5 rounded border border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">Choose Path…</button>
                      </div>
                      {found.map((tool) => <div key={tool.path} className="text-[11px] text-zinc-500 truncate mt-1.5" title={tool.path}>{tool.name}: {tool.version}</div>)}
                    </div>;
                  })}
                  {language === "config" && <p className="text-xs text-zinc-500 py-4">Config projects do not need a toolchain.</p>}
                  {snapshot && <p className="text-[10.5px] text-zinc-600 break-all mt-5">Saved in {snapshot.preferencesPath}</p>}
                  {error && <div role="alert" className="text-xs text-red-400 mt-4">{error}</div>}
                </div>
              </div>
            </>}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end shrink-0">
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white">Close</button>
        </div>
      </div>
    </div>
  );
}
