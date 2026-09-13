import { useState } from "react";
import type { FileNode, Language } from "../../types/project";
import { LANGUAGES } from "../../lib/languages";
import { useSolution } from "../../store/solutionStore";

export default function MakeProjectDialog({ node, onClose }: { node: FileNode; onClose: () => void }) {
  const addProject = useSolution((s) => s.addProject);
  const [name, setName] = useState(node.name);
  const [language, setLanguage] = useState<Language>("rust");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await addProject({ name: name.trim() || node.name, language, folder: node.path || "." });
      onClose();
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
          <button onClick={submit} disabled={submitting || !name.trim()}
                  className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
            {submitting ? "Creating…" : "Create Project"}
          </button>
        </div>
      </div>
    </div>
  );
}
