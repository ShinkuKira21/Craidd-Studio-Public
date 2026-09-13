#!/usr/bin/env bash
# Craidd-Studio — Phase 2.1.2: boundary-respecting Config, no-descent defaults,
# .d.ts matching, File Discovery root fix, and read-only Fine-Tune viewer.
# Safe to re-run: overwrites generated files, doesn't touch user data.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "▸ Applying Phase 2.1.2..."

mkdir -p src/components/dialogs

# ─────────────────────────────────────────────────────────
# 1. lib/languages.ts — add .d.ts support for TypeScript
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/lib/languages.ts")
text = p.read_text()

# TypeScript extensions: add "d.ts" as a special-case extension.
old_ts = '''    id: "typescript",
    label: "TypeScript",
    color: "text-blue-400",
    extensions: ["ts", "tsx", "mts", "cts"],
    wellKnownFiles: ["tsconfig.json"],'''
new_ts = '''    id: "typescript",
    label: "TypeScript",
    color: "text-blue-400",
    extensions: ["ts", "tsx", "mts", "cts", "d.ts"],
    wellKnownFiles: ["tsconfig.json", "vite-env.d.ts"],'''

if old_ts in text:
    text = text.replace(old_ts, new_ts, 1)
    print("  · languages.ts: added .d.ts + vite-env.d.ts to TypeScript")
elif new_ts in text:
    print("  · languages.ts: already patched")
else:
    print("  · WARNING: TypeScript block not found in languages.ts")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 2. store/solutionStore.ts — Config respects boundary, no descent
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/store/solutionStore.ts")
text = p.read_text()

# populateTrees: config tree now stops at .craidd boundaries (stop_at_craidd = true)
old_cfg = '''    const { tree, error } = await readTreeFor(configFolder, meta.extensions, [], false);
    next.configTree = tree;
    next.configTreeError = error;'''
new_cfg = '''    const { tree, error } = await readTreeFor(configFolder, meta.extensions, [], true);
    next.configTree = tree;
    next.configTreeError = error;'''

if old_cfg in text:
    text = text.replace(old_cfg, new_cfg, 1)
    print("  · solutionStore.ts: config tree now respects .craidd boundaries")
elif new_cfg in text:
    print("  · solutionStore.ts: config boundary already set")
else:
    print("  · WARNING: config readTreeFor call not found in solutionStore.ts")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 3. dialogs/FineTuneDialog.tsx — read-only viewer (NEW)
# ─────────────────────────────────────────────────────────
cat > src/components/dialogs/FineTuneDialog.tsx << 'TSEOF'
import { useEffect, useMemo, useState } from "react";
import type { CraiddProject, FileNode } from "../../types/project";
import { languageMeta, projectExtensions, projectWellKnownFiles } from "../../lib/languages";

/**
 * Phase 2.1.2 — READ-ONLY viewer.
 *
 * Shows the entire filesystem under the project's root, unfiltered.
 * Each node is rendered with a membership indicator:
 *   - Main    (project's language color)
 *   - Config  (config color)
 *   - Both    (split indicator)
 *   - Neither (muted)
 *
 * Membership is *derived* from the current automation, not from .craidd.
 * Save is a no-op with a "coming in 2.1.3" note. This phase is a mirror,
 * not a control — its purpose is to let us eyeball the model before we
 * commit it to the file format.
 */

type Mode = "fine-tune" | "recalibrate";

interface Props {
  project: CraiddProject;
  projectBaseAbs: string;
  mode: Mode;
  onClose: () => void;
}

type Membership = "main" | "config" | "both" | "neither";

interface TreeNode {
  node: FileNode;
  membership: Membership;
  depth: number;
}

const CONFIG_EXTS = ["json", "toml", "yaml", "yml", "ini", "conf"];

function hasExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".d.ts") && exts.includes("d.ts")) return true;
  if (!lower.includes(".")) return false;
  return exts.some((e) => lower.endsWith("." + e.toLowerCase()));
}

function classifyFile(
  name: string,
  project: CraiddProject,
  depth: number
): Membership {
  // Depth > 0 (i.e. deeper than the root of the project) is never
  // auto-included. Automation never descends.
  if (depth > 0) return "neither";

  const lang = project.language;
  const mainHit = lang && lang !== "config"
    ? hasExt(name, projectExtensions(lang)) ||
      projectWellKnownFiles(lang).some((w) => w === name)
    : false;

  const configHit =
    project.configEnabled &&
    hasExt(name, CONFIG_EXTS);

  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function classifyFolder(
  folder: FileNode,
  project: CraiddProject,
  depth: number
): Membership {
  if (depth > 0) return "neither";
  // A folder's membership is derived from whether it contains any
  // direct child matching each category. We do NOT descend.
  const children = folder.children ?? [];
  const lang = project.language;
  const mainHit = lang && lang !== "config"
    ? children.some(
        (c) =>
          c.kind === "file" &&
          (hasExt(c.name, projectExtensions(lang)) ||
            projectWellKnownFiles(lang).some((w) => w === c.name))
      )
    : false;
  const configHit =
    project.configEnabled &&
    children.some((c) => c.kind === "file" && hasExt(c.name, CONFIG_EXTS));

  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function membershipOf(
  node: FileNode,
  project: CraiddProject,
  depth: number
): Membership {
  return node.kind === "folder"
    ? classifyFolder(node, project, depth)
    : classifyFile(node.name, project, depth);
}

function flatten(
  node: FileNode | null | undefined,
  project: CraiddProject,
  depth: number,
  openSet: Set<string>,
  out: TreeNode[]
): void {
  if (!node || !node.children) return;
  const sorted = [...node.children].sort((a, b) => {
    const ka = a.kind === "folder" ? 0 : 1;
    const kb = b.kind === "folder" ? 0 : 1;
    return ka - kb || a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const child of sorted) {
    const m = membershipOf(child, project, depth);
    out.push({ node: child, membership: m, depth });
    if (child.kind === "folder" && openSet.has(child.id)) {
      flatten(child, project, depth + 1, openSet, out);
    }
  }
}

const COLOR_MAIN = "#60a5fa";  // blue-400
const COLOR_CFG  = "#a1a1aa";  // zinc-400

function MemberChip({ m, languageColor }: { m: Membership; languageColor: string }) {
  if (m === "neither") {
    return (
      <span
        title="Not a member"
        className="inline-block w-3.5 h-3.5 rounded-sm border border-zinc-700 bg-zinc-900/40"
      />
    );
  }
  if (m === "both") {
    return (
      <span
        title="In project and config"
        className="inline-flex w-3.5 h-3.5 rounded-sm overflow-hidden border border-zinc-700"
      >
        <span className="w-1/2 h-full" style={{ background: languageColor }} />
        <span className="w-1/2 h-full" style={{ background: COLOR_CFG }} />
      </span>
    );
  }
  if (m === "config") {
    return (
      <span
        title="Config member"
        className="inline-block w-3.5 h-3.5 rounded-sm"
        style={{ background: COLOR_CFG }}
      />
    );
  }
  return (
    <span
      title="Project member"
      className="inline-block w-3.5 h-3.5 rounded-sm"
      style={{ background: languageColor }}
    />
  );
}

export default function FineTuneDialog({ project, projectBaseAbs, mode, onClose }: Props) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());

  const languageColor =
    project.language && project.language !== "config"
      ? tailwindToHex(languageMeta(project.language).color)
      : "#71717a";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<FileNode>("read_dir_tree", {
          path: projectBaseAbs,
        });
        if (!cancelled) setTree(result);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectBaseAbs]);

  const rows = useMemo(() => {
    if (!tree) return [];
    const out: TreeNode[] = [];
    flatten(tree, project, 0, openSet, out);
    return out;
  }, [tree, project, openSet]);

  const toggle = (id: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const counts = useMemo(() => {
    let main = 0, cfg = 0, both = 0;
    for (const r of rows) {
      if (r.membership === "main") main++;
      else if (r.membership === "config") cfg++;
      else if (r.membership === "both") both++;
    }
    return { main, cfg, both };
  }, [rows]);

  const title = mode === "recalibrate"
    ? `Recalibrate — ${project.name}`
    : `Fine Tune — ${project.name}`;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[720px] max-h-[78vh] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 shrink-0">
          <span className="text-sm text-zinc-100 font-medium">{title}</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
            read-only preview
          </span>
          <span className="ml-auto text-[11px] text-zinc-500">
            {counts.main} main · {counts.cfg} config · {counts.both} both
          </span>
        </div>

        <div className="px-4 py-2 border-b border-zinc-800 text-[11px] text-zinc-500 shrink-0">
          Root: <span className="font-mono text-zinc-300">{projectBaseAbs}</span>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin py-2">
          {error && (
            <div className="px-4 py-3 text-[11px] text-red-400 bg-red-950/40 border-b border-red-900/60">
              {error}
            </div>
          )}
          {!tree && !error && (
            <div className="px-4 py-6 text-[12px] text-zinc-600 italic">Loading…</div>
          )}
          {tree && rows.length === 0 && (
            <div className="px-4 py-6 text-[12px] text-zinc-600 italic">Empty folder.</div>
          )}
          {rows.map((row) => {
            const isFolder = row.node.kind === "folder";
            const isOpen = openSet.has(row.node.id);
            return (
              <div
                key={row.node.id || row.node.path}
                onClick={() => isFolder && toggle(row.node.id)}
                style={{ paddingLeft: `${12 + row.depth * 14}px` }}
                className={
                  "flex items-center gap-2 pr-3 py-[3px] text-[12.5px] select-none " +
                  (isFolder ? "cursor-pointer hover:bg-zinc-800/60" : "")
                }
              >
                {isFolder ? (
                  <svg
                    className={
                      "w-3 h-3 text-zinc-500 shrink-0 transition-transform " +
                      (isOpen ? "rotate-90" : "")
                    }
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                ) : (
                  <span className="w-3 shrink-0" />
                )}

                <MemberChip m={row.membership} languageColor={languageColor} />

                <span
                  className={
                    "truncate " +
                    (row.membership === "neither" ? "text-zinc-500" : "text-zinc-200")
                  }
                >
                  {row.node.name}
                </span>

                {isFolder && (
                  <span className="ml-auto text-[10px] text-zinc-600">
                    {row.node.children?.length ?? 0}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-zinc-800 text-[11px] text-zinc-500 shrink-0 leading-5">
          Membership is derived from the current automation (extension + boundary rules).
          <br />
          <span className="text-zinc-600">
            Deep nodes are never auto-included. Editing &amp; persistence land in 2.1.3.
          </span>
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
          <button
            disabled
            title="Editable membership arrives in Phase 2.1.3"
            className="px-3 py-1 rounded text-xs bg-blue-900/50 text-blue-300/70 cursor-not-allowed"
          >
            Save (2.1.3)
          </button>
        </div>
      </div>
    </div>
  );
}

function tailwindToHex(cls: string): string {
  // Tiny lookup for the colors we actually emit from languageMeta().
  const map: Record<string, string> = {
    "text-orange-400": "#fb923c",
    "text-blue-400": "#60a5fa",
    "text-yellow-400": "#facc15",
    "text-green-400": "#4ade80",
    "text-purple-400": "#c084fc",
    "text-violet-400": "#a78bfa",
    "text-zinc-400": "#a1a1aa",
  };
  return map[cls] ?? "#a1a1aa";
}
TSEOF

# ─────────────────────────────────────────────────────────
# 4. SolutionExplorer.tsx — wire FineTuneDialog + two menu items
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/components/sidebar/solution/SolutionExplorer.tsx")
text = p.read_text()

# Import
if 'from "../../dialogs/FineTuneDialog"' not in text:
    text = text.replace(
        'import NewFolderDialog from "../../dialogs/NewFolderDialog";',
        'import NewFolderDialog from "../../dialogs/NewFolderDialog";\n'
        'import FineTuneDialog from "../../dialogs/FineTuneDialog";',
        1,
    )

# State
anchor_state = '  const [declareTarget, setDeclareTarget] = useState<{ path: string; name: string } | null>(null);'
if 'fineTuneTarget' not in text:
    text = text.replace(
        anchor_state,
        anchor_state + '\n'
        '  const [fineTuneTarget, setFineTuneTarget] = useState<{ projectId: string; mode: "fine-tune" | "recalibrate" } | null>(null);',
        1,
    )

# Menu: add Fine Tune / Recalibrate below "Add ▸ New Folder…", before the separator
anchor_menu = '''                >
                  Add ▸ New Folder…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                {!solution?.projects.find((p) => p.id === ctxMenu.projectId)?.configEnabled ? ('''

new_menu = '''                >
                  Add ▸ New Folder…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => {
                    setFineTuneTarget({ projectId: ctxMenu.projectId!, mode: "fine-tune" });
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Fine Tune…
                </button>
                <button
                  onClick={() => {
                    setFineTuneTarget({ projectId: ctxMenu.projectId!, mode: "recalibrate" });
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Recalibrate…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                {!solution?.projects.find((p) => p.id === ctxMenu.projectId)?.configEnabled ? ('''

if 'Fine Tune…' not in text:
    if anchor_menu in text:
        text = text.replace(anchor_menu, new_menu, 1)
        print("  · menu items added")
    else:
        print("  · WARNING: menu anchor not found — manual patch needed")
else:
    print("  · menu items already present")

# Dialog render: add before closing `</div>` of the outer container,
# alongside the other dialogs. Anchor on declareTarget block.
anchor_render = '''      {declareTarget && (
        <DeclarePlaceholderDialog
          projectPath={declareTarget.path}
          guessedName={declareTarget.name}
          onClose={() => setDeclareTarget(null)}
        />
      )}'''

new_render = anchor_render + '''
      {fineTuneTarget && (() => {
        const project = solution?.projects.find((p) => p.id === fineTuneTarget.projectId);
        if (!project || !rootPath) return null;
        const base = project.external
          ? (project.path.startsWith("/")
              ? project.path.slice(0, project.path.lastIndexOf("/"))
              : `${rootPath.replace(/\\/+$/, "")}/${project.path.slice(0, project.path.lastIndexOf("/"))}`)
          : projectBasePath(project.folder);
        return (
          <FineTuneDialog
            project={project}
            projectBaseAbs={base}
            mode={fineTuneTarget.mode}
            onClose={() => setFineTuneTarget(null)}
          />
        );
      })()}'''

if 'FineTuneDialog' in text and 'fineTuneTarget &&' not in text:
    if anchor_render in text:
        text = text.replace(anchor_render, new_render, 1)
        print("  · dialog render added")
    else:
        print("  · WARNING: render anchor not found — manual patch needed")
else:
    print("  · dialog render already present")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 5. FileDiscovery.tsx — fix root path duplication
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/components/sidebar/discovery/FileDiscovery.tsx")
text = p.read_text()

old = '''  const absPathFor = (node: FileNode) => {
    if (!rootPath) return "";
    const rel = node.path && node.path !== "." ? node.path : node.name;
    return `${rootPath.replace(/\\/+$/, "")}/${rel.replace(/^\\/+/, "")}`;
  };'''

new = '''  const absPathFor = (node: FileNode) => {
    if (!rootPath) return "";
    // Root node: return rootPath as-is. Appending node.name duplicates
    // the folder when the root's name matches its parent path segment.
    if (!node.path || node.path === ".") return rootPath;
    return `${rootPath.replace(/\\/+$/, "")}/${node.path.replace(/^\\/+/, "")}`;
  };'''

if old in text:
    text = text.replace(old, new, 1)
    print("  · FileDiscovery.tsx: root path fixed")
elif "Root node: return rootPath as-is" in text:
    print("  · FileDiscovery.tsx: already fixed")
else:
    print("  · WARNING: absPathFor not matched — manual patch needed")

p.write_text(text)
PYEOF

echo ""
echo "✓ Phase 2.1.2 applied."
echo ""
echo "  Fixed:"
echo "    src/lib/languages.ts"
echo "      — TypeScript now matches .d.ts and vite-env.d.ts"
echo "    src/store/solutionStore.ts"
echo "      — Config tree now respects .craidd boundaries"
echo "        (stop_at_craidd = true)"
echo "    src/components/sidebar/discovery/FileDiscovery.tsx"
echo "      — root path duplication fixed"
echo ""
echo "  Added:"
echo "    src/components/dialogs/FineTuneDialog.tsx"
echo "      — read-only membership viewer (4-state: main/config/both/neither)"
echo "      — no auto-inclusion beyond depth 1"
echo "      — Save is a no-op until 2.1.3"
echo ""
echo "  Modified:"
echo "    src/components/sidebar/solution/SolutionExplorer.tsx"
echo "      — menu: Fine Tune… / Recalibrate… (both open the viewer for now)"
echo "      — dialog wired for the currently selected project"
echo ""
echo "Next:"
echo "  # Vite dev server hot-reloads automatically."
echo "  # If the overlay is stuck, press Esc or restart:"
echo "  npm run tauri dev"
echo ""
echo "  # Verify in the running app:"
echo "  #   1. Right-click a project -> Fine Tune… -> viewer opens,"
echo "  #      shows project root, every file/folder with a membership chip."
echo "  #   2. Right-click the same project -> Recalibrate… -> same viewer,"
echo "  #      different title."
echo "  #   3. Right-click a folder in File Discovery at the root ->"
echo "  #      New Folder / New File -> path is not duplicated."
echo "  #   4. Rust project's Config subtree no longer leaks src-tauri/Cargo.toml."
echo "  #   5. TypeScript project now surfaces vite-env.d.ts as a candidate"
echo "  #      (only in the fine-tune viewer, not yet in the sidebar)."