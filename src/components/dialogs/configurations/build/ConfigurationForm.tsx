import { useMemo } from "react";
import type { ConfigEntry } from "../../../../types/project";
import { useSolution } from "../../../../store/solutionStore";
import UniversalSection from "./sections/UniversalSection";
import CommonSection from "./sections/CommonSection";
import MethodSection from "./sections/MethodSection";
import CommandPreview from "./CommandPreview";

interface Props {
  config: ConfigEntry;
}

export default function ConfigurationForm({ config }: Props) {
  const solution = useSolution((s) => s.solution);

  const targetProject = useMemo(() => {
    if (!solution) return null;
    if (config.target === ".") return null;
    return solution.projects.find((p) => p.path === config.target) ?? null;
  }, [solution, config.target]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-5 py-3 border-b border-zinc-800 flex items-center gap-3">
        <span className="text-[13px] text-zinc-100 font-medium truncate">
          {config.name || "(unnamed)"}
        </span>
        <span className="text-[10.5px] text-zinc-500">{config.kind}</span>
        {config.origin === "inferred" && (
          <span className="text-[10px] uppercase tracking-wide text-zinc-600 border border-zinc-700 rounded px-1.5 py-[1px]">
            inferred by IDE
          </span>
        )}
        {targetProject && (
          <span className="text-[10.5px] text-zinc-500 truncate ml-auto">
            target: {targetProject.name}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
        <Section title="Universal">
          <UniversalSection config={config} />
        </Section>
        <Section title="Common">
          <CommonSection config={config} />
        </Section>
        <Section title={methodTitle(config.method)}>
          <MethodSection config={config} />
        </Section>
      </div>

      <CommandPreview config={config} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-zinc-800 last:border-b-0">
      <div className="text-[10.5px] uppercase tracking-wider text-zinc-500 mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}

function methodTitle(method: string | undefined): string {
  if (!method) return "Method";
  const labels: Record<string, string> = {
    cargo: "cargo",
    npm: "npm",
    dotnet: "dotnet",
    cmake: "cmake",
    shell: "shell",
    composed: "composed",
    python: "python",
  };
  return labels[method] ?? method;
}
