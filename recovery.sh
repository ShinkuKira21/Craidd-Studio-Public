#!/usr/bin/env bash
# Craidd-Studio — setup-v11
# Day 5 recovery: restore containment, restore chevrons, retire the
# clobbering scripts.
#
# What this does:
#   1. Checkpoint the current tree (files that will be touched) into
#      .setup-checkpoints/, so ./setup-rollback.sh --last can undo this.
#   2. Tag HEAD as pre-setup-v11.
#   3. Restore containment from commit 4601e7f via git checkout:
#        containment.rs, runner.rs, build.rs, mod.rs, lib.rs, buildStore.ts
#   4. Re-inject chevron work (never committed) into Toolbar.tsx,
#      buildStore.ts, solutionStore.ts.
#   5. Retire the scripts that did the clobbering into setup-retired/.
#   6. Verify: npx tsc --noEmit && cargo build. Abort on failure.
#   7. Print the git commands for YOU to run. Does not run git commit.
#
# Safe to re-run: refuses if already applied (.setup-applied/v11).
# Use --force to rerun anyway.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
APPLIED_MARKER=".setup-applied/v11"
SAFETY_TAG="pre-setup-v11"

# ─────────────────────────────────────────────────────────
# Preflight
# ─────────────────────────────────────────────────────────
if [ -f "$APPLIED_MARKER" ] && [ "${1:-}" != "--force" ]; then
    echo "✗ setup-v11 was already applied."
    echo "  Marker: $APPLIED_MARKER"
    echo "  To force a rerun: ./$SCRIPT_NAME --force"
    exit 1
fi

echo "▸ setup-v11 — Day 5 recovery"
echo ""

# Declare what this script may touch. Used for the checkpoint.
TOUCHED_FILES=(
    "src-tauri/src/commands/containment.rs"
    "src-tauri/src/commands/runner.rs"
    "src-tauri/src/commands/build.rs"
    "src-tauri/src/commands/mod.rs"
    "src-tauri/src/lib.rs"
    "src/store/buildStore.ts"
    "src/store/solutionStore.ts"
    "src/components/layout/Toolbar.tsx"
)

# ─────────────────────────────────────────────────────────
# Checkpoint + safety tag
# ─────────────────────────────────────────────────────────
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [ -n "$(git status --porcelain)" ]; then
        echo "· working tree has uncommitted changes:"
        git status --short | sed 's/^/    /'
        echo "  this is fine — the checkpoint captures them."
        echo ""
    fi

    if git rev-parse -q --verify "refs/tags/$SAFETY_TAG" >/dev/null; then
        echo "· safety tag $SAFETY_TAG already exists"
    else
        git tag "$SAFETY_TAG" HEAD
        echo "· safety tag $SAFETY_TAG created at $(git rev-parse --short HEAD)"
    fi
else
    echo "✗ not in a git repository — aborting"
    exit 1
fi

CHECKPOINT_DIR=".setup-checkpoints/pre-setup-v11-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$CHECKPOINT_DIR/files"

{
    echo "script: $SCRIPT_NAME"
    echo "date:   $(date -Iseconds)"
    echo "pwd:    $(pwd)"
} > "$CHECKPOINT_DIR/info.txt"

git rev-parse HEAD > "$CHECKPOINT_DIR/.git-head"
git status --short > "$CHECKPOINT_DIR/.status" || true

saved_count=0
for path in "${TOUCHED_FILES[@]}"; do
    if [ -f "$path" ]; then
        mkdir -p "$CHECKPOINT_DIR/files/$(dirname "$path")"
        cp "$path" "$CHECKPOINT_DIR/files/$path"
        saved_count=$((saved_count + 1))
    fi
done

mkdir -p .setup-checkpoints
printf "%s  pre-setup-v11  HEAD=%s  tree=%s  files=%d\n" \
    "$(date +%Y%m%d-%H%M%S)" \
    "$(git rev-parse --short HEAD)" \
    "$([ -s "$CHECKPOINT_DIR/.status" ] && echo dirty || echo clean)" \
    "$saved_count" \
    >> .setup-checkpoints/ledger.txt

echo "· checkpoint: $CHECKPOINT_DIR ($saved_count files)"
echo "  to undo this run:  ./setup-rollback.sh --last"
echo ""

# ─────────────────────────────────────────────────────────
# 1. Restore containment from 4601e7f
# ─────────────────────────────────────────────────────────
echo "▸ Restoring containment from commit 4601e7f…"

if ! git rev-parse -q --verify "4601e7f^{commit}" >/dev/null; then
    echo "  ✗ commit 4601e7f not found"
    echo "  rollback: ./setup-rollback.sh --last"
    exit 1
fi

CONTAINMENT_PATHS=(
    "src-tauri/src/commands/containment.rs"
    "src-tauri/src/commands/runner.rs"
    "src-tauri/src/commands/build.rs"
    "src-tauri/src/commands/mod.rs"
    "src-tauri/src/lib.rs"
    "src/store/buildStore.ts"
)

for path in "${CONTAINMENT_PATHS[@]}"; do
    if git cat-file -e "4601e7f:$path" 2>/dev/null; then
        git checkout "4601e7f" -- "$path"
        echo "  · restored $path"
    else
        echo "  · $path not in 4601e7f — skipping"
    fi
done

# mod.rs: ensure both pub mod lines exist (the version in 4601e7f may
# be from before runner.rs was added, or vice versa — add whichever is
# missing without duplicating).
if ! grep -q "^pub mod containment;" src-tauri/src/commands/mod.rs; then
    printf '\npub mod containment;\n' >> src-tauri/src/commands/mod.rs
    echo "  · added 'pub mod containment;' to mod.rs"
fi
if ! grep -q "^pub mod runner;" src-tauri/src/commands/mod.rs; then
    printf 'pub mod runner;\n' >> src-tauri/src/commands/mod.rs
    echo "  · added 'pub mod runner;' to mod.rs"
fi

if [ ! -f src-tauri/src/commands/containment.rs ]; then
    echo "  ✗ containment.rs missing after restore"
    echo "  rollback: ./setup-rollback.sh --last"
    exit 1
fi
echo "  ✓ containment restored"
echo ""

# ─────────────────────────────────────────────────────────
# 2. Re-inject chevron work
# ─────────────────────────────────────────────────────────
echo "▸ Re-injecting chevron work…"

python3 - << 'PYEOF'
import pathlib, re

p = pathlib.Path("src/store/buildStore.ts")
text = p.read_text()

# --- MainChoices interface ---
if "interface MainChoices" not in text:
    m = re.search(r"interface BuildState \{[\s\S]*?profile: Profile;", text)
    if m:
        block = m.group(0)
        if "activeConfigName" in block and "mainChoices" not in block:
            new_block = block.replace(
                "  activeConfigName: string | null;",
                "  activeConfigName: string | null;\n"
                "  mainChoices: MainChoices;\n"
                "  setMainChoice: (kind: keyof MainChoices, name: string) => void;",
            )
        else:
            new_block = block
        text = (
            text[:m.start()]
            + "interface MainChoices {\n"
              "  build: string | null;\n"
              "  run: string | null;\n"
              "  debug: string | null;\n"
              "}\n\n"
            + new_block
            + text[m.end():]
        )
        print("  · buildStore.ts: MainChoices interface")
    else:
        print("  · WARN: BuildState interface not found")

# --- init ---
if "mainChoices: { build:" not in text:
    m = re.search(
        r"(export const useBuild = create<BuildState>\(\(set, get\) => \{[\s\S]*?setSelectedProfile: \(name\) => set\(\{ selectedProfileName: name \}\),)",
        text,
    )
    if m:
        text = text.replace(
            m.group(1),
            m.group(1)
            + "\n  mainChoices: { build: null, run: null, debug: null },"
            + "\n  setMainChoice: (kind, name) =>"
            + "\n    set((s) => ({ mainChoices: { ...s.mainChoices, [kind]: name } })),",
            1,
        )
        print("  · buildStore.ts: mainChoices + setMainChoice initialised")

# --- start() signature ---
text = re.sub(
    r"  start: \(action: \"build\" \| \"run\"\) => Promise<void>;",
    "  start: (action: \"build\" | \"run\" | \"debug\", configName?: string) => Promise<void>;",
    text,
)
text = re.sub(
    r"  action: \"build\" \| \"run\" \| null;",
    "  action: \"build\" | \"run\" | \"debug\" | null;",
    text,
)

# --- start() body ---
start_re = re.search(r"  start: async \(action\) => \{[\s\S]*?\n  \},", text)
if start_re:
    new_start = '''  start: async (action, configName) => {
    const state = get();
    const { solution, rootPath } = useSolution.getState();
    if (!solution || !rootPath) {
      set({ status: "failed", output: "No solution is open.\\n" });
      return;
    }

    const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];

    let chosen: typeof all[number] | null = null;
    if (configName) {
      chosen = all.find((c) => c.name === configName) ?? null;
    } else {
      const main = state.mainChoices[action];
      if (main) chosen = all.find((c) => c.name === main) ?? null;
      if (!chosen) chosen = all.find((c) => c.kind === action) ?? null;
    }

    if (!chosen) {
      const msg = configName
        ? `Configuration not found: ${configName}\\n`
        : `No ${action} configuration available.\\n`;
      set({ status: "failed", output: msg });
      return;
    }

    if (chosen.kind !== action) {
      set({
        status: "failed",
        output: `"${chosen.name}" is a ${chosen.kind} configuration — cannot ${action} it.\\n`,
      });
      return;
    }

    if (state.activeId !== null || state.status === "starting") return;

    const spec = resolveSpec(chosen, rootPath, solution);
    if (!spec) {
      set({ status: "failed", output: `Could not resolve a command for "${chosen.name}".\\n` });
      return;
    }

    set({
      status: "starting",
      action,
      artifact: null,
      output: `Starting ${spec.label}\\u2026\\n`,
      activeConfigName: chosen.name,
    });

    try {
      await ensureEvents();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke<number>("start_config", { spec });
    } catch (error) {
      set({
        status: "failed",
        activeId: null,
        activeConfigName: null,
        output: `Could not ${action}: ${String(error)}\\n`,
      });
    }
  },'''
    text = text[:start_re.start()] + new_start + text[start_re.end():]
    print("  · buildStore.ts: start(action, configName?)")

# --- stop() body ---
stop_re = re.search(r"  stop: async \(\) => \{[\s\S]*?\n  \},", text)
if stop_re:
    new_stop = '''  stop: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("stop_config");
    } catch (error) {
      set((s) => ({ output: s.output + `Stop failed: ${String(error)}\\n` }));
    }
  },'''
    text = text[:stop_re.start()] + new_stop + text[stop_re.end():]
    print("  · buildStore.ts: stop()")

# --- resolveSpec helper ---
if "function resolveSpec" not in text:
    helper = '''
import type { ConfigEntry, CraiddSolution } from "../types/project";

interface RunSpec {
  label: string;
  program: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

function resolveSpec(
  config: ConfigEntry,
  solutionRoot: string,
  solution: CraiddSolution,
): RunSpec | null {
  const root = solutionRoot.replace(/\\/+$/, "");

  let cwd = root;
  if (config.target && config.target !== ".") {
    const project = solution.projects.find((p) => p.path === config.target);
    if (project) {
      const folder = project.folder === "." || project.folder === ""
        ? ""
        : "/" + project.folder.replace(/^\\/+/, "");
      cwd = root + folder;
    }
  }
  if (config.cwd) {
    cwd = root + "/" + config.cwd.replace(/^\\/+/, "");
  }

  const profiles = config.profiles ?? [];
  const chosen = profiles.find((p) => p.name === config.defaultProfile) ?? profiles[0];
  const env: Record<string, string> = { ...(chosen?.env ?? {}) };
  const profileArgs = chosen?.args ?? [];

  if (config.command && config.command.trim()) {
    const parts = parseCommandLine(config.command.trim());
    if (parts.length === 0) return null;
    const [program, ...rest] = parts;
    return {
      label: config.command.trim(),
      program,
      args: [...rest, ...profileArgs],
      env,
      cwd,
    };
  }

  switch (config.method) {
    case "cargo":
      return {
        label: `cargo ${config.kind === "run" ? "run" : "build"}`,
        program: "cargo",
        args: [config.kind === "run" ? "run" : "build", ...profileArgs],
        env, cwd,
      };
    case "npm":
      return { label: "npm run dev", program: "npm", args: ["run", "dev", ...profileArgs], env, cwd };
    case "dotnet":
      return {
        label: `dotnet ${config.kind === "run" ? "run" : "build"}`,
        program: "dotnet",
        args: [config.kind === "run" ? "run" : "build", ...profileArgs],
        env, cwd,
      };
    case "cmake":
      return { label: "cmake --build build", program: "cmake", args: ["--build", "build", ...profileArgs], env, cwd };
    default:
      return null;
  }
}

function parseCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

'''
    anchor = "export const useBuild = create<BuildState>"
    text = text.replace(anchor, helper + anchor, 1)
    print("  · buildStore.ts: resolveSpec + parseCommandLine")

# --- seedMainChoices ---
if "seedMainChoices" not in text:
    helper = '''
export function seedMainChoices(solution: CraiddSolution): void {
  const all = [...(solution.inferredConfigs ?? []), ...(solution.configs ?? [])];
  const firstOf = (kind: "build" | "run" | "debug") =>
    all.find((c) => c.kind === kind)?.name ?? null;

  const current = useBuild.getState().mainChoices;
  useBuild.setState({
    mainChoices: {
      build: current.build ?? firstOf("build"),
      run:   current.run   ?? firstOf("run"),
      debug: current.debug ?? firstOf("debug"),
    },
  });
}
'''
    anchor = "export const useBuild = create<BuildState>"
    text = text.replace(anchor, helper + "\n" + anchor, 1)
    print("  · buildStore.ts: seedMainChoices exported")

# --- clear activeConfigName on finish ---
old_finish = '''        if (message.kind === "cancelled") return { activeId: null, status: "cancelled", output: state.output + "Cancelled.\\n" };'''
new_finish = '''        if (message.kind === "cancelled") return { activeId: null, status: "cancelled", activeConfigName: null, output: state.output + "Cancelled.\\n" };'''
if old_finish in text:
    text = text.replace(old_finish, new_finish, 1)
    print("  · buildStore.ts: activeConfigName cleared on cancel")

p.write_text(text)
PYEOF

# solutionStore: seedMainChoices wire-up
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/store/solutionStore.ts")
text = p.read_text()

if "seedMainChoices" in text:
    print("  · solutionStore.ts: already wired")
else:
    anchor = 'import { languageFromFilename, monacoLanguageForFilename, projectExtensions, projectWellKnownFiles, languageMeta } from "../lib/languages";'
    if anchor in text:
        text = text.replace(
            anchor,
            anchor + '\nimport { seedMainChoices } from "./buildStore";',
            1,
        )

    pattern = "        bannerMessage: null,\n      });\n      return { status: \"loaded\" };"
    text = text.replace(
        pattern,
        "        bannerMessage: null,\n      });\n      seedMainChoices(finalSolution);\n      return { status: \"loaded\" };",
    )
    p.write_text(text)
    print("  · solutionStore.ts: seedMainChoices wired")
PYEOF

# Toolbar: full rewrite with KindButton + chevrons
cat > src/components/layout/Toolbar.tsx << 'TSEOF'
import { memo, useEffect, useState } from "react";
import { useSolution } from "../../store/solutionStore";
import { useBuild, seedMainChoices } from "../../store/buildStore";
import type { ConfigEntry } from "../../types/project";
import ConfigurationsDialog from "../dialogs/configurations/ConfigurationsDialog";

type Kind = "build" | "run" | "debug";

const KIND_ICON: Record<Kind, string> = { build: "🔨", run: "▶", debug: "🐛" };
const KIND_TITLE: Record<Kind, string> = { build: "Build", run: "Run", debug: "Debug" };

function Toolbar() {
  const solution = useSolution((s) => s.solution);
  const selectedConfigName = useBuild((s) => s.selectedConfigName);
  const setSelectedConfig = useBuild((s) => s.setSelectedConfig);
  const status = useBuild((s) => s.status);
  const activeConfigName = useBuild((s) => s.activeConfigName);
  const start = useBuild((s) => s.start);
  const stop = useBuild((s) => s.stop);
  const setMainChoice = useBuild((s) => s.setMainChoice);
  const [dialogOpen, setDialogOpen] = useState(false);

  const configs: ConfigEntry[] = [
    ...(solution?.inferredConfigs ?? []),
    ...(solution?.configs ?? []),
  ];

  useEffect(() => {
    if (solution) seedMainChoices(solution);
  }, [solution]);

  useEffect(() => {
    if (!selectedConfigName && configs.length > 0) {
      const preferred = configs.find((c) => c.kind === "run") ?? configs[0];
      setSelectedConfig(preferred.name);
    }
  }, [solution, selectedConfigName, configs, setSelectedConfig]);

  const running = status === "starting" || status === "running";

  const onChipSelect = (name: string) => {
    setSelectedConfig(name);
    const c = configs.find((x) => x.name === name);
    if (c && (c.kind === "build" || c.kind === "run" || c.kind === "debug")) {
      setMainChoice(c.kind, name);
    }
  };

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-3 gap-1.5 shrink-0 text-xs">
      <KindButton kind="build" configs={configs} running={running}
                  onFire={(name) => void start("build", name)} />

      <ConfigChip
        hasSolution={!!solution}
        configs={configs}
        selectedName={selectedConfigName}
        onSelect={onChipSelect}
        onOpenDialog={() => setDialogOpen(true)}
      />

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

  const chosen = candidates.find((c) => c.name === mainChoice) ?? candidates[0] ?? null;
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

      {multi && !disabled && (
        <button
          title={`Other ${kind} configurations`}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-0 bottom-0 w-3 h-3 flex items-center justify-center text-[8px] text-zinc-500 hover:text-zinc-200 rounded"
        >▲</button>
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
  hasSolution, configs, selectedName, onSelect, onOpenDialog,
}: {
  hasSolution: boolean;
  configs: ConfigEntry[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onOpenDialog: () => void;
}) {
  const [open, setOpen] = useState(false);

  const userConfigs = configs.filter((c) => c.origin !== "inferred");
  const inferredConfigs = configs.filter((c) => c.origin === "inferred");

  const label = !hasSolution ? "No solution"
    : selectedName ? selectedName
    : configs.length > 0 ? configs[0].name
    : "No configurations";

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
          <div className="absolute top-full left-0 mt-1 min-w-[280px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 z-50 text-xs">
            {userConfigs.length > 0 && (
              <Group label="Configured">
                {userConfigs.map((c) => (
                  <MenuItem key={`u-${c.name}`} name={c.name} kind={c.kind}
                            active={c.name === selectedName}
                            onClick={() => { onSelect(c.name); setOpen(false); }} />
                ))}
              </Group>
            )}
            {inferredConfigs.length > 0 && (
              <Group label="Inferred">
                {inferredConfigs.map((c) => (
                  <MenuItem key={`i-${c.name}`} name={c.name} kind={c.kind}
                            active={c.name === selectedName}
                            onClick={() => { onSelect(c.name); setOpen(false); }} />
                ))}
              </Group>
            )}
            {configs.length === 0 && hasSolution && (
              <div className="px-3 py-2 text-[11.5px] text-zinc-500 italic">
                No configurations inferred.
                <br />
                Open the dialog to add one.
              </div>
            )}
            <div className="my-1 h-px bg-zinc-800" />
            <button
              onClick={() => { onOpenDialog(); setOpen(false); }}
              className="w-full px-3 py-1.5 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
            >Add / Edit Configurations…</button>
          </div>
        </>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      {children}
    </div>
  );
}

function MenuItem({
  name, kind, active, onClick,
}: { name: string; kind: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] " +
        (active ? "bg-blue-900/40 text-zinc-100"
                : "text-zinc-200 hover:bg-blue-700 hover:text-white")
      }
    >
      <span className="truncate flex-1">{name}</span>
      <span className="text-[10px] text-zinc-500 shrink-0">{kind}</span>
    </button>
  );
}

export default memo(Toolbar);
TSEOF

echo "  ✓ chevron work re-injected"
echo ""

# ─────────────────────────────────────────────────────────
# 3. Retire clobbering scripts
# ─────────────────────────────────────────────────────────
echo "▸ Retiring clobbering scripts…"

RETIRE_DIR="setup-retired"
mkdir -p "$RETIRE_DIR"

moved=0
for script in setup-v*.sh recovery.sh drop-child.sh; do
    [ -f "$script" ] || continue
    [ "$script" = "$SCRIPT_NAME" ] && continue   # don't retire ourselves

    if grep -q "cat > src/components/layout/Toolbar.tsx\|cat > src/store/buildStore.ts" "$script" 2>/dev/null; then
        mv "$script" "$RETIRE_DIR/$script"
        echo "  · retired $script → $RETIRE_DIR/"
        moved=$((moved + 1))
    fi
done

if [ "$moved" -eq 0 ]; then
    echo "  · no clobbering scripts found on disk — nothing to retire"
fi
echo ""

# ─────────────────────────────────────────────────────────
# 4. Verify
# ─────────────────────────────────────────────────────────
echo "▸ Type-checking frontend…"
if npx tsc --noEmit; then
    echo "  ✓ zero TypeScript errors"
else
    echo "  ✗ TypeScript errors"
    echo ""
    echo "  To undo this run:"
    echo "    ./setup-rollback.sh --last"
    exit 1
fi
echo ""

echo "▸ Building Rust…"
if (cd src-tauri && cargo build 2>&1 | tail -20); then
    echo "  ✓ Rust build clean"
else
    echo "  ✗ Rust build failed"
    echo ""
    echo "  To undo this run:"
    echo "    ./setup-rollback.sh --last"
    exit 1
fi
echo ""

# ─────────────────────────────────────────────────────────
# Mark applied
# ─────────────────────────────────────────────────────────
mkdir -p .setup-applied
touch "$APPLIED_MARKER"

echo "✓ setup-v11 applied."
echo ""
echo "  Checkpoint saved: $CHECKPOINT_DIR"
echo "  To undo:          ./setup-rollback.sh --last"
echo "  Safety tag:       $SAFETY_TAG"
echo "  To undo via git:  git reset --hard $SAFETY_TAG && git clean -fd"
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  Next — verify in the app BEFORE committing:"
echo "────────────────────────────────────────────────────────────"
echo ""
echo "  npm run tauri dev"
echo ""
echo "  1. Toolbar shows: [🔨] [config chip] [▶] [⏹] [🐛]"
echo "     A small ▲ in the corner of Build / Run if there is more"
echo "     than one config of that kind."
echo ""
echo "  2. Chip dropdown: Configured + Inferred groups."
echo "     Selecting a config from the chip sets it as the default"
echo "     for its kind."
echo ""
echo "  3. Click ▲ on Run. Menu opens."
echo "     The default row is marked."
echo "     Clicking a different row fires it ONCE and does NOT move"
echo "     the default. (Behaviour A.)"
echo ""
echo "  4. Stop → process group SIGTERMed."
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  When it works, commit IMMEDIATELY (before running anything else):"
echo "────────────────────────────────────────────────────────────"
echo ""
echo "    git add -A"
echo "    git commit -m \"setup-v11: restore containment + chevrons; retire clobberers\""
echo ""
echo "  Or if you have the alias:"
echo ""
echo "    craidd-save"
echo ""
echo "  If anything looks wrong, roll back first:"
echo ""
echo "    ./setup-rollback.sh --last"