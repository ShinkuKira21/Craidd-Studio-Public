import { useEffect, useState } from "react";
import type { StartupState, WorkspaceEntry } from "../../types/startup";

function nameOf(path: string) { return path.split(/[\\/]/).filter(Boolean).pop() ?? path; }

export default function GetStarted({ startup, initialError, onOpen, onStartProject }: {
  startup: StartupState;
  initialError: string | null;
  onOpen: (entry: WorkspaceEntry) => Promise<void>;
  onStartProject: (folder: string) => Promise<void>;
}) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState(startup);

  useEffect(() => {
    const refresh = () => {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke<StartupState>("get_startup_state")
      ).then(setRecent).catch(() => {});
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const run = (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    void action().catch((cause) => setError(String(cause))).finally(() => setBusy(false));
  };

  const pickFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    return typeof selected === "string" ? selected : null;
  };

  const createProject = () => run(async () => {
    const folder = await pickFolder();
    if (folder) await onStartProject(folder);
  });

  const openFolder = () => run(async () => {
    const path = await pickFolder();
    if (path) await onOpen({ path, kind: "folder", name: nameOf(path), windowLabel: "" });
  });

  const openSolution = () => run(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "Craidd Solution", extensions: ["cln"] }] });
    if (typeof path === "string") await onOpen({ path, kind: "solution", name: nameOf(path), windowLabel: "" });
  });

  const reopenSession = () => run(async () => {
    const entries = recent.lastSession.filter((entry) => entry.kind === "solution").slice(0, 3);
    if (entries.length === 0) return;
    const { invoke } = await import("@tauri-apps/api/core");
    for (const entry of entries.slice(1)) await invoke("open_workspace_window", { entry });
    await invoke("apply_window_geometry", { entry: entries[0] });
    await onOpen(entries[0]);
  });

  const previous = recent.lastSession.filter((entry) => entry.kind === "solution").slice(0, 3);

  return (
    <main className="h-screen overflow-y-auto text-zinc-200" style={{ background: "radial-gradient(circle at 90% 5%, rgba(37, 99, 235, 0.075), transparent 34%), #09090b" }}>
      <div className="max-w-[1050px] mx-auto px-8 py-9 md:px-12 md:py-10">
        <header className="flex items-center gap-4 pb-7 border-b border-zinc-800">
          <div className="w-12 h-12 rounded-xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center shrink-0"><img src="/craidd-icon.png" alt="" className="w-10 h-10" /></div>
          <div>
            <h1 className="text-[25px] leading-7 font-semibold tracking-tight text-zinc-100">Craidd Studio</h1>
            <p className="text-sm text-zinc-500 mt-0.5">Get started with a project or solution</p>
          </div>
        </header>

        {error && <div role="alert" className="mt-5 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.25fr)_minmax(260px,0.75fr)] gap-9 pt-7">
          <div className="min-w-0 space-y-7">
            <section>
              <h2 className="text-[11px] uppercase tracking-[0.15em] font-semibold text-zinc-500 mb-3">Start</h2>
              <div className="space-y-2">
                <StartLink label="Create Project Wizard" detail="Choose a language, Config, and Fine Tune options" icon="＋" onClick={createProject} disabled={busy} />
                <StartLink label="Open Folder" detail="Browse and edit files without a solution" icon="▤" onClick={openFolder} disabled={busy} />
                <StartLink label="Open Solution" detail="Load a Craidd .cln workspace" icon="◇" onClick={openSolution} disabled={busy} />
              </div>
            </section>

            <section className="border-t border-zinc-800 pt-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[11px] uppercase tracking-[0.15em] font-semibold text-zinc-500">Open previous session</h2>
                {previous.length > 1 && <button onClick={reopenSession} disabled={busy} className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50">Open all</button>}
              </div>
              {previous.length === 0 ? <p className="text-xs text-zinc-600">Your last opened solutions will appear here.</p> :
                previous.map((entry) => <SolutionLink key={entry.path} entry={entry} disabled={busy} onClick={() => run(() => onOpen(entry))} />)}
            </section>

            <section className="border-t border-zinc-800 pt-5">
              <h2 className="text-[11px] uppercase tracking-[0.15em] font-semibold text-zinc-500 mb-2">Open recent solutions</h2>
              {recent.recentSolutions.length === 0 ? <p className="text-xs text-zinc-600">No recent solutions yet.</p> :
                recent.recentSolutions.map((entry) => <SolutionLink key={entry.path} entry={entry} disabled={busy} onClick={() => run(() => onOpen(entry))} />)}
            </section>
          </div>

          <aside className="min-w-0 space-y-3">
            <section className="rounded-lg border border-zinc-800 bg-zinc-900/55 px-4 py-3.5">
              <h2 className="text-[11px] uppercase tracking-[0.13em] font-semibold text-zinc-400 mb-2.5">Tips &amp; tricks</h2>
              <ul className="space-y-2 text-xs text-zinc-500 leading-5">
                <li>Open a folder to browse and edit files without creating a solution.</li>
                <li>Use Fine Tune on a project to choose which files belong in its language and Config areas.</li>
                <li>Choose installed tools in File → Preferences → Toolchains.</li>
              </ul>
            </section>
            <section className="rounded-lg border border-zinc-800 bg-zinc-900/55 px-4 py-3.5">
              <h2 className="text-[11px] uppercase tracking-[0.13em] font-semibold text-zinc-400 mb-2.5">Language tutorials</h2>
              <div className="space-y-3 text-xs leading-5">
                <div><div className="text-zinc-200 font-medium">Rust</div><p className="text-zinc-500">Open a Cargo project, declare its Rust folder, then choose a build configuration.</p></div>
                <div><div className="text-zinc-200 font-medium">C++</div><p className="text-zinc-500">Declare a C++ project and inspect its CMake or compiler tools in Preferences.</p></div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function StartLink({ label, detail, icon, onClick, disabled }: { label: string; detail: string; icon: string; onClick: () => void; disabled: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="group flex items-center gap-3 w-full min-h-[62px] text-left rounded-lg border border-zinc-800 bg-zinc-900/70 px-3.5 py-2 hover:border-blue-500/50 hover:bg-zinc-900 transition-colors disabled:opacity-50">
    <span aria-hidden className="w-8 h-8 rounded-md bg-blue-500/10 text-blue-400 flex items-center justify-center text-lg shrink-0">{icon}</span>
    <span className="min-w-0"><span className="block text-[13px] font-medium text-zinc-100 group-hover:text-blue-300">{label}</span><span className="block text-[11px] text-zinc-500 mt-0.5 truncate">{detail}</span></span>
  </button>;
}

function SolutionLink({ entry, onClick, disabled }: { entry: WorkspaceEntry; onClick: () => void; disabled: boolean }) {
  return <button onClick={onClick} disabled={disabled} className="block w-full text-left rounded px-2 py-1.5 hover:bg-zinc-900/80 disabled:opacity-50">
    <span className="block text-xs text-blue-400 hover:text-blue-300 truncate">{entry.name}</span>
    <span className="block text-[11px] text-zinc-600 truncate" title={entry.path}>{entry.path}</span>
  </button>;
}
