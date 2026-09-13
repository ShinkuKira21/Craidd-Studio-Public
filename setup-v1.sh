#!/usr/bin/env bash
# Craidd-Studio — Phase 2.1: New File, New Folder
# Safe to re-run: overwrites generated files, doesn't touch user data.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "▸ Applying Phase 2.1 (New File / New Folder)..."

mkdir -p src-tauri/src/commands
mkdir -p src/components/dialogs

# ─────────────────────────────────────────────────────────
# 1. Rust: extend fs.rs with write_file + create_folder
# ─────────────────────────────────────────────────────────
cat > src-tauri/src/commands/fs.rs << 'RUSTEOF'
use std::fs;
use std::path::Path;

use crate::types::FileNode;

const IGNORE_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "bin", "obj",
    "__pycache__", "venv", "coverage", "out", "Pods", "vendor",
];

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read_file({path}) failed: {e}"))
}

#[tauri::command]
pub fn read_dir_tree(path: String) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    build_tree(p, p, None).map_err(|e| format!("read_dir_tree({path}) failed: {e}"))
}

#[tauri::command]
pub fn read_dir_tree_filtered(
    path: String,
    extensions: Vec<String>,
    well_known_files: Vec<String>,
    stop_at_craidd: Option<bool>,
) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    let stop = stop_at_craidd.unwrap_or(false);
    let full = build_tree(p, p, if stop { Some(()) } else { None }).map_err(|e| e.to_string())?;
    Ok(filter_tree(full, &extensions, &well_known_files).unwrap_or(FileNode {
        id: ".".into(),
        name: p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| ".".into()),
        path: ".".into(),
        kind: "folder".to_string(),
        children: Some(vec![]),
    }))
}

/// Create a new file. Refuses if the file already exists.
/// Creates parent directories if needed.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("File already exists: {path}"));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create parent directory for {path}: {e}"))?;
    }
    fs::write(p, content)
        .map_err(|e| format!("write_file({path}) failed: {e}"))
}

/// Create a new folder. Refuses if the folder already exists.
/// Creates parent directories if needed.
#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("Folder already exists: {path}"));
    }
    fs::create_dir_all(p)
        .map_err(|e| format!("create_folder({path}) failed: {e}"))
}

fn filter_tree(node: FileNode, extensions: &[String], wnf: &[String]) -> Option<FileNode> {
    match node.kind.as_str() {
        "file" => {
            let lower = node.name.to_lowercase();
            let ext_ok = lower.contains('.')
                && extensions.iter().any(|e| lower.ends_with(&format!(".{}", e.to_lowercase())));
            let wnf_ok = wnf.iter().any(|w| w == &node.name);
            if ext_ok || wnf_ok { Some(node) } else { None }
        }
        _ => {
            let children = node.children.unwrap_or_default().into_iter()
                .filter_map(|c| filter_tree(c, extensions, wnf))
                .collect::<Vec<_>>();
            if children.is_empty() { None }
            else {
                Some(FileNode { id: node.id, name: node.name, path: node.path, kind: node.kind, children: Some(children) })
            }
        }
    }
}

fn build_tree(root: &Path, current: &Path, stop_at_craidd: Option<()>) -> std::io::Result<FileNode> {
    let rel = current.strip_prefix(root).unwrap_or(current).to_string_lossy().replace('\\', "/");
    let name = current.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| rel.clone());
    let id = if rel.is_empty() { ".".to_string() } else { rel.clone() };
    if current.is_file() {
        return Ok(FileNode { id, name, path: rel, kind: "file".to_string(), children: None });
    }

    if stop_at_craidd.is_some() && !rel.is_empty() {
        let self_craidd = current.join(format!("{}.craidd", name));
        if self_craidd.is_file() {
            return Ok(FileNode {
                id, name, path: rel, kind: "folder".to_string(),
                children: Some(vec![]),
            });
        }
    }

    let mut children: Vec<FileNode> = vec![];
    for entry in fs::read_dir(current)?.flatten() {
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if p.is_dir() && IGNORE_DIRS.contains(&fname.as_str()) { continue; }
        if fname.starts_with('.') { continue; }
        if let Ok(md) = fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() { continue; }
        }
        children.push(build_tree(root, &p, stop_at_craidd)?);
    }
    children.sort_by(|a, b| {
        let ka = if a.kind == "folder" { 0 } else { 1 };
        let kb = if b.kind == "folder" { 0 } else { 1 };
        ka.cmp(&kb).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(FileNode { id, name, path: rel, kind: "folder".to_string(), children: Some(children) })
}
RUSTEOF

# ─────────────────────────────────────────────────────────
# 2. Rust: register new commands in lib.rs
# ─────────────────────────────────────────────────────────
cat > src-tauri/src/lib.rs << 'RUSTEOF'
mod commands;
mod types;

use commands::fs::{read_dir_tree, read_dir_tree_filtered, read_file, write_file, create_folder};
use commands::solution::{
    create_project_folder, find_ancestor_solution, load_solution, load_solution_named,
    save_project, save_solution, scan_craidd_files,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_dir_tree,
            read_dir_tree_filtered,
            write_file,
            create_folder,
            find_ancestor_solution,
            scan_craidd_files,
            load_solution,
            load_solution_named,
            save_project,
            save_solution,
            create_project_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
RUSTEOF

# ─────────────────────────────────────────────────────────
# 3. Frontend: NewFileDialog
# ─────────────────────────────────────────────────────────
cat > src/components/dialogs/NewFileDialog.tsx << 'TSEOF'
import { useMemo, useState } from "react";
import type { Language } from "../../types/project";
import { useSolution } from "../../store/solutionStore";

export type NewFileMode = "project" | "folder" | "raw";

interface Props {
  parentPath: string;
  projectLanguage?: Language | null;
  mode: NewFileMode;
  onClose: () => void;
}

interface Preset {
  label: string;
  ext: string;
}

function presetsFor(language: Language | null | undefined): Preset[] {
  if (!language) return [];
  switch (language) {
    case "rust":
      return [
        { label: "Rust source (.rs)", ext: "rs" },
        { label: "Cargo manifest (.toml)", ext: "toml" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "typescript":
      return [
        { label: "TypeScript (.ts)", ext: "ts" },
        { label: "React component (.tsx)", ext: "tsx" },
        { label: "JSON (.json)", ext: "json" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "javascript":
      return [
        { label: "JavaScript (.js)", ext: "js" },
        { label: "React component (.jsx)", ext: "jsx" },
        { label: "JSON (.json)", ext: "json" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "python":
      return [
        { label: "Python (.py)", ext: "py" },
        { label: "Requirements (.txt)", ext: "txt" },
        { label: "Python config (.toml)", ext: "toml" },
      ];
    case "cpp":
      return [
        { label: "C++ source (.cpp)", ext: "cpp" },
        { label: "C source (.c)", ext: "c" },
        { label: "C++ header (.hpp)", ext: "hpp" },
        { label: "C header (.h)", ext: "h" },
      ];
    case "csharp":
      return [
        { label: "C# source (.cs)", ext: "cs" },
        { label: "Project file (.csproj)", ext: "csproj" },
        { label: "Plain text (.txt)", ext: "txt" },
      ];
    case "config":
      return [
        { label: "JSON (.json)", ext: "json" },
        { label: "TOML (.toml)", ext: "toml" },
        { label: "YAML (.yaml)", ext: "yaml" },
        { label: "INI (.ini)", ext: "ini" },
      ];
    default:
      return [];
  }
}

export default function NewFileDialog({
  parentPath,
  projectLanguage,
  mode,
  onClose,
}: Props) {
  const createFile = useSolution((s) => s.createFile);

  const [name, setName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = useMemo(
    () => (mode === "raw" ? [] : presetsFor(projectLanguage)),
    [mode, projectLanguage]
  );

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("File name is required.");
      return;
    }
    setSubmitting(true);
    try {
      let finalName = trimmed;
      if (presets.length > 0 && !trimmed.includes(".")) {
        finalName = `${trimmed}.${presets[selectedPreset].ext}`;
      }
      await createFile(parentPath, finalName, "");
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={submitting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          New File
        </div>

        <div className="px-4 py-4 space-y-3 text-xs">
          <div className="text-zinc-500">
            In: <span className="text-zinc-300 font-mono">{parentPath}</span>
          </div>

          <label className="block">
            <div className="text-zinc-400 mb-1">File name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
              placeholder="main"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="text-zinc-600 mt-1">
              Type any extension you want. The presets below are optional.
            </div>
          </label>

          {presets.length > 0 && (
            <div className="block">
              <div className="text-zinc-400 mb-1">Presets</div>
              <div className="flex flex-wrap gap-2">
                {presets.map((p, i) => (
                  <label
                    key={i}
                    className={
                      "px-2.5 py-1 rounded border cursor-pointer select-none transition-colors " +
                      (selectedPreset === i
                        ? "border-blue-500 bg-blue-950/40 text-zinc-100"
                        : "border-zinc-700 text-zinc-300 hover:border-zinc-600")
                    }
                  >
                    <input
                      type="radio"
                      name="preset"
                      className="hidden"
                      checked={selectedPreset === i}
                      onChange={() => setSelectedPreset(i)}
                      disabled={submitting}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
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
# 4. Frontend: NewFolderDialog
# ─────────────────────────────────────────────────────────
cat > src/components/dialogs/NewFolderDialog.tsx << 'TSEOF'
import { useState } from "react";
import { useSolution } from "../../store/solutionStore";

interface Props {
  parentPath: string;
  onClose: () => void;
}

export default function NewFolderDialog({ parentPath, onClose }: Props) {
  const createFolder = useSolution((s) => s.createFolder);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Folder name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await createFolder(parentPath, trimmed);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50"
      onClick={submitting ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-zinc-800 text-sm text-zinc-200 font-medium">
          New Folder
        </div>

        <div className="px-4 py-4 space-y-3 text-xs">
          <div className="text-zinc-500">
            In: <span className="text-zinc-300 font-mono">{parentPath}</span>
          </div>

          <label className="block">
            <div className="text-zinc-400 mb-1">Folder name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={submitting}
              placeholder="components"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </label>

          {error && (
            <div className="text-red-400 text-[11px] bg-red-950/40 border border-red-900/60 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
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
# 5. Store: add createFile, createFolder actions
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib

p = pathlib.Path("src/store/solutionStore.ts")
text = p.read_text()

anchor_iface = "  createBlankProject: (args: { name: string; language: Language; subfolder: string }) => Promise<void>;"
new_iface = anchor_iface + """
  createFile: (parentPath: string, name: string, content?: string) => Promise<string>;
  createFolder: (parentPath: string, name: string) => Promise<string>;"""

if "createFile:" not in text:
    text = text.replace(anchor_iface, new_iface, 1)

anchor_impl = """  createBlankProject: async ({ name, language, subfolder }) => {
    const state = get();
    if (!state.rootPath) throw new Error("No solution is open.");
    const { invoke } = await import("@tauri-apps/api/core");
    const folder = subfolder.replace(/^\\/+|\\/+$/g, "");
    await invoke("create_project_folder", { root: state.rootPath, subfolder: folder });
    await get().addProject({ name, language, folder, kind: "application" });
  },"""

new_impl = anchor_impl + """

  createFile: async (parentPath, name, content = "") => {
    const state = get();
    const { invoke } = await import("@tauri-apps/api/core");
    const cleanParent = parentPath.replace(/\\/+$/, "");
    const fullPath = `${cleanParent}/${name}`;

    await invoke("write_file", { path: fullPath, content });

    await get().refreshDiscovery();
    if (state.solution) {
      const solution = state.solution;
      const refreshed: CraiddProject[] = [];
      for (const pr of solution.projects) {
        refreshed.push(await populateTrees(state.rootPath ?? "", pr));
      }
      set({ solution: { ...solution, projects: refreshed } });
    }

    await get().openFile(fullPath, name);
    return fullPath;
  },

  createFolder: async (parentPath, name) => {
    const state = get();
    const { invoke } = await import("@tauri-apps/api/core");
    const cleanParent = parentPath.replace(/\\/+$/, "");
    const fullPath = `${cleanParent}/${name}`;

    await invoke("create_folder", { path: fullPath });

    await get().refreshDiscovery();
    if (state.solution) {
      const solution = state.solution;
      const refreshed: CraiddProject[] = [];
      for (const pr of solution.projects) {
        refreshed.push(await populateTrees(state.rootPath ?? "", pr));
      }
      set({ solution: { ...solution, projects: refreshed } });
    }
    return fullPath;
  },"""

if "createFile: async" not in text:
    if anchor_impl in text:
        text = text.replace(anchor_impl, new_impl, 1)
    else:
        print("  · WARNING: createBlankProject impl not found — manual patch needed")
else:
    print("  · createFile already present, skipping")

p.write_text(text)
print("  · patched solutionStore.ts")
PYEOF

# ─────────────────────────────────────────────────────────
# 6. SolutionExplorer: nested right-click menu
# ─────────────────────────────────────────────────────────
python3 - << 'PYEOF'
import pathlib, re

p = pathlib.Path("src/components/sidebar/solution/SolutionExplorer.tsx")
text = p.read_text()

# Add Language import
if 'import type { Language } from "../../../types/project";' not in text:
    text = text.replace(
        'import { languageMeta } from "../../../lib/languages";',
        'import { languageMeta } from "../../../lib/languages";\n'
        'import type { Language } from "../../../types/project";',
        1
    )

# Add dialog imports
if 'from "../../dialogs/NewFileDialog"' not in text:
    text = text.replace(
        'import DeclarePlaceholderDialog from "../../dialogs/DeclarePlaceholderDialog";',
        'import DeclarePlaceholderDialog from "../../dialogs/DeclarePlaceholderDialog";\n'
        'import NewFileDialog, { type NewFileMode } from "../../dialogs/NewFileDialog";\n'
        'import NewFolderDialog from "../../dialogs/NewFolderDialog";',
        1
    )

# Extend the ctxMenu state type
text = text.replace(
    'const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId?: string } | null>(null);',
    'const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId?: string } | null>(null);\n'
    '  const [newFileTarget, setNewFileTarget] = useState<{ parentPath: string; language: Language | null; mode: NewFileMode } | null>(null);\n'
    '  const [newFolderTarget, setNewFolderTarget] = useState<{ parentPath: string } | null>(null);',
    1
)

# Replace the project context menu with the nested version
menu_block = re.search(
    r'\{ctxMenu\.projectId \? \(.*?\n            \)\}\n          </div>\n        </>\n      \)\}',
    text,
    re.DOTALL
)

if menu_block:
    new_menu = '''{ctxMenu.projectId ? (
              <>
                <button
                  onClick={() => { refreshProject(ctxMenu.projectId!); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Refresh Project
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => {
                    const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                    if (!project || !rootPath) return;
                    const projectBase = project.folder === "." || project.folder === ""
                      ? rootPath
                      : `${rootPath.replace(/\\/+$/, "")}/${project.folder.replace(/^\\/+/, "")}`;
                    setNewFileTarget({
                      parentPath: projectBase,
                      language: project.language ?? null,
                      mode: "project",
                    });
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Add ▸ New File…
                </button>
                <button
                  onClick={() => {
                    const project = solution?.projects.find((p) => p.id === ctxMenu.projectId);
                    if (!project || !rootPath) return;
                    const projectBase = project.folder === "." || project.folder === ""
                      ? rootPath
                      : `${rootPath.replace(/\\/+$/, "")}/${project.folder.replace(/^\\/+/, "")}`;
                    setNewFolderTarget({ parentPath: projectBase });
                    setCtxMenu(null);
                  }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Add ▸ New Folder…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                {!solution?.projects.find((p) => p.id === ctxMenu.projectId)?.configEnabled ? (
                  <button
                    onClick={() => { addConfigHere(ctxMenu.projectId!); setCtxMenu(null); }}
                    className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                  >
                    Add Config Project Here
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { handleSetConfigDirectory(ctxMenu.projectId!); setCtxMenu(null); }}
                      className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                    >
                      Change Config Directory…
                    </button>
                    <button
                      onClick={() => { removeConfig(ctxMenu.projectId!); setCtxMenu(null); }}
                      className="w-full px-3 py-1 text-left text-zinc-300 hover:bg-red-700 hover:text-white"
                    >
                      Remove Config
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}'''

    text = text[:menu_block.start()] + new_menu + text[menu_block.end():]
    print("  · replaced SolutionExplorer context menu")
else:
    print("  · WARNING: could not locate context menu block")

# Add the dialogs to the render tree
if "newFileTarget &&" not in text:
    text = text.replace(
        '      {declareTarget && (',
        '      {newFileTarget && (\n'
        '        <NewFileDialog\n'
        '          parentPath={newFileTarget.parentPath}\n'
        '          projectLanguage={newFileTarget.language}\n'
        '          mode={newFileTarget.mode}\n'
        '          onClose={() => setNewFileTarget(null)}\n'
        '        />\n'
        '      )}\n'
        '      {newFolderTarget && (\n'
        '        <NewFolderDialog\n'
        '          parentPath={newFolderTarget.parentPath}\n'
        '          onClose={() => setNewFolderTarget(null)}\n'
        '        />\n'
        '      )}\n'
        '      {declareTarget && (',
        1
    )

p.write_text(text)
print("  · patched SolutionExplorer.tsx")
PYEOF

# ─────────────────────────────────────────────────────────
# 7. FileDiscovery: flat right-click menu with New File / New Folder
# ─────────────────────────────────────────────────────────
cat > src/components/sidebar/discovery/FileDiscovery.tsx << 'TSEOF'
import { useState } from "react";
import { useSolution } from "../../../store/solutionStore";
import type { FileNode } from "../../../types/project";
import FileTree from "../FileTree";
import MakeProjectDialog from "../../dialogs/MakeProjectDialog";
import NewFileDialog from "../../dialogs/NewFileDialog";
import NewFolderDialog from "../../dialogs/NewFolderDialog";

export default function FileDiscovery() {
  const rootPath = useSolution((s) => s.rootPath);
  const discovery = useSolution((s) => s.discovery);
  const refreshDiscovery = useSolution((s) => s.refreshDiscovery);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: FileNode } | null>(null);
  const [dialogNode, setDialogNode] = useState<FileNode | null>(null);
  const [newFileTarget, setNewFileTarget] = useState<{ parentPath: string } | null>(null);
  const [newFolderTarget, setNewFolderTarget] = useState<{ parentPath: string } | null>(null);

  const absPathFor = (node: FileNode) => {
    if (!rootPath) return "";
    const rel = node.path && node.path !== "." ? node.path : node.name;
    return `${rootPath.replace(/\/+$/, "")}/${rel.replace(/^\/+/, "")}`;
  };

  return (
    <div className="flex flex-col min-h-0 border-t border-zinc-800" style={{ flex: "1 1 45%" }}>
      <div className="h-8 px-3 flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">File Discovery</span>
        <span className="ml-auto text-[10px] text-zinc-600 normal-case">on disk</span>
        <button title="Refresh" onClick={() => refreshDiscovery()}
                className="p-1 rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-1">
        {!discovery || !rootPath ? (
          <div className="px-3 py-6 text-[12px] text-zinc-600 text-center">Nothing loaded.</div>
        ) : (
          <FileTree node={discovery} depth={0} basePath={rootPath} defaultOpen={true}
                    onContext={(x, y, n) => setCtxMenu({ x, y, node: n })} />
        )}
      </div>

      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />
          <div style={{ left: ctxMenu.x, top: ctxMenu.y }}
               className="fixed z-50 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded shadow-2xl py-1 text-xs">
            {ctxMenu.node.kind === "folder" ? (
              <>
                <button
                  onClick={() => { setNewFileTarget({ parentPath: absPathFor(ctxMenu.node) }); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  New File…
                </button>
                <button
                  onClick={() => { setNewFolderTarget({ parentPath: absPathFor(ctxMenu.node) }); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  New Folder…
                </button>
                <div className="my-1 h-px bg-zinc-800" />
                <button
                  onClick={() => { setDialogNode(ctxMenu.node); setCtxMenu(null); }}
                  className="w-full px-3 py-1 text-left text-zinc-200 hover:bg-blue-700 hover:text-white"
                >
                  Make This a Project…
                </button>
              </>
            ) : (
              <div className="px-3 py-1 text-zinc-600 italic">(select a folder)</div>
            )}
          </div>
        </>
      )}

      {dialogNode && <MakeProjectDialog node={dialogNode} onClose={() => setDialogNode(null)} />}
      {newFileTarget && (
        <NewFileDialog
          parentPath={newFileTarget.parentPath}
          projectLanguage={null}
          mode="raw"
          onClose={() => setNewFileTarget(null)}
        />
      )}
      {newFolderTarget && (
        <NewFolderDialog
          parentPath={newFolderTarget.parentPath}
          onClose={() => setNewFolderTarget(null)}
        />
      )}
    </div>
  );
}
TSEOF

echo ""
echo "✓ Phase 2.1 applied."
echo ""
echo "  New Rust commands:"
echo "    write_file(path, content)"
echo "    create_folder(path)"
echo ""
echo "  New frontend files:"
echo "    src/components/dialogs/NewFileDialog.tsx"
echo "    src/components/dialogs/NewFolderDialog.tsx"
echo ""
echo "  Modified:"
echo "    src-tauri/src/commands/fs.rs"
echo "    src-tauri/src/lib.rs"
echo "    src/store/solutionStore.ts"
echo "    src/components/sidebar/solution/SolutionExplorer.tsx"
echo "    src/components/sidebar/discovery/FileDiscovery.tsx"
echo ""
echo "Next:"
echo "  cd src-tauri && cargo build && cd .."
echo "  npm run tauri dev"