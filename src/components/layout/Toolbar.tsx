import { memo, useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild, syncMainChoices, selectConfiguration } from "../../store/buildStore";
import type { ConfigEntry, CraiddProject } from "../../types/project";
import ConfigurationsDialog from "../dialogs/configurations/ConfigurationsDialog";
import { useLinkedWindows, startLinkedAction, stopLinkedAction, type LinkedSnapshot } from "../../store/linkedWindowsStore";
import WindowManager from "./WindowManager";
import { useDebug } from "../../store/debugStore";

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
  const linked = useLinkedWindows();
  const debugStatus = useDebug((s) => s.status);
  const debugControl = useDebug((s) => s.control);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Gold owns the group; white owns this window. They never share a control.

  const configs: ConfigEntry[] = [
    ...(solution?.inferredConfigs ?? []),
    ...(solution?.configs ?? []),
  ];

  useEffect(() => {
    if (solution) syncMainChoices(solution);
  }, [solution]);

  const localStatus = ["building", "running", "paused"].includes(debugStatus) ? debugStatus : status;
  const running = localStatus === "starting" || localStatus === "running" || localStatus === "paused";
  const selectedConfig = configs.find((config) => config.name === selectedConfigName);
  const stopLocal = () => ["building", "running", "paused"].includes(debugStatus) ? debugControl("stop") : stop();

  const onChipSelect = (name: string) => {
    if (solution) selectConfiguration(solution, name);
  };

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-1.5 shrink-0 text-xs">
      <KindButton kind="build" configs={configs} running={running} onFire={(name) => void start("build", name)} />
      {(linked.linked || linked.activeAction) && <GoldButton kind="build" linked={linked} />}

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

      <KindButton kind="run" configs={configs} running={running} onFire={(name) => void start("run", name)} />
      {(linked.linked || linked.activeAction) && <GoldButton kind="run" linked={linked} />}

      <button
        title={running ? "Stop (Shift+F5)" : "Nothing is running"}
        disabled={!running}
        onClick={() => void stopLocal()}
        className={
          "w-8 h-8 flex items-center justify-center rounded text-[14px] transition-colors " +
          (running ? "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                   : "text-zinc-600 cursor-default")
        }
      >⏹</button>

      <KindButton kind="debug" configs={configs} running={running} onFire={(name) => void start("debug", name)} />
      {(linked.linked || linked.activeAction) && <GoldButton kind="debug" linked={linked} />}
      {(debugStatus === "paused" || debugStatus === "running") && <div className="flex items-center gap-0.5 border-l border-zinc-700 pl-1.5 ml-0.5">
        {debugStatus === "paused" ? <>
          <DebugTransport label="Continue" icon="▶" onClick={() => void debugControl("continue")} />
          <DebugTransport label="Step Over" icon="↷" onClick={() => void debugControl("stepOver")} />
          <DebugTransport label="Step Into" icon="↓" onClick={() => void debugControl("stepInto")} />
          <DebugTransport label="Step Out" icon="↑" onClick={() => void debugControl("stepOut")} />
        </> : <DebugTransport label="Pause" icon="⏸" onClick={() => void debugControl("pause")} />}
      </div>}

      <div className="ml-auto text-zinc-500 text-[11px] truncate max-w-[180px]">
        {running && activeConfigName ? (
          <>
            <span className="text-zinc-500">White · </span><span className="text-zinc-400">{activeConfigName}</span>
            <span className="text-zinc-600"> · </span>
            <span>{localStatus}</span>
          </>
        ) : (
          <><><span className="text-zinc-500">White · </span><span>{localStatus}</span></></>
        )}
      </div>

      <WindowManager />

      {dialogOpen && (
        <ConfigurationsDialog onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

function DebugTransport({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick}
    className="w-7 h-7 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 text-sm">{icon}</button>;
}

function GoldButton({ kind, linked }: { kind: Kind; linked: LinkedSnapshot }) {
  const isStop = linked.activeAction === kind && (kind === "run" || kind === "debug");
  const available = kind === "build" ? linked.canBuild : kind === "run" ? linked.canRun : linked.canDebug;
  const disabled = !isStop && (!linked.linked || linked.busy || !available);
  const projects = linked.members.map((member) => member.projectName).join(" + ");
  const count = linked.members.length;
  const title = isStop ? `Stop ${count} linked ${count === 1 ? "instance" : "instances"}`
    : kind === "debug" && !linked.canDebug ? `Debug ${count} instances requires a real debugger adapter in every window`
    : !available ? `Cannot ${kind} all ${count} linked instances: a configuration is missing`
    : linked.busy ? "A linked action is active"
    : `${KIND_TITLE[kind]} ${count} linked instances: ${projects}`;
  return (
    <button type="button" title={title} aria-label={isStop ? `Stop ${count} linked instances` : `${KIND_TITLE[kind]} ${count} linked instances`}
      disabled={disabled}
      onClick={() => void (isStop ? stopLinkedAction() : startLinkedAction(kind)).catch((error) => alert(`Linked ${kind} failed: ${String(error)}`))}
      onContextMenu={(event) => {
        event.preventDefault();
        if (window.confirm("Reset linked action state? Use this if the gold button is stuck.")) {
          void import("@tauri-apps/api/core").then(({ invoke }) => invoke("reset_linked_action"))
            .catch((error) => alert(`Reset failed: ${String(error)}`));
        }
      }}
      className={"relative w-8 h-8 flex items-center justify-center rounded text-[14px] transition-colors " +
        (disabled ? "text-amber-700/70 cursor-default" : "text-amber-400 hover:bg-amber-900/30 hover:text-amber-300")}
    >
      <GoldActionIcon kind={kind} stop={isStop} />
      <sup aria-hidden="true" className="absolute top-0 right-0 text-[9px] leading-none font-semibold tabular-nums">{count}</sup>
    </button>
  );
}

function GoldActionIcon({ kind, stop }: { kind: Kind; stop: boolean }) {
  if (stop) return <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current"><rect x="5" y="5" width="14" height="14" rx="1.5" /></svg>;
  if (kind === "run") return <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M6 3.5a1 1 0 0 1 1.5-.86l13 8.5a1 1 0 0 1 0 1.72l-13 8.5A1 1 0 0 1 6 20.5z" /></svg>;
  if (kind === "debug") return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 8a4 4 0 0 1 8 0v9a4 4 0 0 1-8 0V8Z" /><path d="M8 12h8M9 5 7 3m8 2 2-2M5 9l3 2M5 17l3-2m11-6-3 2m3 6-3-2" />
    </svg>
  );
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 2 7 7-3.5 3.5-7-7L15 2Z" /><path d="m13.5 9.5-10 10a2.1 2.1 0 0 0 3 3l10-10" />
    </svg>
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
  kind, configs, running, onFire, mainChoiceOverride,
}: {
  kind: Kind;
  configs: ConfigEntry[];
  running: boolean;
  onFire: (name: string) => void;
  mainChoiceOverride?: string | null;
}) {
  const localMainChoice = useBuild((s) => s.mainChoices[kind]);
  const mainChoice = mainChoiceOverride === undefined ? localMainChoice : mainChoiceOverride;
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
