import { useEffect, useRef, useState } from "react";
import type { FileNode, Language } from "../../types/project";
import { LANGUAGES } from "../../lib/languages";
import { useSolution } from "../../store/solutionStore";

export default function MakeProjectDialog({ node, onClose }: { node: FileNode; onClose: () => void }) {
  const addProject = useSolution((s) => s.addProject);
  const rootPath = useSolution((s) => s.rootPath);
  const [name, setName] = useState(node.name);
  const [language, setLanguage] = useState<Language>("rust");
  const languageChosenByUser = useRef(false);
  const [languageHint, setLanguageHint] = useState("Detecting language from this folder…");
  const [scanPending, setScanPending] = useState(true);
  const [withConfig, setWithConfig] = useState(false);
  const [configDir, setConfigDir] = useState(".");
  const [fineTuneAfter, setFineTuneAfter] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) {
      setLanguageHint("Rust is selected by default; choose another language if needed.");
      setScanPending(false);
      return;
    }
    let cancelled = false;
    setScanPending(true);
    const folder = !node.path || node.path === "."
      ? rootPath
      : `${rootPath.replace(/\/+$/, "")}/${node.path.replace(/^\/+/, "")}`;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const suggestion = await invoke<{ language: string | null; evidence: string }>(
          "rescan_language_suggestion", { folder }
        );
        if (cancelled) return;
        const detected = LANGUAGES.find((item) => item.id === suggestion.language);
        if (detected) {
          if (!languageChosenByUser.current) setLanguage(detected.id);
          setLanguageHint(`Suggested ${detected.label}: ${suggestion.evidence}. You can change it.`);
        } else {
          setLanguageHint(`${suggestion.evidence} Rust is selected by default; choose another language if needed.`);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[craidd] Language detection failed:", err);
          setLanguageHint("Could not detect a language. Rust is selected by default; choose another language if needed.");
        }
      } finally {
        if (!cancelled) setScanPending(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rootPath, node.path]);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await addProject({ name: name.trim() || node.name, language, folder: node.path || "." });
      const projects = useSolution.getState().solution?.projects ?? [];
      const created = projects.find(
        (p) => p.folder === (node.path || ".") && p.language === language && p.name === name.trim()
      ) ?? (language === "config" ? projects.find((p) => p.folder === (node.path || ".") && p.configEnabled) : undefined);
      if (withConfig && created && language !== "config") {
        if (configDir.trim() && configDir.trim() !== ".") {
          await useSolution.getState().setConfigDirectory(created.id, configDir.trim());
        } else {
          await useSolution.getState().addConfigHere(created.id);
        }
      }
      onClose();
      if (fineTuneAfter && created) {
        window.dispatchEvent(new CustomEvent("craidd:fine-tune-project", { detail: created.id }));
      }
    } catch (err) {
      console.error("[craidd] MakeProjectDialog failed:", err);
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={submitting ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-[440px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          Make This a Project
        </div>
        <div className="px-4 py-4 space-y-3 text-xs">
          <div className="text-zinc-500">
            Folder: <span className="text-zinc-300 font-mono">{node.path || "."}</span>
          </div>
          <label className="block">
            <div className="text-zinc-400 mb-1">Project name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus disabled={submitting}
                   className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50" />
          </label>
          <label className="block">
            <div className="text-zinc-400 mb-1">Language</div>
            <select value={language} onChange={(e) => { languageChosenByUser.current = true; setLanguage(e.target.value as Language); }} disabled={submitting}
                    className="w-full rounded px-2 py-1.5 outline-none disabled:opacity-50">
              {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <div aria-live="polite" className="mt-1 text-[11px] text-zinc-500">{languageHint}</div>
          </label>
          {language !== "config" && (
            <div className="pt-2 border-t border-zinc-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={withConfig} onChange={(e) => setWithConfig(e.target.checked)} disabled={submitting} className="accent-blue-600" />
                <span className="text-zinc-300">Create a Config project too?</span>
              </label>
              {withConfig && (
                <div className="pl-6 space-y-1">
                  <div className="text-zinc-500 text-[11px]">Config directory</div>
                  <div className="flex gap-2">
                    <input value={configDir} onChange={(e) => setConfigDir(e.target.value)} disabled={submitting} className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 outline-none focus:border-blue-500 font-mono" />
                    <button type="button" disabled={submitting} onClick={async () => {
                      const { open } = await import("@tauri-apps/plugin-dialog");
                      const selected = await open({ directory: true, multiple: false });
                      if (typeof selected === "string") setConfigDir(selected);
                    }} className="px-2.5 py-1 rounded text-zinc-300 border border-zinc-700 hover:bg-zinc-800">Browse…</button>
                  </div>
                  <div className="text-zinc-600 text-[10px]">Use . for the project folder, a subfolder, or an absolute path.</div>
                </div>
              )}
            </div>
          )}
          <label className="flex items-center gap-2 pt-2 border-t border-zinc-800 cursor-pointer select-none">
            <input type="checkbox" checked={fineTuneAfter} onChange={(e) => setFineTuneAfter(e.target.checked)} disabled={submitting} className="accent-blue-600" />
            <span className="text-zinc-300">Fine Tune after creation?</span>
          </label>
          <div className="text-zinc-500 text-[11px] leading-5 pt-3 border-t border-zinc-800">
            A <span className="font-mono text-zinc-300">{node.name}.craidd</span> file will be written
            inside <span className="font-mono text-zinc-300">{node.path || "."}/</span>, and the solution
            file will be created or updated.
          </div>
          {error && <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button onClick={onClose} disabled={submitting}
                  className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={submitting || scanPending || !name.trim()}
                  className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
            {submitting ? "Creating…" : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
