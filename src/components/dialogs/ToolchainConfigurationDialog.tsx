import { useEffect, useState } from "react";
import type { CraiddProject } from "../../types/project";
import { useSolution } from "../../store/solutionStore";

interface ToolEntry { role: string; name: string; path: string; version: string }
interface ToolchainSnapshot {
  language: string;
  scanned: boolean;
  tools: ToolEntry[];
  defaults: Record<string, string>;
  preferencesPath: string;
}

const ROLES_BY_LANGUAGE: Record<string, string[]> = {
  rust: ["build", "compiler", "manager", "debugger"],
  typescript: ["runtime", "package_manager"],
  javascript: ["runtime", "package_manager"],
  cpp: ["compiler", "build_system"],
  csharp: ["sdk"],
  python: ["runtime", "package_manager"],
  config: [],
};

export default function ToolchainConfigurationDialog({
  project,
  onClose,
}: {
  project: CraiddProject;
  onClose: () => void;
}) {
  const rootPath = useSolution((s) => s.rootPath);
  const [snapshot, setSnapshot] = useState<ToolchainSnapshot | null>(null);
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const language = project.language ?? "config";
  const roles = ROLES_BY_LANGUAGE[language] ?? [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!rootPath) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const snap = await invoke<ToolchainSnapshot>("get_toolchain", { language });
        const over = await invoke<Record<string, string | null>>("read_project_tool_override", {
          root: rootPath,
          projectPath: project.path,
        });
        if (cancelled) return;
        setSnapshot(snap);
        setOverride(over ?? {});
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [rootPath, project.path, language]);

  const rescan = async () => {
    setBusy(true); setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setSnapshot(await invoke<ToolchainSnapshot>("scan_toolchain", { language }));
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  const choosePath = async (role: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({ multiple: false });
      if (typeof chosen !== "string") return;
      setOverride((o) => ({ ...o, [role]: chosen }));
    } catch (err) { setError(String(err)); }
  };

  const clear = (role: string) => {
    setOverride((o) => {
      const next = { ...o };
      delete next[role];
      return next;
    });
  };

  const save = async () => {
    if (!rootPath) return;
    setBusy(true); setError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("write_project_tool_override", {
        root: rootPath,
        projectPath: project.path,
        override_: override,
      });
      onClose();
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={busy ? undefined : onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[620px] max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium shrink-0">
          Toolchain — {project.name}
          <span className="ml-3 text-[11px] text-zinc-500 font-normal">{language}</span>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-4 py-4 space-y-4 text-xs">
          {error && (
            <div className="text-red-400 bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">{error}</div>
          )}
          {!snapshot && !error && (
            <div className="text-zinc-500 italic">Loading…</div>
          )}
          {snapshot && roles.length === 0 && (
            <div className="text-zinc-500">Config projects do not need a toolchain.</div>
          )}
          {snapshot && roles.map((role) => {
            const found = snapshot.tools.filter((t) => t.role === role);
            const machineDefault = snapshot.defaults[role] ?? "";
            const inherited = found.find((t) => t.path === machineDefault) ?? found[0];
            const current = override[role] ?? "";
            return (
              <div key={role} className="border-b border-zinc-800 pb-3 last:border-b-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-zinc-300 capitalize">{role.replace(/_/g, " ")}</span>
                  <span className="text-[10px] text-zinc-600">
                    {snapshot.scanned ? "" : "not yet scanned"}
                  </span>
                </div>

                <div className="text-[11px] text-zinc-500 mb-1.5 leading-4">
                  Machine default: <span className="text-zinc-400">{machineDefault || (inherited ? inherited.path : "not set")}</span>
                  {inherited && <span className="text-zinc-600"> · {inherited.version}</span>}
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={current}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) clear(role);
                      else setOverride((o) => ({ ...o, [role]: v }));
                    }}
                    disabled={busy}
                    className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
                  >
                    <option value="">Inherit machine default</option>
                    {found.map((t) => (
                      <option key={t.path} value={t.path}>{t.name} — {t.path}</option>
                    ))}
                    {current && !found.some((t) => t.path === current) && (
                      <option value={current}>{current} (custom)</option>
                    )}
                  </select>
                  <button
                    onClick={() => choosePath(role)}
                    disabled={busy}
                    className="px-2.5 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Choose Path…
                  </button>
                  {current && (
                    <button
                      onClick={() => clear(role)}
                      disabled={busy}
                      className="px-2.5 py-1 rounded text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2 shrink-0">
          <button
            onClick={rescan}
            disabled={busy || !snapshot}
            className="px-3 py-1 rounded text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? "Scanning…" : "Rescan my system"}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
