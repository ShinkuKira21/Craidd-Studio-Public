#!/usr/bin/env bash
# Craidd-Studio — Phase 2.4.7: Three-button resolution + chip/dialog shape
# Safe to re-run: overwrites generated files, doesn't touch user data.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "▸ Applying Phase 2.4.7..."

mkdir -p src/components/dialogs/configurations

# ─────────────────────────────────────────────────────────
# 1. Rust: infer_solution_default emits a family trio
#    Tauri Dev (run) + Tauri Dev (build) + Tauri Dev (debug)
#    All three share related_projects; the toolbar reads that.
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src-tauri/src/commands/infer.rs")
text = p.read_text()

# The signature block: it currently returns Ok(Some(default)) from
# infer_solution_default. We change the return to Vec<ConfigEntry> and
# push three entries.

old_sig = '''fn infer_solution_default(solution: &CraiddSolution) -> Option<ConfigEntry> {'''
new_sig = '''fn infer_solution_default(solution: &CraiddSolution) -> Vec<ConfigEntry> {'''
if old_sig in text:
    text = text.replace(old_sig, new_sig, 1)
    print("  · changed infer_solution_default return type")
elif new_sig not in text:
    raise SystemExit("Unexpected infer_solution_default signature; refusing to continue")

# The Tauri-emission block. Replace the single Some(ConfigEntry) with
# three entries sharing related_projects.
old_block = '''    if rust_candidates == 1 && ts_candidates == 1 {
        // Both halves present. Propose the composed default.
        // The target is the TS project, whose folder is where
        // `npm run tauri dev` should execute.
        let ts = ts_project?;
        return Some(ConfigEntry {
            name: "Tauri Dev".into(),
            best_fit: true,
            related_projects: vec![rust_project?.path.clone(), ts.path.clone()],
            kind: "run".into(),
            target: ts.path.clone(),
            method: Some("npm".into()),
            command: Some(format!("{ts_manager} run tauri dev")),
            cwd: None, // runner resolves to the target's folder
            origin: "inferred".into(),
            profiles: vec![],
            default_profile: None,
        });
    }

    None
}'''

new_block = '''    if rust_candidates == 1 && ts_candidates == 1 {
        // Both halves present. Propose the composed family: three
        // entries that share a related_projects list. The toolbar
        // reads that list to light up Build / Run / Debug together.
        //
        // Build and Debug target the Rust project (cargo build / cargo
        // build + lldb-dap); Run targets the frontend (npm run tauri
        // dev), because that is the composed dev flow.
        let Some(rust) = rust_project else { return vec![]; };
        let Some(ts) = ts_project else { return vec![]; };
        let shared = vec![rust.path.clone(), ts.path.clone()];
        return vec![
            ConfigEntry {
                name: "Tauri Dev".into(),
                best_fit: true,
                related_projects: shared.clone(),
                kind: "run".into(),
                target: ts.path.clone(),
                method: Some("npm".into()),
                command: Some(format!("{ts_manager} run tauri dev")),
                cwd: None,
                origin: "inferred".into(),
                profiles: vec![],
                default_profile: None,
            },
            ConfigEntry {
                name: "Tauri Dev — Build".into(),
                best_fit: true,
                related_projects: shared.clone(),
                kind: "build".into(),
                target: rust.path.clone(),
                method: Some("cargo".into()),
                command: Some("cargo build".into()),
                cwd: None,
                origin: "inferred".into(),
                profiles: profiles_for_cargo(rust),
                default_profile: Some("debug".into()),
            },
            ConfigEntry {
                name: "Tauri Dev — Debug".into(),
                best_fit: true,
                related_projects: shared.clone(),
                kind: "debug".into(),
                target: rust.path.clone(),
                method: Some("cargo".into()),
                command: Some("cargo build".into()),
                cwd: None,
                origin: "inferred".into(),
                profiles: profiles_for_cargo(rust),
                default_profile: Some("debug".into()),
            },
        ];
    }

    vec![]
}'''

if old_block in text:
    text = text.replace(old_block, new_block, 1)
    print("  · inference emits a Tauri family trio")
elif new_block not in text:
    raise SystemExit("Unexpected Tauri emission block; refusing to continue")

# The caller of infer_solution_default must change from Option to Vec.
old_call = '''    // ── Tier 1: Solution Default ─────────────────────────────
    if let Some(default) = infer_solution_default(&solution) {
        out.push(default);
    }'''
new_call = '''    // ── Tier 1: Solution Default ─────────────────────────────
    // The family (Tauri Dev + its Build/Debug siblings) is emitted
    // together so all three toolbar buttons resolve from one selection.
    for entry in infer_solution_default(&solution) {
        out.push(entry);
    }'''
if old_call in text:
    text = text.replace(old_call, new_call, 1)
    print("  · caller pushes family entries")
elif new_call not in text:
    raise SystemExit("Unexpected infer_solution_default caller; refusing to continue")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 2. Frontend: choicesForConfig reads relatedProjects for best-fit
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/store/buildStore.ts")
text = p.read_text()

old = '''export function choicesForConfig(solution: CraiddSolution, selected: ConfigEntry): MainChoices {
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  const forTarget = all.filter((candidate) => candidate.target === selected.target && !candidate.bestFit);
  const choose = (kind: keyof MainChoices) => {
    if (selected.kind === kind) return selected.name;
    return (forTarget.find((candidate) => candidate.kind === kind && candidate.origin === "user")
      ?? forTarget.find((candidate) => candidate.kind === kind))?.name ?? null;
  };
  return { build: choose("build"), run: choose("run"), debug: choose("debug") };
}'''

new = '''/**
 * Resolve which configuration each toolbar button should fire when
 * `selected` is the current chip choice.
 *
 * Two cases:
 *
 *   1. best_fit entries carry `relatedProjects` — the list of project
 *      paths whose configs form this family. Look up siblings by
 *      related_projects, not by target. This is why "Tauri Dev"
 *      lights up Build, Run, and Debug at once even though its own
 *      target is only the frontend.
 *
 *   2. A project config has no related_projects. Its siblings are the
 *      other configs of the same target (the existing lookup).
 */
export function choicesForConfig(solution: CraiddSolution, selected: ConfigEntry): MainChoices {
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];

  if (selected.bestFit && (selected.relatedProjects?.length ?? 0) > 0) {
    const family = new Set(selected.relatedProjects);
    const inFamily = all.filter((c) =>
      c.bestFit &&
      c.relatedProjects?.length === family.size &&
      c.relatedProjects.every((project) => family.has(project))
    );
    const choose = (kind: keyof MainChoices) => {
      if (selected.kind === kind) return selected.name;
      const hit = inFamily.find((c) => c.kind === kind);
      return hit?.name ?? null;
    };
    return { build: choose("build"), run: choose("run"), debug: choose("debug") };
  }

  const forTarget = all.filter((candidate) => candidate.target === selected.target && !candidate.bestFit);
  const choose = (kind: keyof MainChoices) => {
    if (selected.kind === kind) return selected.name;
    return (forTarget.find((candidate) => candidate.kind === kind && candidate.origin === "user")
      ?? forTarget.find((candidate) => candidate.kind === kind))?.name ?? null;
  };
  return { build: choose("build"), run: choose("run"), debug: choose("debug") };
}'''

if old in text:
    text = text.replace(old, new, 1)
    print("  · choicesForConfig reads relatedProjects for best-fit")
elif new not in text:
    raise SystemExit("Unexpected choicesForConfig body; refusing to continue")

# Also fix the "selected.kind === kind" early return inside the family
# branch — the sibling entries carry the same bestFit flag but different
# kind, so we must prefer the *selected* entry when its kind matches.
# (Already handled by `if (selected.kind === kind)` above.)

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 3. Frontend: Toolbar ConfigChip goes flat + hover-preview
#    KindButton's chevron becomes scoped (only current selection).
# ─────────────────────────────────────────────────────────
cat > src/components/layout/Toolbar.tsx << 'TSEOF'
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
TSEOF

echo "  · rewrote Toolbar.tsx (flat chip, hover preview)"

# ─────────────────────────────────────────────────────────
# 4. Dialog: one tree on the left, form on the right.
#    Read-only in this pass.
# ─────────────────────────────────────────────────────────
cat > src/components/dialogs/configurations/ConfigurationsDialog.tsx << 'TSEOF'
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
TSEOF

cat > src/components/dialogs/configurations/ConfigurationForm.tsx << 'TSEOF'
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
TSEOF

echo "  · rewrote ConfigurationsDialog.tsx (tree + form)"
echo "  · added ConfigurationForm.tsx (read-only)"

# Remove the old section rail (no longer referenced).
if [ -f src/components/dialogs/configurations/SectionRail.tsx ]; then
  rm src/components/dialogs/configurations/SectionRail.tsx
  echo "  · removed SectionRail.tsx"
fi

echo ""
echo "✓ Phase 2.4.7 applied."
echo ""
echo "  Fixed:"
echo "    Bug 3 — 'Tauri Dev' lights up Build / Run / Debug in the toolbar"
echo "            (family trio inferred; choicesForConfig reads relatedProjects)"
echo ""
echo "  Surface changes:"
echo "    Toolbar chip    — flat dropdown, compositions marked ●, project groups"
echo "    Chip hover      — previews the toolbar without committing"
echo "    Dialog          — one tree on the left, read-only form on the right"
echo ""
echo "  Modified:"
echo "    src-tauri/src/commands/infer.rs"
echo "    src/store/buildStore.ts"
echo "    src/components/layout/Toolbar.tsx"
echo "    src/components/dialogs/configurations/ConfigurationsDialog.tsx"
echo "    src/components/dialogs/configurations/ConfigurationForm.tsx  (new)"
echo "    src/components/dialogs/configurations/SectionRail.tsx       (removed)"
echo ""
echo "Next:"
echo "  cd src-tauri && cargo build && cd .."
echo "  npm run tauri dev"
echo ""
echo "Look at:"
echo "  1. Toolbar. Three buttons all lit for the Tauri solution."
echo "     Hover each. Tooltip shows the resolved command."
echo "  2. Chip. Click. Flat list: ● Tauri Dev, then Frontend's configs,"
echo "     then Rust's configs. Hover a row — the buttons above re-preview."
echo "     Move off — they revert."
echo "  3. Pick 'Frontend: npm run dev'. Chip updates. Run button now"
echo "     targets that. Build chevron lists the frontend's build configs"
echo "     (empty for now). Debug disables with a tooltip."
echo "  4. Open the Configurations dialog. One tree on the left:"
echo "     ● Tauri Dev at top with a form showing Run/Build/Debug slots."
echo "     Project configs below, grouped by project."
echo "     Click any row — form on the right updates."
echo ""
echo "Not in this pass (next script):"
echo "  - Editing the dialog (add / delete / duplicate / repoint slots)"
echo "  - Reordering (Alt+Up/Down, then drag)"
echo "  - Persisting compositions to .cln as a distinct table"