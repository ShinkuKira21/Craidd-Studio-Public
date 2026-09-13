#!/usr/bin/env bash
# Craidd-Studio — Phase 2.1.2.1: Fine-Tune viewer polish + critical-root banner + Monaco syntax
# Safe to re-run: overwrites generated files, doesn't touch user data.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "▸ Applying Phase 2.1.2.1..."

mkdir -p src/components/dialogs
mkdir -p src/components/layout
mkdir -p src/lib

# ─────────────────────────────────────────────────────────
# 1. lib/languages.ts — add monacoLanguageForFilename helper
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/lib/languages.ts")
text = p.read_text()

helper = '''

/**
 * Monaco language id for a filename. Purely cosmetic — controls syntax
 * highlighting in the editor tab. Does NOT affect project classification.
 * Extensions declare nothing here; they only pick a lexer.
 */
export function monacoLanguageForFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  if (lower === ".gitignore" || lower === ".env") return "plaintext";
  const parts = lower.split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1] : "";

  switch (ext) {
    case "rs": return "rust";
    case "ts": case "tsx": case "mts": case "cts": return "typescript";
    case "js": case "jsx": case "mjs": case "cjs": return "javascript";
    case "json": case "jsonc": return "json";
    case "toml": return "ini";              // Monaco doesn't ship TOML; ini lexer is close enough
    case "yaml": case "yml": return "yaml";
    case "ini": case "conf": return "ini";
    case "md": case "markdown": return "markdown";
    case "html": case "htm": return "html";
    case "css": return "css";
    case "scss": return "scss";
    case "less": return "less";
    case "xml": return "xml";
    case "svg": return "xml";
    case "sh": case "bash": case "zsh": return "shell";
    case "py": return "python";
    case "c": case "h": return "c";
    case "cpp": case "cc": case "cxx": case "hpp": case "hxx": return "cpp";
    case "cs": return "csharp";
    case "java": return "java";
    case "go": return "go";
    case "rb": return "ruby";
    case "php": return "php";
    case "sql": return "sql";
    case "lua": return "lua";
    case "kt": case "kts": return "kotlin";
    case "swift": return "swift";
    case "dart": return "dart";
    case "r": return "r";
    case "pl": return "perl";
    case "hs": return "haskell";
    case "ex": case "exs": return "elixir";
    case "clj": case "cljs": return "clojure";
    case "scala": return "scala";
    case "fs": case "fsx": return "fsharp";
    case "vb": return "vb";
    case "ps1": return "powershell";
    case "bat": case "cmd": return "bat";
    case "graphql": case "gql": return "graphql";
    case "proto": return "protobuf";
    default: return "plaintext";
  }
}
'''

if "monacoLanguageForFilename" not in text:
    text = text.rstrip() + helper + "\n"
    print("  · languages.ts: monacoLanguageForFilename added")
else:
    print("  · languages.ts: helper already present")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 2. types/project.ts — add monacoLanguage to EditorTab
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/types/project.ts")
text = p.read_text()

old = '''export interface EditorTab {
  fileId: string;
  name: string;
  language: Language | "plaintext";
  content: string;
}'''

new = '''export interface EditorTab {
  fileId: string;
  name: string;
  language: Language | "plaintext";
  monacoLanguage: string;
  content: string;
}'''

if old in text:
    text = text.replace(old, new, 1)
    print("  · types/project.ts: EditorTab.monacoLanguage added")
elif "monacoLanguage: string;" in text:
    print("  · types/project.ts: already patched")
else:
    print("  · WARNING: EditorTab block not found")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 3. store/solutionStore.ts
#    - openFile sets monacoLanguage
#    - add rootMissing state + markRootMissing action
#    - refreshDiscovery detects missing root
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/store/solutionStore.ts")
text = p.read_text()

# Import monacoLanguageForFilename
old_import = 'import { languageFromFilename, projectExtensions, projectWellKnownFiles, languageMeta } from "../lib/languages";'
new_import = 'import { languageFromFilename, monacoLanguageForFilename, projectExtensions, projectWellKnownFiles, languageMeta } from "../lib/languages";'
if old_import in text:
    text = text.replace(old_import, new_import, 1)
    print("  · store: import updated")

# Add rootMissing to interface
old_iface = '  bannerState: BannerState;\n  bannerMessage: string | null;'
new_iface = '  bannerState: BannerState;\n  bannerMessage: string | null;\n  rootMissing: boolean;'
if old_iface in text and 'rootMissing: boolean;' not in text:
    text = text.replace(old_iface, new_iface, 1)
    print("  · store: interface updated")

# Add rootMissing init
old_init = '  bannerState: "none",\n  bannerMessage: null,\n  pendingAncestor: null,'
new_init = '  bannerState: "none",\n  bannerMessage: null,\n  rootMissing: false,\n  pendingAncestor: null,'
if old_init in text and 'rootMissing: false' not in text:
    text = text.replace(old_init, new_init, 1)
    print("  · store: init updated")

# Set rootMissing false on successful openFolder/openSolution
# (both go through set({ ... bannerState: "none" ... })). Add rootMissing: false.
text = text.replace(
    'bannerState: "none",\n      bannerMessage: null,\n      pendingAncestor: null,\n      pendingPath: null,\n      bannerAncestor: null,\n    });',
    'bannerState: "none",\n      bannerMessage: null,\n      rootMissing: false,\n      pendingAncestor: null,\n      pendingPath: null,\n      bannerAncestor: null,\n    });',
)

# refreshDiscovery: detect missing root and set rootMissing + clear tabs
old_refresh = '''  refreshDiscovery: async () => {
    const state = get();
    if (!state.rootPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_tree", { path: state.rootPath });
      set({ discovery });
    } catch (err) {
      logErr("refreshDiscovery failed:", err);
    }
  },'''

new_refresh = '''  refreshDiscovery: async () => {
    const state = get();
    if (!state.rootPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const discovery = await invoke<FileNode>("read_dir_tree", { path: state.rootPath });
      set({ discovery, rootMissing: false });
    } catch (err) {
      const msg = String(err);
      if (msg.includes("does not exist") || msg.includes("No such file")) {
        logErr("refreshDiscovery: root folder is gone:", state.rootPath);
        set({
          rootMissing: true,
          solution: null,
          discovery: null,
          tabs: [],
          activeFileId: null,
          bannerState: "none",
          bannerMessage: null,
        });
      } else {
        logErr("refreshDiscovery failed:", err);
      }
    }
  },

  clearRootMissing: () => set({
    rootMissing: false,
    rootPath: null,
    solution: null,
    discovery: null,
    tabs: [],
    activeFileId: null,
    bannerState: "none",
    bannerMessage: null,
    pendingAncestor: null,
    pendingPath: null,
    bannerAncestor: null,
  }),'''

if 'refreshDiscovery: async () => {' in text and 'rootMissing: true,' not in text:
    if old_refresh in text:
        text = text.replace(old_refresh, new_refresh, 1)
        print("  · store: refreshDiscovery + clearRootMissing")
    else:
        print("  · WARNING: refreshDiscovery body not matched")
else:
    print("  · store: refreshDiscovery already patched")

# Add clearRootMissing to interface
old_iface_fn = '  refreshDiscovery: () => Promise<void>;'
new_iface_fn = '  refreshDiscovery: () => Promise<void>;\n  clearRootMissing: () => void;'
if old_iface_fn in text and 'clearRootMissing: () => void;' not in text:
    text = text.replace(old_iface_fn, new_iface_fn, 1)
    print("  · store: clearRootMissing added to interface")

# openFile: set monacoLanguage
old_openfile = '''      const content = await invoke<string>("read_file", { path: absolutePath });
      const language = languageFromFilename(fileName);
      const tab: EditorTab = { fileId: absolutePath, name: fileName, language, content };'''

new_openfile = '''      const content = await invoke<string>("read_file", { path: absolutePath });
      const language = languageFromFilename(fileName);
      const monacoLanguage = monacoLanguageForFilename(fileName);
      const tab: EditorTab = { fileId: absolutePath, name: fileName, language, monacoLanguage, content };'''

if old_openfile in text and 'monacoLanguage,' not in text:
    text = text.replace(old_openfile, new_openfile, 1)
    print("  · store: openFile sets monacoLanguage")
elif 'const monacoLanguage = monacoLanguageForFilename' in text:
    print("  · store: openFile already patched")
else:
    print("  · WARNING: openFile body not matched")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 4. CodeView.tsx — pass monacoLanguage to <Editor>
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/components/editor/CodeView.tsx")
text = p.read_text()

old = '        language={active.language === "plaintext" ? "plaintext" : active.language}'
new = '        language={active.monacoLanguage}'
if old in text:
    text = text.replace(old, new, 1)
    print("  · CodeView.tsx: uses monacoLanguage")
elif 'language={active.monacoLanguage}' in text:
    print("  · CodeView.tsx: already patched")
else:
    print("  · WARNING: CodeView language prop not matched")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 5. NEW: CriticalWorkspaceBanner.tsx
# ─────────────────────────────────────────────────────────
cat > src/components/layout/CriticalWorkspaceBanner.tsx << 'TSEOF'
import { useSolution } from "../../store/solutionStore";

/**
 * Shown when the workspace root folder has been deleted from outside
 * the application. The app must not silently reset — it must tell the
 * user what happened and offer a path forward.
 */
export default function CriticalWorkspaceBanner() {
  const rootMissing = useSolution((s) => s.rootMissing);
  const clearRootMissing = useSolution((s) => s.clearRootMissing);
  const openFolder = useSolution((s) => s.openFolder);

  if (!rootMissing) return null;

  const handleOpenFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      clearRootMissing();
      await openFolder(selected);
    } catch (err) {
      console.error("[craidd] critical banner: open folder failed:", err);
    }
  };

  const handleCreateNew = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      clearRootMissing();
      await openFolder(selected);
    } catch (err) {
      console.error("[craidd] critical banner: create new failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[560px] bg-zinc-900 border border-red-900/70 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-red-900/50 bg-red-950/30">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
            <div className="text-sm text-red-200 font-medium">
              Critical: Workspace deleted from outside the application
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3 text-xs">
          <div className="text-zinc-400 leading-5">
            The folder this workspace was rooted in no longer exists. This usually means
            the folder was moved, renamed, or deleted by another process.
          </div>
          <div className="text-zinc-500 leading-5">
            No edits have been lost — the editor was not writable in this phase.
            Open a folder to continue, or create a new solution.
          </div>

          <div className="grid gap-2 pt-1">
            <button
              onClick={handleOpenFolder}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Open Folder…</div>
              <div className="text-zinc-500 text-[11px]">Pick an existing folder on disk</div>
            </button>

            <button
              onClick={handleCreateNew}
              className="w-full text-left px-3 py-2 rounded border border-zinc-700 hover:border-blue-500 hover:bg-blue-950/30"
            >
              <div className="text-zinc-100 font-medium">Create New Solution…</div>
              <div className="text-zinc-500 text-[11px]">Pick a folder and declare it as a new solution</div>
            </button>

            <button
              disabled
              title="Restore from file preservation memory arrives in Phase 7"
              className="w-full text-left px-3 py-2 rounded border border-zinc-800 opacity-50 cursor-not-allowed"
            >
              <div className="text-zinc-500 font-medium">Restore Project from File Preservation Memory</div>
              <div className="text-zinc-600 text-[11px]">Phase 7</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
TSEOF

# ─────────────────────────────────────────────────────────
# 6. AppShell.tsx — render the critical banner
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/components/layout/AppShell.tsx")
text = p.read_text()

if 'CriticalWorkspaceBanner' not in text:
    text = text.replace(
        'import AncestorSolutionDialog from "../dialogs/AncestorSolutionDialog";',
        'import AncestorSolutionDialog from "../dialogs/AncestorSolutionDialog";\n'
        'import CriticalWorkspaceBanner from "./CriticalWorkspaceBanner";',
        1,
    )
    text = text.replace(
        '      <AncestorSolutionDialog />',
        '      <AncestorSolutionDialog />\n'
        '      <CriticalWorkspaceBanner />',
        1,
    )
    print("  · AppShell.tsx: banner wired")
else:
    print("  · AppShell.tsx: banner already wired")

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 7. FineTuneDialog.tsx — hide .craidd, dual-root, empty guard
# ─────────────────────────────────────────────────────────
cat > src/components/dialogs/FineTuneDialog.tsx << 'TSEOF'
import { useEffect, useMemo, useState } from "react";
import type { CraiddProject, FileNode } from "../../types/project";
import { languageMeta, projectExtensions, projectWellKnownFiles } from "../../lib/languages";

/**
 * Phase 2.1.2.1 — READ-ONLY viewer.
 *
 * Shows the filesystem under the project's root (and, when the config
 * has a declared non-default location, a second section for the config
 * root). Every `.craidd` is hidden — it's a declaration, not content.
 *
 * Membership is derived from the current automation (extensions +
 * depth-1 rule). Save is a no-op until 2.1.3.
 */

type Mode = "fine-tune" | "recalibrate";

interface Props {
  project: CraiddProject;
  projectBaseAbs: string;
  configBaseAbs: string | null;   // null → single-section mode
  mode: Mode;
  onClose: () => void;
}

type Membership = "main" | "config" | "both" | "neither";

interface TreeNode {
  node: FileNode;
  membership: Membership;
  depth: number;
  section: "project" | "config";
}

const CONFIG_EXTS = ["json", "toml", "yaml", "yml", "ini", "conf"];

function hasExt(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".d.ts") && exts.includes("d.ts")) return true;
  if (!lower.includes(".")) return false;
  return exts.some((e) => lower.endsWith("." + e.toLowerCase()));
}

function isCraidd(name: string): boolean {
  return name.toLowerCase().endsWith(".craidd");
}

function classifyFile(name: string, project: CraiddProject, depth: number): Membership {
  if (depth > 0) return "neither";
  const lang = project.language;
  const mainHit = lang && lang !== "config"
    ? hasExt(name, projectExtensions(lang)) ||
      projectWellKnownFiles(lang).some((w) => w === name)
    : false;
  const configHit = project.configEnabled && hasExt(name, CONFIG_EXTS);
  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function classifyFolder(folder: FileNode, project: CraiddProject, depth: number): Membership {
  if (depth > 0) return "neither";
  const children = folder.children ?? [];
  const lang = project.language;
  const mainHit = lang && lang !== "config"
    ? children.some(
        (c) =>
          c.kind === "file" &&
          !isCraidd(c.name) &&
          (hasExt(c.name, projectExtensions(lang)) ||
            projectWellKnownFiles(lang).some((w) => w === c.name))
      )
    : false;
  const configHit =
    project.configEnabled &&
    children.some((c) => c.kind === "file" && !isCraidd(c.name) && hasExt(c.name, CONFIG_EXTS));
  if (mainHit && configHit) return "both";
  if (mainHit) return "main";
  if (configHit) return "config";
  return "neither";
}

function membershipOf(node: FileNode, project: CraiddProject, depth: number): Membership {
  if (isCraidd(node.name)) return "neither";
  return node.kind === "folder"
    ? classifyFolder(node, project, depth)
    : classifyFile(node.name, project, depth);
}

function flatten(
  node: FileNode | null | undefined,
  project: CraiddProject,
  depth: number,
  section: "project" | "config",
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
    if (isCraidd(child.name)) continue;
    const m = membershipOf(child, project, depth);
    const key = section + ":" + child.id;
    out.push({ node: child, membership: m, depth, section });
    if (child.kind === "folder" && openSet.has(key)) {
      flatten(child, project, depth + 1, section, openSet, out);
    }
  }
}

const COLOR_CFG = "#a1a1aa";

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

function Section({
  title,
  rootAbs,
  tree,
  project,
  section,
  openSet,
  toggle,
  languageColor,
}: {
  title: string;
  rootAbs: string;
  tree: FileNode | null;
  project: CraiddProject;
  section: "project" | "config";
  openSet: Set<string>;
  toggle: (key: string) => void;
  languageColor: string;
}) {
  const rows = useMemo(() => {
    const out: TreeNode[] = [];
    flatten(tree, project, 0, section, openSet, out);
    return out;
  }, [tree, project, section, openSet]);

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <div className="px-4 py-2 bg-zinc-950/60">
        <div className="text-[11px] text-zinc-400 font-medium">{title}</div>
        <div className="text-[10.5px] text-zinc-500 font-mono truncate">{rootAbs}</div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-3 text-[11px] text-zinc-600 italic">Empty.</div>
      ) : (
        rows.map((row) => {
          const isFolder = row.node.kind === "folder";
          const key = section + ":" + row.node.id;
          const isOpen = openSet.has(key);
          return (
            <div
              key={key}
              onClick={() => isFolder && toggle(key)}
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
                  "truncate " + (row.membership === "neither" ? "text-zinc-500" : "text-zinc-200")
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
        })
      )}
    </div>
  );
}

export default function FineTuneDialog({
  project,
  projectBaseAbs,
  configBaseAbs,
  mode,
  onClose,
}: Props) {
  const [projectTree, setProjectTree] = useState<FileNode | null>(null);
  const [configTree, setConfigTree] = useState<FileNode | null>(null);
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
        const pt = await invoke<FileNode>("read_dir_tree", { path: projectBaseAbs });
        if (cancelled) return;
        setProjectTree(pt);
        if (configBaseAbs && configBaseAbs !== projectBaseAbs) {
          const ct = await invoke<FileNode>("read_dir_tree", { path: configBaseAbs });
          if (!cancelled) setConfigTree(ct);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectBaseAbs, configBaseAbs]);

  const toggle = (key: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const title = mode === "recalibrate"
    ? `Recalibrate — ${project.name}`
    : `Fine Tune — ${project.name}`;

  const dualRoot = !!configBaseAbs && configBaseAbs !== projectBaseAbs;

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
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin">
          {error && (
            <div className="px-4 py-3 text-[11px] text-red-400 bg-red-950/40 border-b border-red-900/60">
              {error}
            </div>
          )}
          {!projectTree && !error && (
            <div className="px-4 py-6 text-[12px] text-zinc-600 italic">Loading…</div>
          )}
          {projectTree && !dualRoot && (
            <Section
              title="Project Root"
              rootAbs={projectBaseAbs}
              tree={projectTree}
              project={project}
              section="project"
              openSet={openSet}
              toggle={toggle}
              languageColor={languageColor}
            />
          )}
          {projectTree && dualRoot && (
            <Section
              title="Project Root"
              rootAbs={projectBaseAbs}
              tree={projectTree}
              project={project}
              section="project"
              openSet={openSet}
              toggle={toggle}
              languageColor={languageColor}
            />
          )}
          {dualRoot && configTree && (
            <Section
              title="Config Root"
              rootAbs={configBaseAbs!}
              tree={configTree}
              project={project}
              section="config"
              openSet={openSet}
              toggle={toggle}
              languageColor={languageColor}
            />
          )}
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
# 8. SolutionExplorer.tsx
#    - pass configBaseAbs to FineTuneDialog
#    - grey out Fine Tune / Recalibrate when project is empty
#    - wire "pendingFineTuneId" for MakeProjectDialog flow
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/components/sidebar/solution/SolutionExplorer.tsx")
text = p.read_text()

# --- 8a. Add configBase computation helper next to projectBasePath ---
old_helper = '''  const projectBasePath = (projectFolder: string) => {
    if (!rootPath) return "";
    return projectFolder === "." || projectFolder === ""
      ? rootPath
      : `${rootPath.replace(/\\/+$/, "")}/${projectFolder.replace(/^\\/+/, "")}`;
  };'''

new_helper = old_helper + '''

  const configBasePath = (project: { folder: string; configEnabled: boolean; configDirectory?: string }) => {
    if (!project.configEnabled) return null;
    const base = projectBasePath(project.folder);
    const dir = project.configDirectory;
    if (!dir || dir === "." || dir === "") return base;
    // Resolve relative to the project folder; ".." allowed by user
    const baseParts = base.replace(/\\/+$/, "").split("/").filter(Boolean);
    const relParts = dir.replace(/^\\/+/, "").split("/");
    for (const part of relParts) {
      if (part === "." || part === "") continue;
      if (part === "..") baseParts.pop();
      else baseParts.push(part);
    }
    return "/" + baseParts.join("/");
  };

  /**
   * A project is "empty for our purposes" when the Fine Tune dialog
   * would render zero non-.craidd rows in either root.
   * Cheap heuristic: language tree or config tree has at least one child
   * that isn't a .craidd.
   */
  const isProjectEmpty = (project: typeof solution.projects[number]) => {
    const hasNonCraidd = (n: FileNode | null | undefined): boolean => {
      if (!n || !n.children) return false;
      for (const c of n.children) {
        if (c.name.toLowerCase().endsWith(".craidd")) continue;
        return true;
      }
      return false;
    };
    const langHit = hasNonCraidd(project.tree);
    const cfgHit = project.configEnabled && hasNonCraidd(project.configTree);
    return !langHit && !cfgHit;
  };'''

if old_helper in text and 'configBasePath' not in text:
    text = text.replace(old_helper, new_helper, 1)
    print("  · explorer: configBasePath + isProjectEmpty added")
elif 'configBasePath' in text:
    print("  · explorer: helpers already present")
else:
    print("  · WARNING: projectBasePath helper not matched")

# --- 8b. Import FileNode for isProjectEmpty typing ---
if 'import type { Language }' in text and 'FileNode' not in text.split("\n")[0:20].__str__():
    text = text.replace(
        'import type { Language } from "../../../types/project";',
        'import type { Language, FileNode } from "../../../types/project";',
        1,
    )

# --- 8c. Add pendingFineTuneId state ---
anchor_state = '  const [fineTuneTarget, setFineTuneTarget] = useState<{ projectId: string; mode: "fine-tune" | "recalibrate" } | null>(null);'
if 'pendingFineTuneName' not in text and anchor_state in text:
    text = text.replace(
        anchor_state,
        anchor_state + '\n'
        '  const [pendingFineTuneName, setPendingFineTuneName] = useState<string | null>(null);',
        1,
    )
    print("  · explorer: pendingFineTuneName state added")

# --- 8d. Menu: add empty guard to Fine Tune / Recalibrate ---
old_ft_menu = '''                <button
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
                </button>'''

new_ft_menu = '''                {(() => {
                  const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                  const empty = !project || isProjectEmpty(project);
                  const baseCls = "w-full px-3 py-1 text-left ";
                  const enabledCls = "text-zinc-200 hover:bg-blue-700 hover:text-white";
                  const disabledCls = "text-zinc-600 cursor-default";
                  return (
                    <>
                      <button
                        disabled={empty}
                        onClick={() => {
                          if (empty) return;
                          setFineTuneTarget({ projectId: ctxMenu.projectId!, mode: "fine-tune" });
                          setCtxMenu(null);
                        }}
                        className={baseCls + (empty ? disabledCls : enabledCls)}
                      >
                        Fine Tune…
                      </button>
                      <button
                        disabled={empty}
                        onClick={() => {
                          if (empty) return;
                          setFineTuneTarget({ projectId: ctxMenu.projectId!, mode: "recalibrate" });
                          setCtxMenu(null);
                        }}
                        className={baseCls + (empty ? disabledCls : enabledCls)}
                      >
                        Recalibrate…
                      </button>
                    </>
                  );
                })()}'''

if old_ft_menu in text and 'isProjectEmpty(project)' not in text:
    text = text.replace(old_ft_menu, new_ft_menu, 1)
    print("  · explorer: menu empty-guard wired")
elif 'isProjectEmpty(project)' in text:
    print("  · explorer: menu already guarded")
else:
    print("  · WARNING: Fine Tune menu block not matched")

# --- 8e. FineTuneDialog render: pass configBaseAbs ---
old_render_call = '''        return (
          <FineTuneDialog
            project={project}
            projectBaseAbs={base}
            mode={fineTuneTarget.mode}
            onClose={() => setFineTuneTarget(null)}
          />
        );'''
new_render_call = '''        return (
          <FineTuneDialog
            project={project}
            projectBaseAbs={base}
            configBaseAbs={configBasePath(project)}
            mode={fineTuneTarget.mode}
            onClose={() => setFineTuneTarget(null)}
          />
        );'''

if old_render_call in text and 'configBaseAbs={configBasePath' not in text:
    text = text.replace(old_render_call, new_render_call, 1)
    print("  · explorer: FineTuneDialog gets configBaseAbs")
elif 'configBaseAbs={configBasePath' in text:
    print("  · explorer: render already patched")
else:
    print("  · WARNING: FineTuneDialog render call not matched")

# --- 8f. NewProjectDialog: open Fine Tune after creation when pendingFineTuneName matches ---
old_new_project = '      {newOpen && <NewProjectDialog onClose={() => setNewOpen(false)} />}'
new_new_project = '''      {newOpen && (
        <NewProjectDialog
          onClose={(opts) => {
            setNewOpen(false);
            if (opts?.fineTuneAfter) setPendingFineTuneName(opts.projectName ?? null);
          }}
        />
      )}'''
if old_new_project in text and 'fineTuneAfter' not in text:
    text = text.replace(old_new_project, new_new_project, 1)
    print("  · explorer: NewProjectDialog callback wired")
else:
    print("  · explorer: NewProjectDialog already wired")

# --- 8g. Effect: auto-open Fine Tune when pendingFineTuneName resolves ---
# Insert an effect just after the useState block. We piggyback on `solution`.
old_effect_anchor = '  const toggle = (id: string) =>'
new_effect = '''  // Auto-open Fine Tune for a freshly created project if requested.
  useEffect(() => {
    if (!pendingFineTuneName || !solution) return;
    const created = solution.projects.find((p) => p.name === pendingFineTuneName);
    if (created) {
      setFineTuneTarget({ projectId: created.id, mode: "fine-tune" });
      setPendingFineTuneName(null);
    }
  }, [pendingFineTuneName, solution]);

  const toggle = (id: string) =>'''

if old_effect_anchor in text and 'Auto-open Fine Tune' not in text:
    text = text.replace(old_effect_anchor, new_effect, 1)
    print("  · explorer: auto-open effect added")
else:
    print("  · explorer: auto-open effect already present")

# --- 8h. Import useEffect ---
if 'import { useState }' in text and 'useEffect' not in text.split("from \"react\"")[0]:
    text = text.replace('import { useState } from "react";', 'import { useEffect, useState } from "react";', 1)

p.write_text(text)
PYEOF

# ─────────────────────────────────────────────────────────
# 9. NewProjectDialog.tsx — two checkboxes + callback
# ─────────────────────────────────────────────────────────
cat > src/components/dialogs/NewProjectDialog.tsx << 'TSEOF'
import { useState } from "react";
import type { Language } from "../../types/project";
import { LANGUAGES } from "../../lib/languages";
import { useSolution } from "../../store/solutionStore";

interface Props {
  onClose: (opts?: { fineTuneAfter?: boolean; projectName?: string }) => void;
}

export default function NewProjectDialog({ onClose }: Props) {
  const createBlankProject = useSolution((s) => s.createBlankProject);
  const addConfigHere = useSolution((s) => s.addConfigHere);

  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Language>("rust");
  const [withConfig, setWithConfig] = useState(false);
  const [configDir, setConfigDir] = useState(".");
  const [fineTuneAfter, setFineTuneAfter] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showConfigCheckbox = language !== "config";

  const browseConfigDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== "string") return;
      setConfigDir(selected);
    } catch (err) {
      console.error("[craidd] browse config dir failed:", err);
    }
  };

  const submit = async () => {
    setError(null);
    const projectName = name.trim() || "NewProject";
    setSubmitting(true);
    try {
      await createBlankProject({
        name: projectName,
        language,
        subfolder: projectName,
      });

      if (withConfig && showConfigCheckbox) {
        // Locate the project we just created and enable config on it.
        const state = useSolution.getState();
        const created = state.solution?.projects.find((p) => p.name === projectName);
        if (created) {
          if (configDir && configDir !== ".") {
            await useSolution.getState().setConfigDirectory(created.id, configDir);
          } else {
            await addConfigHere(created.id);
          }
        }
      }

      onClose({ fineTuneAfter, projectName });
    } catch (err) {
      console.error("[craidd] NewProjectDialog failed:", err);
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={submitting ? undefined : () => onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          Create Blank Project
        </div>

        <div className="px-4 py-4 space-y-3 text-xs">
          <label className="block">
            <div className="text-zinc-400 mb-1">Project name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
              placeholder="MyProject"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </label>

          <label className="block">
            <div className="text-zinc-400 mb-1">Language</div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              disabled={submitting}
              className="w-full rounded px-2 py-1.5 outline-none disabled:opacity-50"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>

          {showConfigCheckbox && (
            <div className="pt-2 border-t border-zinc-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={withConfig}
                  onChange={(e) => setWithConfig(e.target.checked)}
                  disabled={submitting}
                  className="accent-blue-600"
                />
                <span className="text-zinc-300">Create a Config project too?</span>
              </label>

              {withConfig && (
                <div className="pl-6 space-y-1">
                  <div className="text-zinc-500 text-[11px]">Config directory</div>
                  <div className="flex gap-2">
                    <input
                      value={configDir}
                      onChange={(e) => setConfigDir(e.target.value)}
                      disabled={submitting}
                      placeholder="."
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50 font-mono text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={browseConfigDir}
                      disabled={submitting}
                      className="px-2.5 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Browse…
                    </button>
                  </div>
                  <div className="text-zinc-600 text-[10.5px] leading-4">
                    Relative to the project folder. Use <span className="font-mono">.</span> for
                    the project root, or a subpath like <span className="font-mono">config/</span>.
                    For program-owned config files (states, save data), this is where they live.
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-zinc-800">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={fineTuneAfter}
                onChange={(e) => setFineTuneAfter(e.target.checked)}
                disabled={submitting}
                className="accent-blue-600"
              />
              <span className="text-zinc-300">Fine Tune after creation?</span>
            </label>
            <div className="pl-6 text-zinc-600 text-[10.5px] leading-4 mt-0.5">
              Opens the membership viewer once the project is created.
            </div>
          </div>

          <div className="text-zinc-500 text-[11px] leading-5 pt-3 border-t border-zinc-800">
            Folder <span className="font-mono text-zinc-300">{name || "MyProject"}/</span> will be
            created in the solution root.
          </div>

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={() => onClose()}
            disabled={submitting}
            className="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
TSEOF

# ─────────────────────────────────────────────────────────
# 10. Stray test file detection (warn only, never delete)
# ─────────────────────────────────────────────────────────
echo ""
echo "▸ Checking for stray test files (report only)..."
STRAY_FOUND=0
for f in \
  "src-tauri/src/src.craidd" \
  "src-tauri/tauri-app.cln" \
  "src-tauri/src-tauri/src-tauri.craidd"
do
  if [ -f "$f" ]; then
    echo "  ! stray: $f"
    STRAY_FOUND=1
  fi
done
if [ -d "src-tauri/src-tauri" ]; then
  echo "  ! stray folder: src-tauri/src-tauri/"
  STRAY_FOUND=1
fi
if [ "$STRAY_FOUND" -eq 0 ]; then
  echo "  ✓ no strays detected"
fi

echo ""
echo "✓ Phase 2.1.2.1 applied."
echo ""
echo "  Added:"
echo "    src/components/layout/CriticalWorkspaceBanner.tsx"
echo "      — full-screen recovery state when the root folder"
echo "        disappears from disk (Open Folder / Create New / Phase 7)"
echo "    src/lib/languages.ts"
echo "      — monacoLanguageForFilename() viewer-only lexer map"
echo ""
echo "  Modified:"
echo "    src/types/project.ts"
echo "      — EditorTab gets monacoLanguage"
echo "    src/store/solutionStore.ts"
echo "      — rootMissing state + clearRootMissing()"
echo "      — refreshDiscovery detects missing root"
echo "      — openFile populates monacoLanguage"
echo "    src/components/editor/CodeView.tsx"
echo "      — passes monacoLanguage to Monaco"
echo "    src/components/layout/AppShell.tsx"
echo "      — mounts CriticalWorkspaceBanner"
echo "    src/components/dialogs/FineTuneDialog.tsx"
echo "      — hides every .craidd"
echo "      — dual-root when config has a declared non-default location"
echo "    src/components/sidebar/solution/SolutionExplorer.tsx"
echo "      — Fine Tune / Recalibrate grey out when project is empty"
echo "      — configBaseAbs passed to dialog"
echo "      — auto-open Fine Tune after creation"
echo "    src/components/dialogs/NewProjectDialog.tsx"
echo "      — 'Create a Config project too?' (hidden when lang=config)"
echo "      — config directory input + Browse"
echo "      — 'Fine Tune after creation?'"
echo ""
echo "Next:"
echo "  npm run tauri dev"
echo ""
echo "  # Verify:"
echo "  #   1. Open a .md, .json, .toml, .html → syntax colouring present."
echo "  #   2. Open a project → Fine Tune: no .craidd anywhere in the tree."
echo "  #   3. Frontend TS project (config at ../) → two sections in Fine Tune."
echo "  #   4. Right-click an empty project → Fine Tune / Recalibrate greyed out."
echo "  #   5. Delete the workspace root from outside the app, then click"
echo "  #      Refresh (or reopen a file) → critical banner appears."
echo "  #   6. Make This a Project → dialog shows two checkboxes."
echo "  #      Tick both, create → project appears, config enabled,"
echo "  #      Fine Tune opens automatically."