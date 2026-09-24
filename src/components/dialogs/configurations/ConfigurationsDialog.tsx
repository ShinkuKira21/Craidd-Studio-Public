import { useMemo, useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import type { ConfigEntry, CraiddProject } from "../../../types/project";
import ConfigurationForm from "./ConfigurationForm";

interface Props {
  onClose: () => void;
}

type Row =
  | { kind: "composition"; entry: ConfigEntry }
  | { kind: "project-header"; project: CraiddProject | null; key: string; label: string }
  | { kind: "project-config"; entry: ConfigEntry; project: CraiddProject | null };

export default function ConfigurationsDialog({ onClose }: Props) {
  const solution = useSolution((s) => s.solution);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const configs: ConfigEntry[] = useMemo(() => [
    ...(solution?.inferredConfigs ?? []),
    ...(solution?.configs ?? []),
  ], [solution]);

  const projects = solution?.projects ?? [];

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const compositions = configs.filter((c) => c.bestFit && c.kind === "run");
    for (const c of compositions) {
      out.push({ kind: "composition", entry: c });
    }
    const byTarget = new Map<string, ConfigEntry[]>();
    for (const c of configs.filter((c) => !c.bestFit)) {
      const list = byTarget.get(c.target) ?? [];
      list.push(c);
      byTarget.set(c.target, list);
    }
    // Projects in solution order.
    for (const project of projects) {
      const list = byTarget.get(project.path) ?? [];
      if (list.length === 0) continue;
      out.push({ kind: "project-header", project, key: `ph:${project.path}`, label: project.name });
      for (const c of list) {
        out.push({ kind: "project-config", entry: c, project });
      }
    }
    // Any configs whose target isn't a declared project.
    for (const c of configs.filter((c) => !c.bestFit)) {
      if (!projects.some((p) => p.path === c.target)) {
        out.push({ kind: "project-config", entry: c, project: null });
      }
    }
    return out;
  }, [configs, projects]);

  const effectiveSelected = configs.find((c) => c.name === selectedName)
    ?? configs.find((c) => c.bestFit)
    ?? configs[0];

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(1040px,calc(100vw-32px))] h-[min(680px,calc(100vh-32px))] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 shrink-0">
          <span className="text-sm text-zinc-100 font-medium">Configurations</span>
          <span className="text-[11px] text-zinc-500 max-[700px]:hidden">
            What the IDE sees, and how this solution runs
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-zinc-500 hover:text-zinc-200 text-lg leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 min-h-0 flex max-[700px]:flex-col">
          <div className="w-[min(340px,40%)] shrink-0 border-r border-zinc-800 overflow-y-auto scroll-thin py-2 max-[700px]:w-full max-[700px]:h-[35%] max-[700px]:border-r-0 max-[700px]:border-b">
            {rows.length === 0 && (
              <div className="px-4 py-6 text-[12px] text-zinc-600 italic">
                No configurations. Inference produced nothing, and the solution has no user-authored entries.
              </div>
            )}
            {rows.map((row, index) => {
              if (row.kind === "project-header") {
                return (
                  <div
                    key={row.key}
                    className={
                      "px-4 pb-1 text-[10px] uppercase tracking-wider text-zinc-600 " +
                      (index === 0 ? "pt-1" : "pt-4")
                    }
                  >
                    {row.label}
                  </div>
                );
              }
              const c = row.entry;
              const isSelected = c.name === effectiveSelected?.name;
              return (
                <button
                  key={`${row.kind}:${c.name}`}
                  onClick={() => setSelectedName(c.name)}
                  className={
                    "w-full flex items-center gap-2 px-4 py-1.5 text-left text-[12.5px] transition-colors " +
                    (isSelected
                      ? "bg-blue-950/40 text-zinc-100 border-l-2 border-l-blue-500"
                      : "text-zinc-300 hover:bg-zinc-800/60 border-l-2 border-l-transparent")
                  }
                >
                  <span className={
                    "w-2 shrink-0 text-[8px] " +
                    (row.kind === "composition" ? "text-blue-400" : "text-transparent")
                  }>●</span>
                  <span className="truncate flex-1">{c.name}</span>
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    {row.kind === "composition" ? "solution" : c.kind}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            {effectiveSelected ? (
              <ConfigurationForm
                config={effectiveSelected}
                projects={projects}
                allConfigs={configs}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-zinc-600 italic">
                Nothing selected.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
