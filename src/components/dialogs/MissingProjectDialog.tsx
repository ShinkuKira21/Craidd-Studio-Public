import { useEffect, useMemo, useState } from "react";
import type { CraiddProject, Language } from "../../types/project";
import { LANGUAGES } from "../../lib/languages";
import { useSolution } from "../../store/solutionStore";

type Option = "recreate" | "repoint" | "move";

interface FolderClaim {
  language: string;
  files: { name: string; path: string }[];
}

export default function MissingProjectDialog({
  project,
  onClose,
}: {
  project: CraiddProject;
  onClose: () => void;
}) {
  const redeclareProject = useSolution((s) => s.redeclareProject);
  const repointProject = useSolution((s) => s.repointProject);
  const moveProjectTo = useSolution((s) => s.moveProjectTo);
  const removeProject = useSolution((s) => s.removeProject);
  const rootPath = useSolution((s) => s.rootPath);
  const solution = useSolution((s) => s.solution);

  const [option, setOption] = useState<Option>("recreate");
  const [name, setName] = useState(project.name);
  const [language, setLanguage] = useState<Language>(project.language ?? "rust");

  // Option 1 folder state.
  const [folderClaims, setFolderClaims] = useState<FolderClaim[] | null>(null);
  const [folderEmpty, setFolderEmpty] = useState(false);

  // Option B state.
  const [chosenCraidd, setChosenCraidd] = useState<string | null>(null);
  const [craiddError, setCraiddError] = useState<string | null>(null);

  // Option C state.
  const [chosenFolder, setChosenFolder] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderScanning, setFolderScanning] = useState(false);
  const [folderSuggestion, setFolderSuggestion] = useState<{
    language: Language | null;
    evidence: string;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── On open, scan the target folder for markers AND content. ──
  // folderEmpty means: no files at all. Not: no markers. A folder
  // with content but no marker is the "accidentally deleted .craidd"
  // case — Option 1 recreates it, pre-filled from the content.
  useEffect(() => {
    let cancelled = false;
    if (!rootPath) return;
    const craiddAbs = project.path.startsWith("/")
      ? project.path
      : `${rootPath.replace(/\/+$/, "")}/${project.path}`;
    const folderAbs = craiddAbs.slice(0, craiddAbs.lastIndexOf("/"));
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");

        // Markers.
        const claims = await invoke<FolderClaim[]>("folder_language_claims_cmd", {
          folder: folderAbs,
        });
        if (cancelled) return;
        setFolderClaims(claims);

        // Content — is there anything at all in the folder?
        const suggestion = await invoke<{
          language: string | null;
          evidence: string;
        }>("rescan_language_suggestion", { folder: folderAbs });
        if (cancelled) return;

        // Direct empty check: no non-.craidd, non-dotfile entries.
        const isEmptyDir = await invoke<boolean>("folder_is_empty", {
          folder: folderAbs,
        });
        if (cancelled) return;

        setFolderSuggestion({
          language: suggestion.language as Language | null,
          evidence: suggestion.evidence,
        });

        console.log("[craidd] missing-project scan:", {
          folderAbs,
          claims: claims.length,
          isEmptyDir,
          suggestion,
        });

        // Empty means: no markers AND genuinely empty folder.
        const isEmpty = claims.length === 0 && isEmptyDir;
        setFolderEmpty(isEmpty);

        if (isEmpty) {
          setOption("move");
        } else if (suggestion.language) {
          // Pre-fill Option 1's language from the folder contents.
          setLanguage(suggestion.language as Language);
        }

      } catch (err) {
        if (!cancelled) setFolderClaims([]);
      }
    })();
    return () => { cancelled = true; };
  }, [project.path, rootPath]);


  // Determine if the currently selected language for Option 1 is blocked.
  const optionOneBlocked = useMemo(() => {
    if (!folderClaims) return null;
    for (const c of folderClaims) {
      if (c.language !== language) continue;
      // Is any claim live (declared in solution, not this project)?
      for (const f of c.files) {
        const rel = toRel(f.path, rootPath ?? "");
        if (rel === project.path) continue; // our own stale
        const live = solution?.projects.some(
          (p) => p.id !== project.id && p.path === rel,
        );
        if (live) {
          return `This folder already has a live ${language} project (${f.name}).`;
        }
      }
    }
    return null;
  }, [folderClaims, language, solution, project.id, project.path, rootPath]);

  const browseCraidd = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Craidd Project", extensions: ["craidd"] }],
      });
      if (typeof selected === "string") setChosenCraidd(selected);
    } catch (err) {
      console.error("[craidd] browse .craidd failed:", err);
    }
  };

  const browseFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setChosenFolder(selected);
        setFolderSuggestion(null);
        setFolderError(null);
      }
    } catch (err) {
      console.error("[craidd] browse folder failed:", err);
    }
  };

  // ── Option B — scan the chosen marker. ──
  useEffect(() => {
    let cancelled = false;
    if (!chosenCraidd || option !== "repoint") {
      setCraiddError(null);
      return;
    }
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const raw = await invoke<string>("read_file", { path: chosenCraidd });
        if (cancelled) return;
        if (!raw.includes("[project]") && !raw.includes("[config]")) {
          setCraiddError("That file is not a .craidd.");
          return;
        }
        // Parse language.
        let markerLanguage: string | null = null;
        {
          let inProject = false;
          for (const line of raw.split("\n")) {
            const t = line.trim();
            if (t === "[project]") { inProject = true; continue; }
            if (t.startsWith("[")) { inProject = false; continue; }
            if (!inProject) continue;
            const m = t.match(/^language\s*=\s*"([^"]*)"/);
            if (m) { markerLanguage = m[1]; break; }
          }
        }

        // Path conflict?
        const rel = toRel(chosenCraidd, rootPath ?? "");
        if (solution?.projects.some((p) => p.id !== project.id && p.path === rel)) {
          setCraiddError("That .craidd is already declared in this solution.");
          return;
        }

        // Folder conflict?
        if (markerLanguage) {
          const folderAbs = chosenCraidd.slice(0, chosenCraidd.lastIndexOf("/"));
          const claims = await invoke<FolderClaim[]>("folder_language_claims_cmd", {
            folder: folderAbs,
          });
          for (const c of claims) {
            if (c.language !== markerLanguage) continue;
            for (const f of c.files) {
              if (f.path === chosenCraidd) continue;
              const r = toRel(f.path, rootPath ?? "");
              const live = solution?.projects.some(
                (p) => p.id !== project.id && p.path === r,
              );
              if (live) {
                setCraiddError(
                  `This folder already has a live ${markerLanguage} project. Clean up first.`,
                );
                return;
              }
            }
          }
        }

        setCraiddError(null);
      } catch (err) {
        if (!cancelled) setCraiddError(String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [chosenCraidd, option, project.id, solution, rootPath]);

  // ── Option C — scan the chosen folder. ──
  useEffect(() => {
    let cancelled = false;
    if (!chosenFolder || option !== "move") {
      setFolderError(null);
      setFolderSuggestion(null);
      return;
    }
    setFolderScanning(true);
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const markers = await invoke<
          { name: string; path: string; language: string | null }[]
        >("scan_craidd_in_folder_cmd", { folder: chosenFolder });

        if (cancelled) return;

        const targetLanguage = language;

        // Existing same-language marker?
        const sameLang = markers.find((m) => m.language === targetLanguage);
        if (sameLang) {
          const rel = toRel(sameLang.path, rootPath ?? "");
          const live = solution?.projects.some(
            (p) => p.id !== project.id && p.path === rel,
          );
          if (live) {
            setFolderError(
              `This folder already has a live ${targetLanguage} project (${sameLang.name}).`,
            );
            setFolderScanning(false);
            return;
          }
        }

        if (markers.length === 0) {
          // Empty of markers — scan the folder for language suggestion.
          const suggestion = await invoke<{
            language: string | null;
            evidence: string;
          }>("rescan_language_suggestion", { folder: chosenFolder });
          if (cancelled) return;
          setFolderSuggestion({
            language: suggestion.language as Language | null,
            evidence: suggestion.evidence,
          });
          if (suggestion.language) {
            setLanguage(suggestion.language as Language);
          }
        }
        setFolderError(null);
      } catch (err) {
        if (!cancelled) setFolderError(String(err));
      } finally {
        if (!cancelled) setFolderScanning(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chosenFolder, option, language, project.id, solution, rootPath]);

  const canSubmit = (() => {
    if (submitting) return false;
    if (folderClaims === null) return false;
    if (option === "recreate") {
      if (!name.trim()) return false;
      if (optionOneBlocked) return false;
      return true;
    }
    if (option === "repoint") return !!chosenCraidd && !craiddError;
    if (option === "move") return !!chosenFolder && !folderError && !folderScanning;
    return false;
  })();

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (option === "recreate") {
        await redeclareProject(project.id, { name: name.trim(), language });
      } else if (option === "repoint") {
        if (!chosenCraidd) throw new Error("Choose a .craidd first.");
        await repointProject(project.id, chosenCraidd);
      } else if (option === "move") {
        if (!chosenFolder) throw new Error("Choose a folder first.");
        await moveProjectTo(project.id, chosenFolder, language);
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const doRemove = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await removeProject(project.id);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={submitting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[640px] max-h-[85vh] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium shrink-0">
          Missing Project — {project.name}
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin px-4 py-4 space-y-4 text-xs">
          <div className="text-zinc-500">
            Path: <span className="font-mono text-zinc-300">{project.path}</span>
          </div>

          <div className="text-zinc-400 leading-5 bg-zinc-950/50 border border-zinc-800 rounded px-3 py-2">
            This project is declared in the solution, but its{" "}
            <span className="font-mono">.craidd</span> file is not on disk.
          </div>

          <div className="text-zinc-500 text-[11px] uppercase tracking-wide pt-1">
            What would you like to do?
          </div>

          {/* ── Option 1 — Recreate / Wizard ── */}
          {!folderEmpty && (
            <label
              className={
                "block rounded border px-3 py-2 cursor-pointer transition-colors " +
                (option === "recreate"
                  ? "border-blue-500 bg-blue-950/20"
                  : "border-zinc-700 hover:border-zinc-600")
              }
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="missing-option"
                  checked={option === "recreate"}
                  onChange={() => setOption("recreate")}
                  disabled={submitting || !!optionOneBlocked}
                  className="mt-0.5 accent-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-zinc-200 font-medium">Recreate the .craidd at this path</div>
                  <div className="text-zinc-500 text-[11px] leading-4 mt-0.5">
                    A fresh marker will be written at{" "}
                    <span className="font-mono">{project.path}</span>.
                    {folderSuggestion?.evidence && (
                      <span className="text-zinc-600"> Detected: {folderSuggestion.evidence}.</span>
                    )}
                  </div>

                  {option === "recreate" && (
                    <div className="mt-2 space-y-2">
                      <label className="block">
                        <div className="text-zinc-400 mb-1">Project name</div>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          disabled={submitting}
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
                      {optionOneBlocked && (
                        <div className="text-[11px] text-red-400 bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
                          {optionOneBlocked}
                          <div className="text-zinc-500 mt-1">
                            Pick a different language, or use Option 2 or Option 3.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </label>
          )}

          {/* Empty folder — wizard option appears first */}
          {folderEmpty && (
            <label
              className={
                "block rounded border px-3 py-2 cursor-pointer transition-colors " +
                (option === "recreate"
                  ? "border-blue-500 bg-blue-950/20"
                  : "border-zinc-700 hover:border-zinc-600")
              }
            >
              <div className="flex items-start gap-2">
                <input
                  type="radio"
                  name="missing-option"
                  checked={option === "recreate"}
                  onChange={() => setOption("recreate")}
                  disabled={submitting}
                  className="mt-0.5 accent-blue-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-zinc-200 font-medium">Open the New Project wizard here</div>
                  <div className="text-zinc-500 text-[11px] leading-4 mt-0.5">
                    This folder is empty. A new project will be declared here. Templates
                    and scaffolding arrive in Phase 2.5 — for now this writes the marker.
                  </div>
                  {option === "recreate" && (
                    <div className="mt-2 space-y-2">
                      <label className="block">
                        <div className="text-zinc-400 mb-1">Project name</div>
                        <input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          disabled={submitting}
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
                    </div>
                  )}
                </div>
              </div>
            </label>
          )}

          {/* ── Option 2 — Repoint ── */}
          <label
            className={
              "block rounded border px-3 py-2 cursor-pointer transition-colors " +
              (option === "repoint"
                ? "border-blue-500 bg-blue-950/20"
                : "border-zinc-700 hover:border-zinc-600")
            }
          >
            <div className="flex items-start gap-2">
              <input
                type="radio"
                name="missing-option"
                checked={option === "repoint"}
                onChange={() => setOption("repoint")}
                disabled={submitting}
                className="mt-0.5 accent-blue-600"
              />
              <div className="min-w-0 flex-1">
                <div className="text-zinc-200 font-medium">Point to an existing .craidd somewhere else</div>
                <div className="text-zinc-500 text-[11px] leading-4 mt-0.5">
                  Choose a .craidd file. The solution will reference it.
                </div>

                {option === "repoint" && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={browseCraidd}
                        disabled={submitting}
                        className="px-2.5 py-1 rounded text-[11px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                      >
                        Browse for .craidd…
                      </button>
                      <span className="text-[11px] text-zinc-500 truncate font-mono">
                        {chosenCraidd ?? "(none chosen)"}
                      </span>
                    </div>
                    {craiddError && (
                      <div className="text-[11px] text-red-400 bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
                        {craiddError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </label>

          {/* ── Option 3 — Move ── */}
          <label
            className={
              "block rounded border px-3 py-2 cursor-pointer transition-colors " +
              (option === "move"
                ? "border-blue-500 bg-blue-950/20"
                : "border-zinc-700 hover:border-zinc-600")
            }
          >
            <div className="flex items-start gap-2">
              <input
                type="radio"
                name="missing-option"
                checked={option === "move"}
                onChange={() => setOption("move")}
                disabled={submitting}
                className="mt-0.5 accent-blue-600"
              />
              <div className="min-w-0 flex-1">
                <div className="text-zinc-200 font-medium">Move this project to a folder</div>
                <div className="text-zinc-500 text-[11px] leading-4 mt-0.5">
                  Choose a folder. If it has a matching marker, that marker is used. If not, one is written.
                </div>

                {option === "move" && (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={browseFolder}
                        disabled={submitting}
                        className="px-2.5 py-1 rounded text-[11px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                      >
                        Browse for folder…
                      </button>
                      <span className="text-[11px] text-zinc-500 truncate font-mono">
                        {chosenFolder ?? "(none chosen)"}
                      </span>
                    </div>
                    {folderScanning && (
                      <div className="text-[11px] text-zinc-500 italic">Scanning…</div>
                    )}
                    {folderSuggestion && !folderError && (
                      <div className="text-[11px] text-zinc-400 bg-zinc-950/40 border border-zinc-800 rounded px-2 py-1.5">
                        No marker found. <span className="text-zinc-500">{folderSuggestion.evidence}</span>
                      </div>
                    )}
                    {folderError && (
                      <div className="text-[11px] text-red-400 bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
                        {folderError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </label>

          <div className="border-t border-zinc-800 pt-3 text-[11px] text-zinc-500 leading-4">
            This project is no longer needed —{" "}
            <button
              type="button"
              onClick={doRemove}
              disabled={submitting}
              className="text-yellow-400 hover:text-yellow-300 disabled:opacity-50"
            >
              remove it from the solution
            </button>
            .
          </div>

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? "Working…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toRel(abs: string, root: string): string {
  const rootNoSlash = root.replace(/\/+$/, "");
  return abs.startsWith(rootNoSlash + "/") ? abs.slice(rootNoSlash.length + 1) : abs;
}
