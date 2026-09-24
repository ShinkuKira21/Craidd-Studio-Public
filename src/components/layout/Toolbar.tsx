import { memo, useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild, syncMainChoices, selectConfiguration, choicesForConfig } from "../../store/buildStore";
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
  const [previewName, setPreviewName] = useState<string | null>(null);

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
  const previewConfig = configs.find((config) => config.name === previewName);
  const previewChoices = previewConfig && solution ? choicesForConfig(solution, previewConfig) : null;
  const stopLocal = () => ["building", "running", "paused"].includes(debugStatus) ? debugControl("stop") : stop();

  const onChipSelect = (name: string) => {
    if (solution) selectConfiguration(solution, name);
  };

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-1.5 shrink-0 text-xs">
      <KindButton kind="build" configs={configs} scopeConfig={previewConfig ?? selectedConfig} running={running} mainChoiceOverride={previewChoices?.build} onFire={(name) => void start("build", name)} />
      {(linked.linked || linked.activeAction) && <GoldButton kind="build" linked={linked} />}

      <ConfigChip
        hasSolution={!!solution}
        projects={solution?.projects ?? []}
        configs={configs}
        selectedName={selectedConfigName}
        onSelect={onChipSelect}
        onPreview={setPreviewName}
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

      <KindButton kind="run" configs={configs} scopeConfig={previewConfig ?? selectedConfig} running={running} mainChoiceOverride={previewChoices?.run} onFire={(name) => void start("run", name)} />
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

      <KindButton kind="debug" configs={configs} scopeConfig={previewConfig ?? selectedConfig} running={running} mainChoiceOverride={previewChoices?.debug} onFire={(name) => void start("debug", name)} />
      {(linked.linked || linked.activeAction) && <GoldButton kind="debug" linked={linked} />}
      {(debugStatus === "paused" || debugStatus === "running") && <div className="flex items-center gap-0.5 border-l border-zinc-700 pl-1.5 ml-0.5">
        {debugStatus === "paused" ? <>
          <DebugTransport label="Continue" icon="▶" onClick={() => void debugControl("continue")} />
          <DebugTransport label="Step Over" icon="↷" onClick={() => void debugControl("stepOver")} />
          <DebugTransport label="Step Into" icon="↓" onClick={() => void debugControl("stepInto")} />
          <DebugTransport label="Step Out" icon="↑" onClick={() => void debugControl("stepOut")} />
        </> : <DebugTransport label="Pause" icon="⏸" onClick={() => void debugControl("pause")} />}
      </div>}

      <div className="ml-auto text-zinc-500 text-[11px] truncate max-w-[220px]">
        {running && activeConfigName ? (
          <>
            <span className="text-zinc-500">White · </span><span className="text-zinc-400">{activeConfigName}</span>
            <span className="text-zinc-600"> · </span>
            <span>{localStatus}</span>
          </>
        ) : (
          <><span className="text-zinc-500">White · </span><span>{localStatus}</span></>
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
  const activeCount = linked.activeCount;
  const title = isStop ? `${count} linked ${count === 1 ? "window" : "windows"} (gold upper number); ${activeCount} still starting or running (light lower number). Stop the remaining instances.`
    : kind === "debug" && !linked.canDebug ? `Debug ${count} instances requires a real debugger adapter in every window`
    : !available ? `Cannot ${kind} all ${count} linked instances: a configuration is missing`
    : linked.busy ? "A linked action is active"
    : `${KIND_TITLE[kind]} ${count} linked instances: ${projects}`;
  return (
    <button type="button" title={title} aria-label={isStop ? `Stop ${activeCount} active linked ${activeCount === 1 ? "instance" : "instances"} of ${count}` : `${KIND_TITLE[kind]} ${count} linked instances`}
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
      {isStop && <sub aria-hidden="true" className="absolute bottom-0 right-0 text-[9px] leading-none font-semibold tabular-nums text-zinc-100">{activeCount}</sub>}
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
  kind, configs, scopeConfig, running, onFire, mainChoiceOverride,
}: {
  kind: Kind;
  configs: ConfigEntry[];
  scopeConfig?: ConfigEntry;
  running: boolean;
  onFire: (name: string) => void;
  mainChoiceOverride?: string | null;
}) {
  const localMainChoice = useBuild((s) => s.mainChoices[kind]);
  const mainChoice = mainChoiceOverride === undefined ? localMainChoice : mainChoiceOverride;
  const [open, setOpen] = useState(false);

  const candidates = configs.filter((c) => {
    if (c.kind !== kind) return false;
    if (!scopeConfig) return true;
    if (!scopeConfig.bestFit) return !c.bestFit && c.target === scopeConfig.target;
    const family = scopeConfig.relatedProjects ?? [];
    return c.bestFit && c.relatedProjects?.length === family.length
      && c.relatedProjects?.every((project) => family.includes(project));
  });
  const has = candidates.length > 0;
  const multi = candidates.length > 1;

  const chosen = candidates.find((c) => c.name === mainChoice) ?? null;
  const command = chosen?.command ?? chosen?.method ?? "configuration";
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
        title={disabled ? disabledReason : `${KIND_TITLE[kind]} — ${chosen?.name} (${command})`}
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

/**
 * The chip. Flat list. One row per selectable configuration.
 *
 * Compositions carry a filled dot marker (●) to distinguish them from
 * project configs. Hovering a row previews the toolbar; clicking commits.
 *
 * Order: compositions first (Tauri Dev, etc.), then projects in solution
 * order, each project's configs in manifest order.
 */
function ConfigChip({
  hasSolution, projects, configs, selectedName, onSelect, onPreview, onOpenDialog,
}: {
  hasSolution: boolean;
  projects: CraiddProject[];
  configs: ConfigEntry[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onPreview: (name: string | null) => void;
  onOpenDialog: () => void;
}) {
  const [open, setOpen] = useState(false);

  const selected = configs.find((config) => config.name === selectedName);
  const compositions = configs.filter((c) => c.bestFit && c.kind === "run");

  // Project configs = anything not best-fit. Sorted by the project order
  // the solution declares, then by name.
  const projectConfigs = configs.filter((c) => !c.bestFit);
  const byProject = new Map<string, ConfigEntry[]>();
  for (const c of projectConfigs) {
    const list = byProject.get(c.target) ?? [];
    list.push(c);
    byProject.set(c.target, list);
  }


  // Compute the label.
  const label = !hasSolution ? "No solution"
    : selected?.bestFit ? selected.name
    : projects.find((p) => p.path === selected?.target)?.name ?? selected?.name ?? "No configurations";

  // Ordering inside the dropdown:
  //   compositions first (all of them, since they're the "solution" tier)
  //   then, per project (solution order), that project's configs
  const rows: { key: string; kind: "composition" | "project"; name: string; entry?: ConfigEntry; project?: CraiddProject }[] = [];
  for (const c of compositions) {
    rows.push({ key: `c:${c.name}`, kind: "composition", name: c.name, entry: c });
  }
  for (const project of projects) {
    const list = byProject.get(project.path) ?? [];
    if (list.length === 0) continue;
    rows.push({ key: `p:${project.path}`, kind: "project", name: project.name, project });
    for (const c of list) {
      rows.push({ key: `pc:${c.name}`, kind: "project", name: c.name, entry: c, project });
    }
  }
  // Any project configs whose target isn't in `projects` (external).
  for (const c of projectConfigs) {
    if (!projects.some((p) => p.path === c.target)) {
      rows.push({ key: `pc:${c.name}`, kind: "project", name: c.name, entry: c });
    }
  }

  return (
    <div
      className="relative"
      onMouseLeave={() => onPreview(null)}
    >
      <button
        onClick={() => hasSolution && configs.length > 0 && setOpen((v) => !v)}
        disabled={!hasSolution}
        className={
          "h-8 px-3 rounded flex items-center gap-2 border text-[12px] transition-colors " +
          (hasSolution ? "border-zinc-700 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/40"
                       : "border-zinc-800 text-zinc-600 cursor-default")
        }
      >
        {selected?.bestFit && <span className="text-blue-400 text-[8px] shrink-0">●</span>}
        <span className="truncate max-w-[260px]">{label}</span>
        <svg className={"w-3 h-3 shrink-0 text-zinc-500 transition-transform " + (open ? "rotate-180" : "")}
             fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { onPreview(null); setOpen(false); }} />
          <div
            className="absolute top-full left-0 mt-1 w-[360px] max-h-[min(420px,70vh)] overflow-y-auto scroll-thin bg-zinc-900 border border-zinc-700 rounded shadow-2xl z-50 text-xs py-1"
            onMouseLeave={() => onPreview(null)}
          >
            {rows.map((row) => {
              if (row.kind === "project" && !row.entry) {
                return (
                  <div
                    key={row.key}
                    className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600"
                  >
                    {row.name}
                  </div>
                );
              }
              const c = row.entry!;
              const isSelected = c.name === selectedName;
              const isComposition = c.bestFit === true;
              const projectName = projects.find((p) => p.path === c.target)?.name;
              return (
                <button
                  key={row.key}
                  onMouseEnter={() => onPreview(c.name)}
                  onFocus={() => onPreview(c.name)}
                  onClick={() => { onPreview(null); onSelect(c.name); setOpen(false); }}
                  className={
                    "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] " +
                    (isSelected ? "bg-blue-950/40 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800")
                  }
                >
                  <span className={
                    "w-2 shrink-0 text-[8px] " +
                    (isComposition ? "text-blue-400" : "text-transparent")
                  }>●</span>
                  <span className="truncate flex-1">{c.name}</span>
                  <span className="text-[10px] text-zinc-600 shrink-0 truncate max-w-[120px]">
                    {isComposition ? "solution" : projectName ?? c.kind}
                  </span>
                </button>
              );
            })}
            <div className="my-1 h-px bg-zinc-800" />
            <button
              onClick={() => { onPreview(null); onOpenDialog(); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >View Configurations…</button>
          </div>
        </>
      )}

    </div>
  );
}

export default memo(Toolbar);
