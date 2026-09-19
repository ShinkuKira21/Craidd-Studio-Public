import { useMemo } from "react";
import type { ConfigEntry } from "../../../../types/project";
import { useBuild } from "../../../../store/buildStore";

/**
 * "Will run" preview. Renders the resolved command for this Configuration.
 * In this push, the resolution is:
 *   1. If `config.command` is set → that.
 *   2. Else, a best-effort composition from method + profile + args.
 * Nothing is executed — this is a display string.
 */
export default function CommandPreview({ config }: { config: ConfigEntry }) {
  const selectedProfileName = useBuild((state) => state.selectedProfileName);
  const line = useMemo(() => resolve(config, selectedProfileName), [config, selectedProfileName]);
  return (
    <div className="px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 shrink-0">
      <div className="text-[10.5px] uppercase tracking-wider text-zinc-600 mb-1.5">
        Will run
      </div>
      <div className="font-mono text-[12px] text-zinc-300 truncate">
        {line ? `$  ${line}` : <span className="text-zinc-600 italic">(no command resolved yet)</span>}
      </div>
    </div>
  );
}

function resolve(config: ConfigEntry, selectedProfileName: string | null): string {
  const profiles = config.profiles ?? [];
  const profile = profiles.find((entry) => entry.name === selectedProfileName)
    ?? profiles.find((entry) => entry.name === config.defaultProfile)
    ?? profiles[0];
  const args = profile?.args ?? [];
  const argStr = args.join(" ");
  if (config.command && config.command.trim().length > 0) {
    return `${config.command.trim()}${argStr ? " " + argStr : ""}`;
  }
  const method = config.method ?? "";

  switch (method) {
    case "cargo":
      return `cargo ${config.kind === "run" ? "run" : "build"}${argStr ? " " + argStr : ""}`;
    case "npm":
      return `npm run ${argStr || "dev"}`;
    case "dotnet":
      return `dotnet ${config.kind === "run" ? "run" : "build"}${argStr ? " " + argStr : ""}`;
    case "cmake":
      return `cmake --build build${argStr ? " " + argStr : ""}`;
    case "shell":
      return argStr || "(shell command not set)";
    case "composed":
      return "(composed — step list)";
    case "python":
      return `python3 main.py${argStr ? " " + argStr : ""}`;
    default:
      return "";
  }
}
