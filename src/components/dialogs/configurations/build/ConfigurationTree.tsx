import { useMemo } from "react";
import type { ConfigEntry } from "../../../../types/project";
import { useSolution } from "../../../../store/solutionStore";
import { keyOf } from "./BuildSection";

interface Props {
  configs: ConfigEntry[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
}

interface Row {
  config: ConfigEntry;
  key: string;
  origin: "inferred" | "user";
  kind: string;
}

export default function ConfigurationTree({
  configs,
  selectedKey,
  onSelect,
  onAdd,
  onDuplicate,
}: Props) {
  const solution = useSolution((s) => s.solution);

  const rows: Row[] = useMemo(
    () =>
      configs.map((c) => ({
        config: c,
        key: keyOf(c),
        origin: (c.origin === "inferred" ? "inferred" : "user") as "inferred" | "user",
        kind: c.kind,
      })),
    [configs],
  );

  // Solution-level first, then group by target project.
  const solutionRows = rows.filter((r) => r.config.target === ".");
  const projectRows = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      if (r.config.target === ".") continue;
      const list = map.get(r.config.target) ?? [];
      list.push(r);
      map.set(r.config.target, list);
    }
    return map;
  }, [rows]);

  const projectName = (path: string): string =>
    solution?.projects.find((p) => p.path === path)?.name ?? path;

  return (
    <>
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-1">
        <span className="text-[11px] uppercase tracking-wide text-zinc-500">
          Configurations
        </span>
        <button
          onClick={onAdd}
          title="New configuration"
          className="ml-auto px-1.5 py-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 text-xs"
        >
          + New
        </button>
        <button
          onClick={onDuplicate}
          title="Duplicate"
          disabled={!selectedKey}
          className="px-1.5 py-0.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 text-xs disabled:opacity-40"
        >
          ⧉
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {solutionRows.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-600">
              Solution
            </div>
            {solutionRows.map((r) => (
              <ConfigRow
                key={r.key}
                row={r}
                active={r.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
          </>
        )}

        {Array.from(projectRows.entries()).map(([target, list]) => (
          <div key={target} className="mt-2">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-600 truncate">
              {projectName(target)}
            </div>
            {list.map((r) => (
              <ConfigRow
                key={r.key}
                row={r}
                active={r.key === selectedKey}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}

        {rows.length === 0 && (
          <div className="px-3 py-4 text-[11.5px] text-zinc-600 italic text-center leading-5">
            No configurations.
            <br />
            Use <span className="text-zinc-400">[+ New]</span> above.
          </div>
        )}
      </div>
    </>
  );
}

function ConfigRow({
  row,
  active,
  onSelect,
}: {
  row: Row;
  active: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(row.key)}
      className={
        "w-full text-left px-3 py-1 flex items-center gap-2 text-[12.5px] transition-colors " +
        (active
          ? "bg-zinc-800 text-zinc-100 border-l-2 border-l-blue-500"
          : "text-zinc-300 hover:bg-zinc-800/60 border-l-2 border-l-transparent")
      }
    >
      <span className="truncate flex-1">{row.config.name}</span>
      {row.origin === "inferred" && (
        <span
          title="Inferred by the IDE"
          className="text-[9.5px] uppercase tracking-wide text-zinc-600 border border-zinc-700 rounded px-1 py-[1px]"
        >
          auto
        </span>
      )}
      <span className="text-[10px] text-zinc-500 shrink-0">{row.kind}</span>
    </button>
  );
}
