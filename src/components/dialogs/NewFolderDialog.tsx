import { useState } from "react";
import { useSolution } from "../../store/solutionStore";

interface Props {
  parentPath: string;
  onClose: () => void;
}

export default function NewFolderDialog({ parentPath, onClose }: Props) {
  const createFolder = useSolution((s) => s.createFolder);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await createFolder(parentPath, trimmed);
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
        className="w-[440px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          New Folder
        </div>

        <div className="px-4 py-4 space-y-3 text-xs">
          <div className="text-zinc-500">
            In: <span className="text-zinc-300 font-mono">{parentPath}</span>
          </div>

          <label className="block">
            <div className="text-zinc-400 mb-1">Folder name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
              placeholder="components"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </label>

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
