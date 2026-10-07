import { memo, useEffect, useMemo, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild, syncMainChoices, choicesForConfig } from "../../store/buildStore";
import { controlViewedDebug, selectViewedConfiguration, selectViewedProfile, startViewedAction, stopViewedAction } from "../../lib/viewedActions";
import type { ConfigEntry, CraiddProject } from "../../types/project";
import ConfigurationsDialog from "../dialogs/configurations/ConfigurationsDialog";
import { useLinkedWindows, previewLinkedAction, startLinkedAction, stopLinkedAction, type LinkedSnapshot, type LinkedLaunchPlanPhase } from "../../store/linkedWindowsStore";
import { useLdi } from "../../store/ldiStore";
import { detectLinkedStartupSuggestions } from "../../lib/linkedStartup";
import LinkedLaunchPlanDialog from "../dialogs/LinkedLaunchPlanDialog";
import WindowManager from "./WindowManager";
import { useDebug } from "../../store/debugStore";
import { useNativeDebug } from "../../store/nativeDebugStore";
import ThreadDropdown from "./ThreadDropdown";

type Kind = "build" | "run" | "debug";

const KIND_ICON: Record<Kind, string> = { build: "🔨", run: "▶", debug: "🐛" };
const KIND_TITLE: Record<Kind, string> = { build: "Build", run: "Run", debug: "Debug" };

function Toolbar() {
  const solution = useSolution((s) => s.solution);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const selectedProfileName = useBuild((s) => s.selectedProfileName);
  const status = useBuild((s) => s.status);
  const activeConfigName = useBuild((s) => s.activeConfigName);

  const linked = useLinkedWindows();
  const ldi = useLdi((state) => state.session);
  const blues = useLdi((state) => state.blues);
  const debugStatus = useDebug((s) => s.status);
  const debugFrames = useDebug((s) => s.frames);
  const debugInspectionError = useDebug((s) => s.inspectionError);
  const selectedThreadId = useDebug((s) => s.selectedThreadId);
  const threadSessionKey = useDebug((s) => s.threadSessionKey);
  const nativeContext = useNativeDebug((s) => s.context);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startupSetupRequested, setStartupSetupRequested] = useState(false);
  const [previewName, setPreviewName] = useState<string | null>(null);

  const configs: ConfigEntry[] = [
    ...(solution?.inferredConfigs ?? []),
    ...(solution?.configs ?? []),
  ];
  const startupSuggestions = useMemo(() => solution
    ? detectLinkedStartupSuggestions(solution, [...solution.inferredConfigs, ...solution.configs]) : [], [solution]);

  useEffect(() => {
    if (solution) syncMainChoices(solution);
  }, [solution]);

  const remote = linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel
    && item.windowLabel !== linked.ownWindowLabel);
  const heldByLdi = Boolean(ldi?.held && ldi.phase !== "stopped" && ldi.originLabel === (remote?.windowLabel ?? linked.ownWindowLabel));
  const native = !remote ? nativeContext : null;
  const showGold = linked.windows.length > 1 || linked.linked || Boolean(linked.activeAction);
  const liveOwner = !remote && blues.some((blue) => blue.mode === "live-native"
    && blue.originLabel === linked.ownWindowLabel && !blue.warning)
    && ["building", "starting", "running", "paused"].includes(debugStatus);
  const liveLinked = Boolean(native) || liveOwner;
  const viewedStatus = native?.status ?? remote?.status ?? (["building", "starting", "running", "paused"].includes(debugStatus) ? debugStatus : status);
  const localStepUnavailable = !remote && !native && threadSessionKey && viewedStatus === "paused"
    && (selectedThreadId == null || !debugFrames[0]?.source?.path || !debugFrames[0]?.line);
  const localStepReason = selectedThreadId == null
    ? "Select a paused thread before stepping"
    : debugFrames.length === 0
      ? debugInspectionError ? "The selected thread's stack could not be inspected; choose another paused thread" : "Waiting for the selected thread's stack"
    : "This thread has no source line at its current instruction. Inspect it or select a thread stopped in code; Continue remains available.";
  const running = ["waiting", "starting", "building", "running", "paused"].includes(viewedStatus);
  const viewedConfigName = remote ? remote.selectedConfigName : selectedConfigName;
  const viewedProfileName = remote ? remote.selectedProfileName : selectedProfileName;
  const selectedConfig = configs.find((config) => config.name === viewedConfigName);
  const previewConfig = configs.find((config) => config.name === previewName);
  const previewChoices = previewConfig && solution ? choicesForConfig(solution, previewConfig) : null;
  const remoteChoices = remote && selectedConfig && solution ? choicesForConfig(solution, selectedConfig) : null;
  const fire = (kind: Kind, name: string) => void startViewedAction(kind, name)
    .catch((error) => alert(`Could not ${kind} the viewed window: ${String(error)}`));
  const stopViewed = () => void stopViewedAction()
    .catch((error) => alert(`Could not stop the viewed window: ${String(error)}`));
  const debugViewed = (action: "continue" | "pause" | "stepOver" | "stepInto" | "stepOut") => void controlViewedDebug(action)
    .catch((error) => alert(`Debug ${action} failed: ${String(error)}`));
  const onChipSelect = (name: string) => void selectViewedConfiguration(name)
    .catch((error) => alert(`Could not select configuration: ${String(error)}`));

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-1.5 shrink-0 text-xs">
      <KindButton kind="build" configs={configs} scopeConfig={previewConfig ?? selectedConfig} running={running} mainChoiceOverride={previewChoices ? previewChoices.build : remote ? remoteChoices?.build ?? null : undefined} onFire={(name) => fire("build", name)} />
      {showGold && <GoldButton kind="build" linked={linked} />}

      <ConfigChip
        hasSolution={!!solution}
        projects={solution?.projects ?? []}
        configs={configs}
        selectedName={viewedConfigName}
        onSelect={onChipSelect}
        onPreview={setPreviewName}
        onOpenDialog={() => { setStartupSetupRequested(false); setDialogOpen(true); }}
      />

      {startupSuggestions.length > 0 && <button type="button" onClick={() => { setStartupSetupRequested(true); setDialogOpen(true); }}
        title="A server and client reference the same local address. Review their linked startup order."
        className="rounded px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-900/30">Set up startup order…</button>}

      {selectedConfig && (selectedConfig.profiles?.length ?? 0) > 0 && (
        <ProfileChip
          config={selectedConfig}
          selectedName={viewedProfileName}
          onSelect={(name) => void selectViewedProfile(name).catch((error) => alert(`Could not select profile: ${String(error)}`))}
          disabled={running}
        />
      )}

      <KindButton kind="run" configs={configs} scopeConfig={previewConfig ?? selectedConfig} running={running} mainChoiceOverride={previewChoices ? previewChoices.run : remote ? remoteChoices?.run ?? null : undefined} onFire={(name) => fire("run", name)} />
      {showGold && <GoldButton kind="run" linked={linked} />}

      <button
        title={native ? "Stop owning Rust debugger (Shift+F5)" : running ? "Stop (Shift+F5)" : "Nothing is running"}
        disabled={!running}
        onClick={stopViewed}
        className={
          "w-8 h-8 flex items-center justify-center rounded text-[14px] transition-colors " +
          (running ? "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                   : "text-zinc-600 cursor-default")
        }
      >⏹</button>

      <KindButton kind="debug" configs={configs} scopeConfig={previewConfig ?? selectedConfig} running={running} mainChoiceOverride={previewChoices ? previewChoices.debug : remote ? remoteChoices?.debug ?? null : undefined} onFire={(name) => fire("debug", name)} />
      {liveLinked ? <button type="button" onClick={stopViewed} aria-label="Stop linked Rust debugger"
        title="2 linked windows · one Rust process and LLDB session. Stop the Rust debugger; Native is an inspector, not a second process."
        className="relative w-8 h-8 rounded text-amber-400 hover:bg-amber-900/30 flex items-center justify-center">
        <GoldActionIcon kind="debug" stop />
        <sup className="absolute top-0 right-0 text-[9px]">2</sup>
      </button> : showGold && <GoldButton kind="debug" linked={linked} />}
      {(native || (remote ? remote.debugging && (viewedStatus === "paused" || viewedStatus === "running") : (debugStatus === "paused" || debugStatus === "running"))) && <div className="flex items-center gap-0.5 border-l border-zinc-700 pl-1.5 ml-0.5">
        {viewedStatus === "paused"
          ? (!native || native.nativeStop)
            ? <DebugTransport label={heldByLdi ? "Continue C# · stop this native reproduction" : "Continue"}
                icon="▶" onClick={() => debugViewed("continue")} />
            : <button type="button" className="px-2 text-blue-300 hover:text-blue-200"
              onClick={() => void linked.selectWindow(native.originLabel).catch((error) => alert(String(error)))}>Paused in Rust · show owner</button>
          : <DebugTransport label="Pause" icon="⏸" onClick={() => debugViewed("pause")} />}
        {!remote && !native && (threadSessionKey || (ldi?.held && ldi.originLabel === linked.ownWindowLabel)) && <ThreadDropdown />}
        {viewedStatus === "paused" && (!native || native.nativeStop) && <>
          <DebugTransport disabled={heldByLdi || Boolean(localStepUnavailable)} disabledReason={heldByLdi ? undefined : localStepReason} label="Step Over" icon="↷" onClick={() => debugViewed("stepOver")} />
          <DebugTransport disabled={heldByLdi || Boolean(localStepUnavailable)} disabledReason={heldByLdi ? undefined : localStepReason} label="Step Into" icon="↓" onClick={() => debugViewed("stepInto")} />
          <DebugTransport disabled={heldByLdi || Boolean(localStepUnavailable)} disabledReason={heldByLdi ? undefined : localStepReason} label="Step Out" icon="↑" onClick={() => debugViewed("stepOut")} />
        </>}
      </div>}

      <div className="ml-auto text-zinc-500 text-[11px] truncate max-w-[220px]">
        {native ? <span className="text-blue-300" title="Controls operate the owning Rust process; your Native Power Config is unchanged">Native view · Rust · {native.status}</span> : running && (remote ? remote.selectedConfigName : activeConfigName) ? (
          <>
            <span className="text-zinc-500">White{remote ? ` CS${remote.windowId}` : ""} · </span><span className="text-zinc-400">{remote ? remote.selectedConfigName : activeConfigName}</span>
            <span className="text-zinc-600"> · </span>
            <span>{viewedStatus}</span>
          </>
        ) : (
          <><span className="text-zinc-500">White{remote ? ` CS${remote.windowId}` : ""} · </span><span>{viewedStatus}</span></>
        )}
      </div>

      <WindowManager />

      {dialogOpen && (
        <ConfigurationsDialog initialStartupSetup={startupSetupRequested} onClose={() => setDialogOpen(false)} />
      )}
    </div>
  );
}

function DebugTransport({ label, icon, onClick, disabled = false, disabledReason }: { label: string; icon: string; onClick: () => void; disabled?: boolean; disabledReason?: string }) {
  const title = disabled ? disabledReason ?? "A is held by LDI; finish B to release it" : label;
  return <span className="inline-flex" title={title}>
    <button type="button" disabled={disabled} aria-label={title} onClick={onClick}
      className="w-7 h-7 rounded text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none text-sm">{icon}</button>
  </span>;
}

function GoldButton({ kind, linked }: { kind: Kind; linked: LinkedSnapshot }) {
  const [plan, setPlan] = useState<LinkedLaunchPlanPhase[] | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const isStop = linked.activeAction === kind;
  const available = kind === "build" ? linked.canBuild : kind === "run" ? linked.canRun : linked.canDebug;
  const disabled = !isStop && (launching || !linked.linked || linked.busy || !available);
  const launch = async () => {
    setLaunching(true);
    setLaunchError(null);
    try {
      const currentPlan = await previewLinkedAction(kind);
      if (plan && JSON.stringify(currentPlan) !== JSON.stringify(plan)) {
        setPlan(currentPlan);
        setLaunchError("Linked configurations changed. Review the updated plan before starting.");
        return;
      }
      await startLinkedAction(kind); setPlan(null);
    }
    catch (error) { if (plan) setLaunchError(String(error)); else alert(`Linked ${kind} failed: ${String(error)}`); }
    finally { setLaunching(false); }
  };
  const reviewOrLaunch = async () => {
    if (isStop) { await stopLinkedAction(); return; }
    setLaunching(true);
    try {
      const phases = await previewLinkedAction(kind);
      if (phases.length > 1 || phases.some((phase) => phase.members.some((member) => member.readyUrl || member.preparation.length > 0))) {
        setLaunchError(null); setPlan(phases);
      } else { await startLinkedAction(kind); }
    } finally { setLaunching(false); }
  };
  const projects = linked.members.map((member) => member.projectName).join(" + ");
  const count = linked.members.length || linked.windows.length;
  const activeCount = linked.activeCount;
  const missingDebug = linked.members.filter((member) => !member.canDebug && member.ldiRole !== "native-library");
  const debugBlockers = [
    missingDebug.length > 0 ? `Select a supported Debug configuration in ${missingDebug.map((member) => `CS${member.windowId} (${member.projectName})`).join(", ")}` : null,
    !linked.debugAdapterAvailable ? "Install/select the required lldb-dap or netcoredbg adapter in Preferences → Toolchain, then rescan" : null,
  ].filter(Boolean).join("; ");
  const title = isStop ? `${count} linked ${count === 1 ? "window" : "windows"} (gold upper number); ${activeCount} still starting or running (light lower number). Stop the remaining instances.`
    : !linked.linked ? `${count} solution windows; no eligible linked ${kind} group. Libraries have no Run/Debug process. Use White Run/Debug in the caller; Native shows its live inspector and Stop.`
    : kind === "debug" && !linked.canDebug ? `Cannot debug ${count} linked windows: ${debugBlockers}`
    : !available ? `Cannot ${kind} all ${count} linked instances: a configuration is missing`
    : linked.busy ? "A linked action is active"
    : `${KIND_TITLE[kind]} ${count} linked instances: ${projects}`;
  return (
    <span className="inline-flex" title={title} tabIndex={disabled ? 0 : undefined} aria-label={disabled ? title : undefined}>
      <button type="button" aria-label={isStop ? `Stop ${activeCount} active linked ${activeCount === 1 ? "instance" : "instances"} of ${count}` : `${KIND_TITLE[kind]} ${count} linked instances`}
      disabled={disabled}
      onClick={() => void reviewOrLaunch().catch((error) => alert(`Linked ${kind} failed: ${String(error)}`))}
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
      {plan && <LinkedLaunchPlanDialog action={kind} phases={plan} launching={launching} error={launchError}
        onStart={() => void launch()} onClose={() => { if (!launching) setPlan(null); }} />}
    </span>
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
    if (scopeConfig.slots) return c.name === scopeConfig.slots[kind];
    if (!scopeConfig.bestFit) return !c.bestFit && !c.slots && c.target === scopeConfig.target;
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
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const closePicker = () => { onPreview(null); setOpen(false); };
  const selected = configs.find((config) => config.name === selectedName);
  const powerConfigs = configs.filter((config) => (config.bestFit && config.kind === "run") || !!config.slots);
  const projectGroups = projects.map((project) => ({
    key: `project:${project.path}`,
    label: project.name,
    configs: configs.filter((config) => config.target === project.path && !config.bestFit && !config.slots),
  })).filter((group) => group.configs.length > 0);
  const workspaceCommands = configs.filter((config) => config.target === "." && !config.bestFit && !config.slots);
  const groups = [
    ...powerConfigs.map((config) => ({ key: `best:${config.name}`, label: config.name, configs: [config] })),
    ...projectGroups,
    ...(workspaceCommands.length > 0 ? [{ key: "workspace-commands", label: "Workspace commands", configs: workspaceCommands }] : []),
  ];
  const selectedKey = selected?.bestFit || selected?.slots ? `best:${selected.name}`
    : selected?.target === "." ? "workspace-commands"
    : selected ? `project:${selected.target}` : null;
  const preview = groups.find((group) => group.key === previewKey)
    ?? groups.find((group) => group.key === selectedKey)
    ?? groups[0];
  const selectedProject = projects.find((project) => project.path === selected?.target);
  const label = !hasSolution ? "No solution"
    : configs.length === 0 ? "Add configuration…"
    : (selected?.bestFit || selected?.slots) ? selected.name
    : selectedProject?.name ?? selected?.name ?? "No configurations";
  const preferredForGroup = (group: typeof groups[number]) =>
    group.configs.find((config) => config.kind === "run" && config.origin === "user")
      ?? group.configs.find((config) => config.kind === "run")
      ?? group.configs.find((config) => config.kind === "build" && config.origin === "user")
      ?? group.configs.find((config) => config.kind === "build")
      ?? group.configs[0];
  const chooseGroup = (group: typeof groups[number]) => {
    const preferred = preferredForGroup(group);
    if (preferred) onSelect(preferred.name);
    closePicker();
  };

  return (
    <div className="relative" onMouseLeave={() => onPreview(null)}>
      <button
        onClick={() => {
          if (open) closePicker();
          else if (hasSolution && configs.length === 0) onOpenDialog();
          else if (hasSolution) setOpen(true);
        }}
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
          <div className="fixed inset-0 z-40" onClick={closePicker} />
          <div className="absolute top-full left-0 mt-1 w-[min(620px,calc(100vw-24px))] bg-zinc-900 border border-zinc-700 rounded shadow-2xl z-50 text-xs overflow-hidden">
            {groups.length > 0 && (
              <div className="flex min-h-[170px] max-h-[min(430px,70vh)]">
                <div className="w-[42%] min-w-0 overflow-y-auto scroll-thin border-r border-zinc-800 py-1">
                  {powerConfigs.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">Power configurations</div>}
                  {groups.map((group, index) => (
                    <div key={group.key}>
                      {index === powerConfigs.length && projectGroups.length > 0 &&
                        <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-500">Projects</div>}
                      <button
                        type="button"
                        onMouseEnter={() => { setPreviewKey(group.key); onPreview(preferredForGroup(group)?.name ?? null); }}
                        onFocus={() => { setPreviewKey(group.key); onPreview(preferredForGroup(group)?.name ?? null); }}
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
                  <div className="mt-0.5 text-[10px] text-zinc-500">{preview?.key.startsWith("best:") ? (preview.configs[0]?.bestFit ? "Inferred from this solution" : "Power configuration") : preview?.key === "workspace-commands" ? "Commands run from the solution root" : "Choose a project or configuration"}</div>
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
                        onMouseEnter={() => onPreview(config.name)}
                        onFocus={() => onPreview(config.name)}
                        onClick={() => { onSelect(config.name); closePicker(); }}
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
              onClick={() => { onOpenDialog(); closePicker(); }}
              className="w-full px-3 py-2 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >Add / Edit Configurations…</button>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(Toolbar);
