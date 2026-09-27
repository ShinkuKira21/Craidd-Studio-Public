import { useState } from "react";
import { selectConfiguration } from "../../store/buildStore";
import { useSolution } from "../../store/solutionStore";
import { detectTauriSetup, suppressTauriSuggestion, type TauriSetupProposal } from "../../lib/frameworkSetup";

export default function TauriSetupDialog({
  proposal,
  onDone,
}: {
  proposal: TauriSetupProposal;
  onDone: () => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decline = () => {
    if (dontAskAgain) suppressTauriSuggestion(proposal.rootPath);
    onDone();
  };

  const accept = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const state = useSolution.getState();
      if (!state.solution || state.rootPath !== proposal.rootPath) {
        throw new Error("The workspace changed. Reopen this project to set it up.");
      }
      // Recheck before writing: the user may have changed projects while this dialog was open.
      const latest = await detectTauriSetup(state.solution, proposal.triggerPath);
      if (!latest) throw new Error("The Tauri setup has changed. Please reopen this project and try again.");
      if (latest.companion) {
        if (latest.companion.existingPath) {
          await useSolution.getState().addExistingProject(latest.companion.existingPath);
        } else {
          await useSolution.getState().addProject({
            name: latest.companion.name,
            language: latest.companion.language,
            folder: latest.companion.folder,
          });
        }
      }
      if (latest.updateFrontendConfig) {
        const frontend = useSolution.getState().solution?.projects.find((project) =>
          project.folder === "src" && !project.missing
          && (project.language === "typescript" || project.language === "javascript"));
        if (!frontend) throw new Error("Frontend project was not available after setup.");
        await useSolution.getState().setConfigDirectory(frontend.id, "..");
      }
      const updated = useSolution.getState().solution;
      if (updated && [...updated.inferredConfigs, ...updated.configs].some((config) => config.name === "Tauri Dev")) {
        selectConfiguration(updated, "Tauri Dev");
      }
      if (dontAskAgain) suppressTauriSuggestion(proposal.rootPath);
      onDone();
    } catch (err) {
      console.error("[craidd] Guided Tauri setup failed:", err);
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Tauri workspace setup"
         className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60">
      <div className="w-[480px] max-w-[calc(100vw-32px)] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-100 font-medium">
          Tauri workspace recognized
        </div>
        <div className="px-4 py-4 space-y-3 text-xs text-zinc-300">
          <p className="leading-5">
            Craidd found a Tauri script in the workspace package.json and a Tauri dependency in src-tauri/Cargo.toml.
            Would you like it to connect the frontend and Rust projects?
          </p>
          <div className="rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 space-y-1">
            {proposal.companion && (
              <p>Add <span className="font-mono text-blue-300">{proposal.companion.folder}/</span> as a
                {proposal.companion.language === "rust" ? " Rust" : proposal.companion.language === "typescript" ? " TypeScript" : " JavaScript"} project
                {proposal.companion.existingPath ? " using its existing .craidd file." : " with a new .craidd file."}
              </p>
            )}
            {proposal.updateFrontendConfig && (
              <p>Point the frontend project's config directory at the workspace root, so its root package.json scripts can provide Tauri Dev.</p>
            )}
          </div>
          <p className="text-zinc-500">Only Craidd's .cln/.craidd project settings change. Your Tauri, Cargo and npm manifests stay untouched.</p>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={dontAskAgain} onChange={(event) => setDontAskAgain(event.target.checked)}
                   disabled={submitting} className="accent-blue-600" />
            <span>Don't ask again for this workspace</span>
          </label>
          {error && <div role="alert" className="text-red-400 bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button type="button" onClick={decline} disabled={submitting}
                  className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">No thanks</button>
          <button type="button" onClick={accept} disabled={submitting}
                  className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50">
            {submitting ? "Setting up…" : "Set up"}
          </button>
        </div>
      </div>
    </div>
  );
}
