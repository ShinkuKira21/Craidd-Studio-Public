import type { ConfigEntry } from "../../../../../types/project";

export default function ShellFields({ config }: { config: ConfigEntry }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-[12px] text-zinc-400">Command</span>
        <div className="flex-1 min-w-0">
          <input
            value={config.command ?? ""}
            readOnly
            placeholder="g++ main.cpp -o main"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] font-mono text-zinc-300 placeholder:text-zinc-700"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-[12px] text-zinc-400">Shell</span>
        <div className="flex-1 min-w-0 text-[12px] text-zinc-400">
          <span className="inline-flex items-center gap-3">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked readOnly className="accent-blue-600" />
              direct exec
            </label>
            <label className="flex items-center gap-1.5 opacity-60">
              <input type="radio" disabled className="accent-blue-600" />
              via /bin/sh
            </label>
          </span>
        </div>
      </div>
      <div className="pl-28 text-[11px] text-zinc-600 leading-4">
        Shell method has no manifest to read. The command is exactly what
        the user wrote.
      </div>
    </div>
  );
}
