import { memo, useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild, syncMainChoices, selectConfiguration } from "../../store/buildStore";
import type { ConfigEntry, CraiddProject } from "../../types/project";
import ConfigurationsDialog from "../dialogs/configurations/ConfigurationsDialog";

type Kind = "build" | "run" | "debug";

const KIND_ICON: Record<Kind, string> = { build: "🔨", run: "▶", debug: "🐛" };
const KIND_TITLE: Record<Kind, string> = { build: "Build", run: "Run", debug: "Debug" };

function Toolbar() {
  const solution = useSolution((s) => s.solution);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const selectedProfileName = useBuild((s) => s.selectedProfileName);
  const setSelectedProfile = useBuild((s) => s.setSelectedProfile);
  const status = useBuild((s) => s.status);
  const activeConfigName = useBuild((s) => s.activeConfigName);
  const start = useBuild((s) => s.start);
  const stop = useBuild((s) => s.stop);
  const [dialogOpen, setDialogOpen] = useState(false);

  const configs: ConfigEntry[] = [
    ...(solution?.inferredConfigs ?? []),
    ...(solution?.configs ?? []),
  ];

  useEffect(() => {
    if (solution) syncMainChoices(solution);
  }, [solution]);

  const running = status === "starting" || status === "running";
  const selectedConfig = configs.find((config) => config.name === selectedConfigName);

  const onChipSelect = (name: string) => {
    if (solution) selectConfiguration(solution, name);
  };

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-1.5 shrink-0 text-xs">
      <KindButton kind="build" configs={configs} running={running}
                  onFire={(name) => void start("build", name)} />

      <ConfigChip
        hasSolution={!!solution}
        projects={solution?.projects ?? []}
        configs={configs}
        selectedName={selectedConfigName}
        onSelect={onChipSelect}
        onOpenDialog={() => setDialogOpen(true)}
      />

      {selectedConfig && (selectedConfig.profiles?.length ?? 0) > 0 && (
        <ProfileChip
          config={selectedConfig}
          selectedName={selectedProfileName}
          onSelect={setSelectedProfile}
          disabled={running}
        />
      )}

      <KindButton kind="run" configs={configs} running={running}
                  onFire={(name) => void start("run", name)} />

      <button
        title={running ? "Stop (Shift+F5)" : "Nothing is running"}
        disabled={!running}
        onClick={() => void stop()}
        className={
          "w-8 h-8 flex items-center justify-center rounded text-[14px] transition-colors " +
          (running ? "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                   : "text-zinc-600 cursor-default")
        }
      >⏹</button>

      <KindButton kind="debug" configs={configs} running={running}
                  onFire={(name) => void start("debug", name)} />

      <div className="ml-auto text-zinc-500 text-[11px] truncate max-w-[280px]">
        {running && activeConfigName ? (
          <>
            <span className="text-zinc-400">{activeConfigName}</span>
            <span className="text-zinc-600"> · </span>
            <span>{status}</span>
          </>
        ) : (
          <span>{status}</span>
        )}
      </div>

      {dialogOpen && (
        <ConfigurationsDialog onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

function ProfileChip({
  config, selectedName, onSelect, disabled,
}: {
  config: ConfigEntry;
  selectedName: string | null;
  onSelect: (name: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const profiles = config.profiles ?? [];
  const current = profiles.find((profile) => profile.name === selectedName)
    ?? profiles.find((profile) => profile.name === config.defaultProfile)
    ?? profiles[0];

  return (
    <div className="relative">
      <button
        type="button"
        title={`Build profile for ${config.name}: ${current.name}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="h-8 px-2.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/40 disabled:opacity-50 disabled:cursor-default flex items-center gap-2 text-[12px]"
      >
        <span className="text-zinc-500">Profile</span>
        <span>{current.name}</span>
        <span className="text-zinc-500">▾</span>
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 z-50 text-xs">
            {profiles.map((profile) => (
              <button
                key={profile.name}
                type="button"
                onClick={() => { onSelect(profile.name); setOpen(false); }}
                className={"w-full px-3 py-1.5 text-left " +
                  (profile.name === current.name
                    ? "bg-blue-900/40 text-zinc-100"
                    : "text-zinc-200 hover:bg-blue-700 hover:text-white")}
              >{profile.name}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function KindButton({
  kind, configs, running, onFire,
}: {
  kind: Kind;
  configs: ConfigEntry[];
  running: boolean;
  onFire: (name: string) => void;
}) {
  const mainChoice = useBuild((s) => s.mainChoices[kind]);
  const [open, setOpen] = useState(false);

  const candidates = configs.filter((c) => c.kind === kind);
  const has = candidates.length > 0;
  const multi = candidates.length > 1;

  const chosen = candidates.find((c) => c.name === mainChoice) ?? null;
  const disabled = !has || running || !chosen;

  const disabledReason = !has
    ? `${KIND_TITLE[kind]} — no ${kind} configurations`
    : running
    ? "A run is already active"
    : !chosen
    ? `No default ${kind} configuration`
    : "";

  return (
    <div className="relative">
      <button
        title={disabled ? disabledReason : `${KIND_TITLE[kind]} — ${chosen?.name}`}
        disabled={disabled}
        onClick={() => chosen && onFire(chosen.name)}
        className={
          "w-8 h-8 flex items-center justify-center rounded text-[14px] transition-colors " +
          (disabled ? "text-zinc-600 cursor-default"
                    : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100")
        }
      >{KIND_ICON[kind]}</button>

      {(multi || (has && !chosen)) && !running && (
        <button
          title={`Other ${kind} configurations`}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-0 bottom-0 w-3 h-3 flex items-center justify-center text-[8px] text-zinc-500 hover:text-zinc-200 rounded"
        >▾</button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 min-w-[260px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 z-50 text-xs">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-600">
              {KIND_TITLE[kind]}
            </div>
            {candidates.map((c) => {
              const isMain = c.name === chosen?.name;
              return (
                <button
                  key={c.name}
                  onClick={() => { onFire(c.name); setOpen(false); }}
                  className={
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] " +
                    (isMain ? "text-zinc-100"
                            : "text-zinc-300 hover:bg-blue-700 hover:text-white")
                  }
                >
                  <span className="truncate flex-1">{c.name}</span>
                  {isMain && <span className="text-[10px] text-zinc-500 shrink-0">default</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ConfigChip({
  hasSolution, projects, configs, selectedName, onSelect, onOpenDialog,
}: {
  hasSolution: boolean;
  projects: CraiddProject[];
  configs: ConfigEntry[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onOpenDialog: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const selected = configs.find((config) => config.name === selectedName);
  const bestFits = configs.filter((config) => config.bestFit);
  const projectGroups = projects.map((project) => ({
    key: `project:${project.path}`,
    label: project.name,
    configs: configs.filter((config) => config.target === project.path && !config.bestFit),
  })).filter((group) => group.configs.length > 0);
  const solutionConfigs = configs.filter((config) => config.target === "." && !config.bestFit);
  const groups = [
    ...bestFits.map((config) => ({ key: `best:${config.name}`, label: config.name, configs: [config] })),
    ...projectGroups,
    ...(solutionConfigs.length > 0 ? [{ key: "solution", label: "Solution", configs: solutionConfigs }] : []),
  ];
  const selectedKey = selected?.bestFit ? `best:${selected.name}`
    : selected?.target === "." ? "solution"
    : selected ? `project:${selected.target}` : null;
  const preview = groups.find((group) => group.key === previewKey)
    ?? groups.find((group) => group.key === selectedKey)
    ?? groups[0];
  const selectedProject = projects.find((project) => project.path === selected?.target);
  const label = !hasSolution ? "No solution"
    : selected?.bestFit ? selected.name
    : selectedProject?.name ?? selected?.name ?? "No configurations";
  const chooseGroup = (group: typeof groups[number]) => {
    const preferred = group.configs.find((config) => config.kind === "run" && config.origin === "user")
      ?? group.configs.find((config) => config.kind === "run")
      ?? group.configs.find((config) => config.kind === "build" && config.origin === "user")
      ?? group.configs.find((config) => config.kind === "build")
      ?? group.configs[0];
    if (preferred) onSelect(preferred.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => hasSolution && configs.length > 0 && setOpen((v) => !v)}
        disabled={!hasSolution}
        className={
          "h-8 px-3 rounded flex items-center gap-2 border text-[12px] transition-colors " +
          (hasSolution ? "border-zinc-700 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/40"
                       : "border-zinc-800 text-zinc-600 cursor-default")
        }
      >
        <span className="truncate max-w-[260px]">{label}</span>
        <svg className={"w-3 h-3 shrink-0 text-zinc-500 transition-transform " + (open ? "rotate-180" : "")}
             fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-[min(560px,calc(100vw-24px))] bg-zinc-900 border border-zinc-700 rounded shadow-2xl z-50 text-xs overflow-hidden">
            {groups.length > 0 && (
              <div className="flex min-h-[170px] max-h-[min(360px,60vh)]">
                <div className="w-[42%] min-w-0 overflow-y-auto scroll-thin border-r border-zinc-800 py-1">
                  {bestFits.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">Solution best fit</div>}
                  {groups.map((group, index) => (
                    <div key={group.key}>
                      {index === bestFits.length && projectGroups.length > 0 &&
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">Projects</div>}
                      <button
                        type="button"
                        onMouseEnter={() => setPreviewKey(group.key)}
                        onFocus={() => setPreviewKey(group.key)}
                        onClick={() => chooseGroup(group)}
                        className={"w-full px-3 py-2 text-left flex items-center gap-2 hover:bg-zinc-800 " +
                          (group.key === selectedKey ? "border-l-2 border-blue-500 bg-blue-950/25 text-zinc-100" : "border-l-2 border-transparent text-zinc-300")}
                      >
                        <span className="truncate flex-1">{group.label}</span>
                        {group.key === selectedKey && <span className="text-blue-400">✓</span>}
                        <span className="text-zinc-600">›</span>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0 overflow-y-auto scroll-thin p-3">
                  <div className="text-zinc-200 font-medium truncate">{preview?.label}</div>
                  <div className="mt-0.5 text-[10px] text-zinc-500">{preview?.key.startsWith("best:") ? "Inferred from this solution" : "Choose a project or configuration"}</div>
                  {preview?.configs[0]?.bestFit && (preview.configs[0].relatedProjects?.length ?? 0) > 0 && (
                    <div className="mt-1 text-[10px] text-zinc-500 truncate">
                      {preview.configs[0].relatedProjects?.map((path) => projects.find((project) => project.path === path)?.name ?? path).join(" + ")}
                    </div>
                  )}
                  <div className="mt-3 space-y-1">
                    {preview?.configs.map((config) => (
                      <button
                        type="button"
                        key={`${config.origin}:${config.name}`}
                        onClick={() => { onSelect(config.name); setOpen(false); }}
                        className="w-full rounded px-2 py-1.5 text-left hover:bg-zinc-800 flex gap-3"
                      >
                        <span className="text-[10px] text-zinc-500 uppercase w-11 shrink-0 pt-0.5">{config.kind}</span>
                        <span className="min-w-0">
                          <span className="block text-zinc-200 truncate">{config.name}</span>
                          <span className="block text-[10px] text-zinc-500 truncate">{config.command ?? config.method ?? "Configured action"}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {configs.length === 0 && hasSolution && (
              <div className="px-3 py-2 text-[11.5px] text-zinc-500 italic">
                No configurations inferred.
                <br />
                Open the dialog to add one.
              </div>
            )}
            <div className="h-px bg-zinc-800" />
            <button
              onClick={() => { onOpenDialog(); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >Add / Edit Configurations…</button>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(Toolbar);
