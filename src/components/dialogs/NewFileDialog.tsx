import { useMemo, useState } from "react";
import type { Language } from "../../types/project";
import { useSolution } from "../../store/solutionStore";

export type NewFileMode = "project" | "folder" | "raw";

interface Props {
  parentPath: string;
  projectLanguage?: Language | null;
  mode: NewFileMode;
  onClose: () => void;
}

interface Preset {
  label: string;
  ext: string;
}

function presetsFor(language: Language | null | undefined): Preset[] {
  if (!language) return [];
  switch (language) {
    case "rust":
      return [
        { label: "Rust source (.rs)", ext: "rs" },
        { label: "Cargo manifest (.toml)", ext: "toml" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "typescript":
      return [
        { label: "TypeScript (.ts)", ext: "ts" },
        { label: "React component (.tsx)", ext: "tsx" },
        { label: "JSON (.json)", ext: "json" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "javascript":
      return [
        { label: "JavaScript (.js)", ext: "js" },
        { label: "React component (.jsx)", ext: "jsx" },
        { label: "JSON (.json)", ext: "json" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "python":
      return [
        { label: "Python (.py)", ext: "py" },
        { label: "Requirements (.txt)", ext: "txt" },
        { label: "Python config (.toml)", ext: "toml" },
      ];
    case "cpp":
      return [
        { label: "C++ source (.cpp)", ext: "cpp" },
        { label: "C source (.c)", ext: "c" },
        { label: "C++ header (.hpp)", ext: "hpp" },
        { label: "C header (.h)", ext: "h" },
      ];
    case "csharp":
      return [
        { label: "C# source (.cs)", ext: "cs" },
        { label: "Project file (.csproj)", ext: "csproj" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "config":
      return [
        { label: "JSON (.json)", ext: "json" },
        { label: "TOML (.toml)", ext: "toml" },
        { label: "YAML (.yaml)", ext: "yaml" },
        { label: "INI (.ini)", ext: "ini" },
      ];
    default:
      return [];
  }
}

export default function NewFileDialog({
  parentPath,
  projectLanguage,
  mode,
  onClose,
}: Props) {
  const createFile = useSolution((s) => s.createFile);

  const [name, setName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = useMemo(
    () => (mode === "raw" ? [] : presetsFor(projectLanguage)),
    [mode, projectLanguage]
  );

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("File name is required.");
      return;
    }
    setSubmitting(true);
    try {
      let finalName = trimmed;
      if (presets.length > 0 && !trimmed.includes(".")) {
        finalName = `${trimmed}.${presets[selectedPreset].ext}`;
      }
      await createFile(parentPath, finalName, "");
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
        className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          New File
        </div>

        <div className="px-4 py-4 space-y-3 text-xs">
          <div className="text-zinc-500">
            In: <span className="text-zinc-300 font-mono">{parentPath}</span>
          </div>

          <label className="block">
            <div className="text-zinc-400 mb-1">File name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
              placeholder="main"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="text-zinc-600 mt-1">
              Type any extension you want. The presets below are optional.
            </div>
          </label>

          {presets.length > 0 && (
            <div className="block">
              <div className="text-zinc-400 mb-1">Presets</div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p, i) => (
                  <label
                    key={i}
                    className={
                      "px-2.5 py-1 rounded border cursor-pointer select-none transition-colors " +
                      (selectedPreset === i
                        ? "border-blue-500 bg-blue-950/40 text-zinc-100"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-600")
                    }
                  >
                    <input
                      type="radio"
                      name="preset"
                      className="hidden"
                      checked={selectedPreset === i}
                      onChange={() => setSelectedPreset(i)}
                      disabled={submitting}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
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
