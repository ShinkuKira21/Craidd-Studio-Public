import type { ConfigEntry, CraiddProject } from "../../../types/project";

interface Props {
  config: ConfigEntry;
  projects: CraiddProject[];
  allConfigs: ConfigEntry[];
}

/**
 * Read-only form. The editing surface lands in the next pass.
 *
 * The form's shape reflects the model:
 *   - Compositions (bestFit) show three slots (Run / Build / Debug), each
 *     a reference to another config in the solution.
 *   - Project configs show name, kind, command, cwd, and profiles.
 */
export default function ConfigurationForm({ config, projects, allConfigs }: Props) {
  const isComposition = config.bestFit === true;

  const familyMembers = isComposition
    ? allConfigs.filter((c) =>
        c.bestFit &&
        c.relatedProjects?.length === config.relatedProjects?.length &&
        c.relatedProjects?.every((p) => config.relatedProjects?.includes(p))
      )
    : [];

  const findFor = (kind: "build" | "run" | "debug") =>
    familyMembers.find((c) => c.kind === kind);

  const runSlot = isComposition ? findFor("run") : null;
  const buildSlot = isComposition ? findFor("build") : null;
  const debugSlot = isComposition ? findFor("debug") : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
      <div className="px-6 py-5 border-b border-zinc-800">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[15px] text-zinc-100 font-medium">{config.name}</h2>
          {isComposition && (
            <span className="text-[10px] uppercase tracking-wider text-blue-400 border border-blue-900/60 bg-blue-950/30 rounded px-1.5 py-0.5">
              solution
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 border border-zinc-800 rounded px-1.5 py-0.5">
            {config.origin}
          </span>
        </div>
        <p className="text-[11.5px] text-zinc-500 mt-1">
          {isComposition
            ? "A solution-level configuration that composes actions from multiple projects."
            : `Owned by ${projects.find((p) => p.path === config.target)?.name ?? "an external project"}.`}
        </p>
      </div>

      {isComposition ? (
        <div className="px-6 py-5 space-y-5">
          <SectionLabel>Slots</SectionLabel>
          <SlotRow label="Run" config={runSlot} projects={projects} />
          <SlotRow label="Build" config={buildSlot} projects={projects} />
          <SlotRow label="Debug" config={debugSlot} projects={projects} />
          <div className="text-[11px] text-zinc-600 leading-5 pt-2 border-t border-zinc-800">
            Each slot references a configuration owned by a project. Changing a slot repoints it;
            it does not copy the command.
          </div>
        </div>
      ) : (
        <div className="px-6 py-5 space-y-4">
          <Field label="Project" value={projects.find((p) => p.path === config.target)?.name ?? "(external)"} />
          <Field label="Kind" value={config.kind} />
          <Field label="Target" value={config.target} mono />
          <Field label="Method" value={config.method ?? "(none)"} />
          <Field label="Command" value={config.command ?? "(derived from method)"} mono />
          <Field label="Working directory" value={config.cwd ?? "(project root)"} mono />
          {config.profiles && config.profiles.length > 0 && (
            <div>
              <SectionLabel>Profiles</SectionLabel>
              <div className="space-y-1.5">
                {config.profiles.map((profile) => (
                  <div key={profile.name} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-zinc-200">{profile.name}</span>
                    {profile.name === config.defaultProfile && (
                      <span className="text-[10px] text-zinc-500">default</span>
                    )}
                    {profile.args.length > 0 && (
                      <span className="text-zinc-500 text-[11px] font-mono truncate">
                        {profile.args.join(" ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-wider text-zinc-500">
      {children}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 text-[12px] items-baseline">
      <div className="text-zinc-500">{label}</div>
      <div className={mono ? "text-zinc-200 font-mono text-[11.5px] break-all" : "text-zinc-200"}>
        {value}
      </div>
    </div>
  );
}

function SlotRow({
  label, config, projects,
}: {
  label: string;
  config: ConfigEntry | null | undefined;
  projects: CraiddProject[];
}) {
  if (!config) {
    return (
      <div className="grid grid-cols-[80px_1fr] gap-3 text-[12px] items-baseline">
        <div className="text-zinc-500">{label}</div>
        <div className="text-zinc-600 italic">(no configuration)</div>
      </div>
    );
  }
  const projectName = projects.find((p) => p.path === config.target)?.name ?? "(external)";
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 text-[12px] items-baseline">
      <div className="text-zinc-500">{label}</div>
      <div className="min-w-0">
        <div className="text-zinc-200 truncate">{config.name}</div>
        <div className="text-[11px] text-zinc-500 font-mono truncate">
          {projectName} · {config.command ?? config.method ?? "—"}
        </div>
      </div>
    </div>
  );
}
