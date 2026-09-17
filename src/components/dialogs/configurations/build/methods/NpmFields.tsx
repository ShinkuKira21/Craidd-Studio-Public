import type { ConfigEntry } from "../../../../../types/project";
import { useSolution } from "../../../../../store/solutionStore";
import InheritedField from "../InheritedField";

export default function NpmFields({ config }: { config: ConfigEntry }) {
  const solution = useSolution((s) => s.solution);
  const project = solution?.projects.find((p) => p.path === config.target);
  const pkg = project?.manifests?.find((m) => m.kind === "npm");

  const scripts = (pkg?.values?.scripts as Record<string, string> | undefined) ?? {};
  const scriptNames = Object.keys(scripts);
  const currentScript =
    scriptNames.find((s) => s === "dev") ??
    scriptNames.find((s) => s === "start") ??
    scriptNames[0] ??
    "—";

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <span className="w-28 shrink-0 text-[12px] text-zinc-400">Script</span>
        <div className="flex-1 min-w-0">
          <input
            value={currentScript}
            readOnly
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300"
          />
          {scriptNames.length > 0 && (
            <div className="mt-1 text-[10.5px] text-zinc-600">
              scripts: {scriptNames.join(" · ")}
            </div>
          )}
        </div>
      </div>

      <InheritedField
        label="Pkg manager"
        value="pnpm"
        source="from preferences"
      />
      <InheritedField
        label="Node"
        value="node 20.11.0"
        source="from preferences"
      />
    </div>
  );
}
