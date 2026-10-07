# Current Place: A Map of the Codebase

> **Archived on 7 October 2026.** This is a historical snapshot, including its
> original phase numbers and status claims. Use the [current roadmap](../Roadmap-v0.0.4A.md)
> and [current codebase map](../Current-place.md) for present direction and source.
> Archiving and navigation maintenance: Codex. Original attribution is retained.

**Status:** Living document. Updated when the shape of the code changes.
**Audience:** Someone opening this repository for the first time.
**Purpose:** Explain what exists, how the pieces fit, and where to look
for a given subsystem. This is a map, not a manual.

If you only read one section, read **The project model**. It is the
spine every other part hangs from.

---

## What Craidd is

A native polyglot IDE for Linux, built on Tauri v2 (Rust backend),
React (frontend), and Monaco (editor). It is not a VS Code clone and
it is not a Visual Studio clone. It is an **organizer for projects
that mix languages** — the tool VS Code refuses to be, because VS Code
has no project model, and the tool Rider cannot be on Linux.

The thesis, in one sentence: **the user declares structure; the IDE
does not infer it.** Every file format, every screen, every command in
this repository is a consequence of that sentence.

---

## The project model

Craidd recognizes exactly three places where a fact about a project
can live. The full argument is in `docs/craidd-cln-model.md`; the
short version is:

**1. Manifests on disk.** `Cargo.toml`, `package.json`, `*.csproj`,
`CMakeLists.txt`, `pyproject.toml`. These belong to the ecosystem.
Craidd **reads** them. It never writes them. It never mirrors their
contents into its own files.

**2. `.craidd`.** A per-folder marker. Six lines maximum. Declares the
folder's `name`, `language`, and `root`. Optionally declares a
`[config]` section. Nothing else. It is a classification cache, not a
configuration file.

**3. `.cln`.** The solution file. Declares which projects compose the
solution, what role each plays (`application` / `library` / `test`),
and how the solution builds and runs via `[[config]]` entries. This is
the only file that describes relationships between projects.

The rule that decides everything:

+++
If it can be read from a manifest, read it — never store it.
If it is true of the folder alone, it goes in .craidd.
If it is true because of the solution, it goes in .cln.
+++

Anything that violates that rule is a bug in the model, not a missing
feature.

---

## The repository layout

+++
src/                  Frontend (React + TypeScript + Monaco)
src-tauri/src/        Backend (Rust, Tauri commands, process runners)
docs/                 Design record. Read these before changing things.
workspaces/           Test fixtures. Not part of the product.
+++

**`src/`** — the React app. Stores are the source of truth for state;
components render it. Communication with Rust is via Tauri `invoke`
calls and event listeners.

**`src-tauri/src/`** — the Rust side. Commands are exposed via
`#[tauri::command]`. Process runners, file I/O, manifest parsing, and
the linked-window registry all live here. `lib.rs` is the entry point
where commands are registered.

**`docs/`** — every design decision the project has made is in here,
in markdown. If you are about to change something and there is a doc
that governs it, read the doc first. If your change contradicts the
doc, either the doc is stale or your change is wrong — figure out
which before writing code.

**`workspaces/`** — small hand-built solutions used to test the IDE
against real projects. Not shipped. Safe to delete and rebuild.

---

## The Rust side

`src-tauri/src/` is organized by concern. Each module owns one thing.

**`lib.rs`** — the entry point. Registers every `#[tauri::command]`
in the `invoke_handler`. If a command is not listed here, the frontend
cannot call it.

**`types.rs`** — every struct shared between Rust and the frontend.
`CraiddProject`, `CraiddSolution`, `FileNode`, `ConfigEntry`,
`Profile`, `AncestorInfo`, `SolutionWithPath`. All structs are
serialized with `#[serde(rename_all = "camelCase")]`, so Rust's
`snake_case` fields appear as `camelCase` in TypeScript.

### `commands/` — the Tauri command surface

**`commands/fs.rs`** — file and directory operations. `read_file`,
`read_dir_tree`, `read_dir_children`, `read_dir_tree_filtered`,
`write_file`, `create_folder`, `stat_files`, `overwrite_file`,
`delete_path`, `rename_path`. The `read_dir_tree_filtered` command is
the one that honors the **boundary rule**: a subfolder with its own
`.craidd` stops the parent walk.

**`commands/solution.rs`** — everything about `.cln` and `.craidd`
files. Loading a solution, loading a single project marker, saving
both, scanning for orphan markers, enforcing the "one project per
language per folder" invariant, removing and deleting projects,
editing the `.cln` to repoint or remove an entry.

**`commands/manifests.rs`** — reads `Cargo.toml`, `package.json`,
`*.csproj`, `CMakeLists.txt`. Returns a loose `Manifest` struct with a
`values: serde_json::Value` field. Never writes to any of them.

**`commands/infer.rs`** — reads manifests and proposes `ConfigEntry`
values. Two tiers: solution-level best-fit (the Tauri signature, for
example) and per-project defaults. Everything it produces is tagged
`origin = "inferred"` and never written to `.cln`.

**`commands/toolchain.rs`** — discovers installed tools (`cargo`,
`dotnet`, `node`, `pnpm`, `g++`, `clang++`, `cmake`, `python3`, and
others). Writes results to `~/.craidd-studio/user_preferences.toml`.
Never installs anything. Ever. The full rule is in
`docs/philosophies/ide_editor/tool-discovery/philosophy-tool-discovery.md`.

**`commands/build.rs`** — the Cargo-specific build runner. Parses
Cargo's JSON messages for compiler diagnostics and artifact paths.
Kept for backward compatibility; the general runner supersedes it.

**`commands/runner.rs`** — the general process runner. Takes a
`RunSpec` (label, program, args, env, cwd), spawns the process with
`setsid`, streams stdout/stderr as `craidd:build` events, reports the
exit code or the signal. Every spawned child is a session leader in
its own process group, and `impl Drop for RunnerManager` sends SIGTERM
to every active group on IDE close.

**`commands/containment.rs`** — two things. `signal_name(i32)` maps
Unix signal numbers to names, so a crash can be reported as "killed by
SIGSEGV" rather than "exit code 139." And `guard(label, f)` wraps a
thread body in `catch_unwind` so a panic in a stream reader does not
take down the Tauri runtime. Every spawned thread in `runner.rs` and
`build.rs` runs inside `guard`.

**`commands/linked_windows.rs`** — the linked-window registry. Tracks
every IDE window in a solution group, computes which windows form the
group, dispatches linked Build/Run/Debug actions, aggregates problems
across the group, and routes problem-reveal requests to the owning
window. This is the newest and most complex module. See "The
linked-window system" below.

**`commands/search.rs`** — content search across the solution folder.
Walks the tree, skips `IGNORE_DIRS`, caps file size and match count,
returns line matches per file.

**`commands/window.rs`** — multi-window management. `get_startup_state`,
`record_workspace_open`, `open_workspace_window`,
`open_welcome_window`, `apply_window_geometry`,
`take_window_open_request`. Also tracks window geometry for session
restore.

---

## The frontend side

The React app is organized around **Zustand stores**. Stores are the
single source of truth; components subscribe to slices they care
about. If you need state to survive a re-render or be shared between
components, it belongs in a store.

**`store/solutionStore.ts`** — the largest store, and the one you will
touch most. Owns: the loaded solution, the resolved root path, the
`.cln` path, the discovery tree, open editor tabs, active file
selection, dirty and disk states, the rename request system, the
pending-save prompts, and every action that creates, renames, deletes,
or moves files and projects. Calls nearly every command in
`commands/solution.rs` and `commands/fs.rs`.

**`store/buildStore.ts`** — owns the selected configuration, the
selected profile, per-action main choices (which config fires when you
press white Build / Run / Debug), the running state, the Output buffer,
the artifact path, and the Problems list. Calls `start_config`,
`stop_config`, and `infer_configs`.

**`store/linkedWindowsStore.ts`** — owns the linked-window snapshot
received from Rust. Publishes this window's state to the registry
(when the solution or config changes), listens for group state
updates, dispatches linked actions to the Rust registry, and forwards
problem-reveal requests.

**`store/preferencesStore.ts`** — editor font size, tab size, word
wrap, theme, sidebar/panel visibility, and the debug focus preference.
The focus preference (`always` / `idle` / `never`) is the one the
linked-window system reads when a debugger pauses.

**`store/layoutStore.ts`** — layout sizes: sidebar width, right panel
width, bottom panel height. Kept separate from preferences because
layout is per-window and preferences are global.

**`store/searchStore.ts`** — search query, content matches, filename
matches, expanded state. Calls `search_in_path`.

### `components/` — the UI

**`components/layout/`** — the shell. `AppShell.tsx` composes MenuBar,
Toolbar, ActivityBar, Sidebar, EditorPane, DebugSidebar, BottomPanel,
StatusBar, and the resize handles between them. It is the file you
open when you want to understand what is on screen and in what order.

**`components/sidebar/solution/SolutionExplorer.tsx`** — the
declared-project view. Renders every project in the solution, their
filtered language trees, their config trees, and their right-click
menus. This is the most complex component in the app.

**`components/sidebar/discovery/FileDiscovery.tsx`** — the raw disk
view. Uses `read_dir_children` for lazy loading, so opening a large
folder does not serialize the entire tree.

**`components/sidebar/FileTree.tsx`** — the shared tree renderer used
by both SolutionExplorer and FileDiscovery. Handles folder expansion,
inline rename, right-click, and lazy child loading in discovery mode.

**`components/editor/`** — Monaco wrapper, tab bar, breadcrumb.
`CodeView.tsx` is the Monaco host. It reveals the navigation target
when `solutionStore.navigation` changes.

**`components/dialogs/`** — every modal. New File, New Folder, Make
Project, Missing Project, Fine Tune, Delete, Save Conflict, Delete
File, Declare Placeholder, New Project, Toolchain Configuration.
Each is a self-contained file that opens, prompts, and closes.

**`components/panels/BottomPanel.tsx`** — Output, Problems, Terminal
tabs. The Problems tab shows the linked group's problems when the
window is in a linked group, and its own when it is not.

**`components/preferences/PreferencesDialog.tsx`** — the settings
dialog. Three sections: Text Editor, Toolchains, Debugging.

---

## The linked-window system

This is the newest subsystem and the one most likely to be unfamiliar.
The full design lives in `docs/feats/linked-windows/design-linked-solution-windows.md` and
`docs/feats/linked-windows/design-linked-window-manager.md`. The short version:

**The thesis.** A window is a viewport. A session is a process. The
tray is the switcher. Hiding is turning a viewport off.



*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a map.*
