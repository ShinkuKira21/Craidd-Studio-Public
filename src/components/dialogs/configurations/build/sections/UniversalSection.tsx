import type { ConfigEntry } from "../../../../../types/project";
import { useSolution } from "../../../../../store/solutionStore";
import { KINDS, METHODS } from "../constants";

export default function UniversalSection({ config }: { config: ConfigEntry }) {
  const solution = useSolution((s) => s.solution);
  const projects = solution?.projects ?? [];

  return (
    <div className="space-y-2.5">
      <Row label="Name">
        <input
          value={config.name}
          readOnly
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300"
        />
      </Row>
      <Row label="Kind">
        <select
          value={config.kind}
          disabled
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300"
        >
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Target">
        <select
          value={config.target}
          disabled
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300"
        >
          <option value=".">whole solution</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name} ({p.language ?? "?"})
            </option>
          ))}
        </select>
      </Row>
      <Row label="Method">
        <select
          value={config.method ?? ""}
          disabled
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-300"
        >
          <option value="">—</option>
          {METHODS.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.label}
              {!m.available ? " (coming)" : ""}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Working dir">
        <input
          value={config.cwd ?? "(default: target's folder)"}
          readOnly
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[12px] text-zinc-500 italic"
        />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[12px] text-zinc-400">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
