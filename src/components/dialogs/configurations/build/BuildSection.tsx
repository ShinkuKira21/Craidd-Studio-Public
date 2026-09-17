import { useMemo, useState } from "react";
import { useSolution } from "../../../../store/solutionStore";
import type { ConfigEntry } from "../../../../types/project";
import ConfigurationTree from "./ConfigurationTree";
import ConfigurationForm from "./ConfigurationForm";
import { emptyConfigForProject } from "./constants";

export default function BuildSection() {
  const solution = useSolution((s) => s.solution);

  // Local-only list of configurations the user has added or duplicated
  // during this dialog session. Nothing is written to .cln in this push.
  const [localConfigs, setLocalConfigs] = useState<ConfigEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const allConfigs = useMemo(() => {
    if (!solution) return [];
    // Order: solution-level first, then per-project in declaration order.
    const inferred = solution.inferredConfigs ?? [];
    const user = solution.configs ?? [];
    // Local additions come last.
    return [...inferred, ...user, ...localConfigs];
  }, [solution, localConfigs]);

  const selectedConfig = useMemo(() => {
    if (!selectedKey) return allConfigs[0] ?? null;
    return allConfigs.find((c) => keyOf(c) === selectedKey) ?? allConfigs[0] ?? null;
  }, [allConfigs, selectedKey]);

  const onAdd = () => {
    const target = solution?.projects[0]?.path ?? ".";
    const next = emptyConfigForProject(target);
    setLocalConfigs((prev) => [...prev, next]);
    setSelectedKey(keyOf(next));
  };

  const onDuplicate = () => {
    if (!selectedConfig) return;
    const copy: ConfigEntry = {
      ...selectedConfig,
      name: `${selectedConfig.name} (copy)`,
      origin: "user",
    };
    setLocalConfigs((prev) => [...prev, copy]);
    setSelectedKey(keyOf(copy));
  };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="w-64 shrink-0 border-r border-zinc-800 flex flex-col">
        <ConfigurationTree
          configs={allConfigs}
          selectedKey={selectedConfig ? keyOf(selectedConfig) : null}
          onSelect={setSelectedKey}
          onAdd={onAdd}
          onDuplicate={onDuplicate}
        />
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {selectedConfig ? (
          <ConfigurationForm config={selectedConfig} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] text-zinc-600 italic px-6 text-center leading-5">
            No configurations yet.
            <br />
            Select <span className="text-zinc-400">[+ New]</span> to create one.
          </div>
        )}
      </div>
    </div>
  );
}

/** Stable key for a ConfigEntry. Name is the identity in .cln; two
 *  entries with the same name would collide, but the tree shows them
 *  as separate rows anyway (bad data, visible). */
export function keyOf(c: ConfigEntry): string {
  return `${c.origin}\u0000${c.name}`;
}
