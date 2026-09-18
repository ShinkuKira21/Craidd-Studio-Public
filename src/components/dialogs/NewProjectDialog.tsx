import { useState } from "react";
import type { Language } from "../../types/project";
import { LANGUAGES } from "../../lib/languages";
import { useSolution } from "../../store/solutionStore";

interface Props {
  onClose: (opts?: { fineTuneAfter?: boolean; projectName?: string }) => void;
}

export default function NewProjectDialog({ onClose }: Props) {
  const createBlankProject = useSolution((s) => s.createBlankProject);
  const addConfigHere = useSolution((s) => s.addConfigHere);

  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Language>("rust");
  const [withConfig, setWithConfig] = useState(false);
  const [configDir, setConfigDir] = useState(".");
  const [fineTuneAfter, setFineTuneAfter] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showConfigCheckbox = language !== "config";

  const browseConfigDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      setConfigDir(selected);
    } catch (err) {
      console.error("[craidd] browse config dir failed:", err);
    }
  };

  const submit = async () => {
    setError(null);
    const projectName = name.trim() || "NewProject";
    setSubmitting(true);
    try {
      await createBlankProject({
        name: projectName,
        language,
        subfolder: projectName,
      });

      if (withConfig && showConfigCheckbox) {
        // Locate the project we just created and enable config on it.
        const state = useSolution.getState();
        const created = state.solution?.projects.find((p) => p.name === projectName);
        if (created) {
          if (configDir && configDir !== ".") {
            await useSolution.getState().setConfigDirectory(created.id, configDir);
          } else {
            await addConfigHere(created.id);
          }
        }
      }

      onClose({ fineTuneAfter, projectName });
    } catch (err) {
      console.error("[craidd] NewProjectDialog failed:", err);
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={submitting ? undefined : () => onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          Create Blank Project
        </div>

        <div className="px-4 py-4 space-y-3 text-xs">
          <label className="block">
            <div className="text-zinc-400 mb-1">Project name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
              placeholder="MyProject"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <div className="text-zinc-400 mb-1">Language</div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              disabled={submitting}
              className="w-full rounded px-2 py-1.5 outline-none disabled:opacity-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>

          {showConfigCheckbox && (
            <div className="pt-2 border-t border-zinc-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={withConfig}
                  onChange={(e) => setWithConfig(e.target.checked)}
                  disabled={submitting}
                  className="accent-blue-600"
                />
                <span className="text-zinc-300">Create a Config project too?</span>
              </label>

              {withConfig && (
                <div className="pl-6 space-y-1">
                  <div className="text-zinc-500 text-[11px]">Config directory</div>
                  <div className="flex gap-2">
                    <input
                      value={configDir}
                      onChange={(e) => setConfigDir(e.target.value)}
                      disabled={submitting}
                      placeholder="."
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50 font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={browseConfigDir}
                      disabled={submitting}
                      className="px-2.5 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Browse…
                    </button>
                  </div>
                  <div className="text-zinc-600 text-[10.5px] leading-4">
                    Use <span className="font-mono">.</span> for the project root, a subpath like
                    <span className="font-mono"> config/</span>, or browse within the solution folder.
                    For program-owned config files (states, save data), this is where they live.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-zinc-800">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={fineTuneAfter}
                onChange={(e) => setFineTuneAfter(e.target.checked)}
                disabled={submitting}
                className="accent-blue-600"
              />
              <span className="text-zinc-300">Fine Tune after creation?</span>
            </label>
            <div className="pl-6 text-zinc-600 text-[10.5px] leading-4 mt-0.5">
              Opens Fine Tune once the project is created.
            </div>
          </div>

          <div className="text-zinc-500 text-[11px] leading-5 pt-3 border-t border-zinc-800">
            Folder <span className="font-mono text-zinc-300">{name || "MyProject"}/</span> will be
            created in the solution root.
          </div>

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={() => onClose()}
            disabled={submitting}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
