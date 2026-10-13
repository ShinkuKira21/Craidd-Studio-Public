import { useEffect, useState } from "react";

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    void import("@tauri-apps/api/app").then(({ getVersion }) => getVersion()).then(setVersion).catch(() => setVersion(null));
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onMouseDown={onClose}>
    <div role="dialog" aria-label="About Craidd Studio" onMouseDown={(e) => e.stopPropagation()}
      className="w-[360px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-5 text-xs text-zinc-300">
      <h2 className="text-base font-semibold text-zinc-100">Craidd Studio</h2>
      <p className="mt-1 text-zinc-500">Alpha preview{version ? ` · v${version}` : ""} · Linux</p>
      <p className="mt-3 leading-5">A polyglot IDE. Projects in one solution, each running program in its own window.</p>
      <div className="mt-5 flex justify-end">
        <button type="button" autoFocus onClick={onClose} className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Close</button>
      </div>
    </div>
  </div>;
}
