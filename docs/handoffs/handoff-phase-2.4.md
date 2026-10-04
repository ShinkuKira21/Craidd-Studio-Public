# Handoff: State of Craidd-Studio

**Date:** End of Phase 2.4 (Containment Foundation).
**Previous handoff:** `docs/handoffs/handoff-phase-2.3.3.md` (Configurations dialog,
UI complete).
**Current phase:** 2.4 complete. Next is exploratory C# build test.
**Next session:** Battle path below — start with "What to ask in the new chat".

---

## What this project is

A native polyglot IDE for Linux, built on Tauri v2 + React + Monaco.

**The thesis:** organization over mixed debugging. Each language in a
solution gets its own tree, its own build target, its own debug context.
The user declares structure; the IDE never infers.

**Primary ancestry:** Visual Studio 2019 + JetBrains CLion/Rider.
VS Code's DNA is allowed in for *chrome* (lightweight frame, command
palette, modern feel) but not for *model* (no workspace files, no
"open a folder and I'll guess").

**Not** a VS Code replacement. **Not** a Visual Studio clone. An
organizer for projects that mix languages — the tool VS Code refuses to
be, and the tool Rider can't be on Linux.

---

## Phase numbering (locked)

+++
2.3.3         — Configurations dialog (UI complete)      ✓ DONE
2.4           — Containment foundation                    ✓ DONE (this session)
2.4.1         — Export Log… + crash auto-save
2.4.2         — Rust panic hook + React error boundary + crash banner
2.4.3         — Problems panel + command box in Output
2.4.4         — invokeSafe + external terminal (Ctrl+Shift+`)
2.5           — Get Started screen + multi-window
2.6           — New Project Wizard

Phase 3       — LSP (first: rust-analyzer)
Phase 3.x     — DAP (first: lldb-dap for Rust)
Phase 3.y     — Integrated terminal (xterm.js, contained)
Phase 4       — The assistant panel
+++

---

## Where we are right now

### Foundation (2.0 → 2.3.2)

- `.cln` (solution) and `.craidd` (project) file formats locked.
- One `.craidd` per folder, named after the folder.
- `[config]` section in the same file (config as a facet, not a
  separate project).
- Multi-tree Solution Explorer + File Discovery sidebar.
- Ancestor solution detection with choice dialog.
- Heal-on-load for orphan `.craidd` files.
- Boundary rule: subfolder with its own `.craidd` stops parent walk.
- Interop extensions: TS↔JS, C#↔C/C++, Python↔C.
- New File / New Folder / Rename / Delete / Delete Project flows.
- MissingProjectDialog (recreate / repoint / move / remove).
- FineTuneDialog (editable membership).
- Editable Monaco, dirty state, Ctrl+S, Ctrl+Shift+S, save-on-close,
  file-changed-on-disk dialog, DiffDialog.
- Search panel (content + filename, ranked).
- Toolchain discovery (Rust, TS, C++, C#, Python) + per-project override.
- Manifest reading (`manifests.rs`): Cargo, npm, dotnet, cmake.
- Config inference (`infer.rs`): Tauri signature, cargo, npm, dotnet,
  cmake.

### Phase 2.3.3 (Configurations dialog)

- `.cln` gains `[[config]]` array and `default_config`.
- `ConfigEntry` and `Profile` structs.
- Toolbar rewritten: `[🔨] [Configuration ▾] [▶] [⏹] [🐛]`.
- Configuration chip opens a dropdown grouped by "Configured" /
  "Inferred", with `Add / Edit Configurations…` footer.
- `ConfigurationsDialog.tsx` — modal shell with a section rail.
- `BuildSection`, `ConfigurationTree`, `ConfigurationForm`,
  `InheritedField`, `CommandPreview`, six method forms (Cargo, npm,
  dotnet, CMake, Shell, Composed).
- **Still display-only.** Fields are read-only. Nothing writes to `.cln`.

### Phase 2.4 (Containment foundation, just completed)

- New `src-tauri/src/commands/containment.rs`:
  - `signal_name(i32) -> String` — SIGSEGV, SIGABRT, SIGKILL, etc.
  - `guard(label, f)` — `catch_unwind` wrapper for thread bodies.
- `runner.rs` rewritten:
  - `catch_unwind` around all spawned threads.
  - Signal-aware exit reporting (`crashed` event kind).
  - Always SIGTERM the process group on child exit.
  - `impl Drop for RunnerManager` (SIGTERM → 500ms → SIGKILL).
- `build.rs` rewritten: same treatment, plus total (no-unwrap) Cargo
  JSON parser.
- `buildStore.ts`: handles the `crashed` event kind.

**Known limitation, by design:** `Drop` impls don't run on SIGKILL
(OS kill, OOM killer). That's unavoidable on Unix. Clean quit,
panic-with-hook, and normal exit all trigger Drop.

---

## Locked design decisions (this session)

### One solution per window

Multiple solutions → multiple OS windows. Each window owns exactly one
solution (or one browse-only folder with no `.cln`).

### Mode 1 — Solution mode

Opened a `.cln`. Projects declared, trees composed, build/run/debug
meaningful. This is the "polyglot IDE" mode.

### Mode 2 — Browse mode

Opened a plain folder, no `.cln`. File Discovery tree, editable Monaco,
command box (2.4.3), external terminal (2.4.4). Craidd as a text editor
+ shell. First-class mode, not a fallback.

### Terminal decision

- **External terminal ships in 2.4.4** (`Ctrl+Shift+\``).
- **Command box in Output panel** ships in 2.4.3 (not a terminal — a
  one-shot command runner).
- **Integrated terminal** is Phase 3.y, not this phase. When it comes:
  - xterm.js as the renderer, no attach/fit addons.
  - `craidd-pty-host` subprocess per terminal.
  - Bounded ring buffer between PTY and IDE.
  - Canvas renderer only. Scrollback capped at 5000.
  - Runs in a child webview.
  - Memory watchdog.
  - Commit to this when we commit to the feature.

### DAP prerequisites (why we don't do it yet)

- `lldb-dap` is not currently installed on the dev machine.
- A DAP client protocol implementation is needed (comparable in size
  to the Cargo JSON handling but bigger).
- The Debug sidebar is a placeholder; a real debug UI is a phase.
- Breakpoint markers in Monaco gutter must exist.

DAP is a *phase*, not a script. Comes after C# and C++ builds work.

### Get Started screen + multi-window (Phase 2.5)

- Left column: 4 actions (Create Project Wizard, Open Folder, Open
  Solution, Open in External Terminal) + "Reopen last session" (list
  of up to 3 solutions, each in its own window) + "Recent solutions"
  (last 10, stored in `~/.craidd-studio/recent.toml`).
- Right column: What's New, rotating tutorial, rotating tip, privacy
  note ("Craidd has no telemetry. No accounts. No network. Ever.").
- Every section dismissible. Settings toggle "Don't show on launch."
- Reachable later via `File → Get Started`.
- Uses the crash banner from 2.4.2 to know whether to show the normal
  screen or a "we crashed last time" banner.
- Multi-window support (Tauri multi-window API) is a prerequisite.

### What we deliberately don't build

- No session restore of tabs.
- No terminal restore.
- No debug session restore.
- These are *state*. We restore *intent* (which solution, which
  window), not state (cursor positions, undo stacks, running processes).

---

## The battle path

1. **Test C# build end-to-end.** Create a fresh `dotnet new console`,
   drop a `.craidd`, reference it in a `.cln`, open in Craidd.
   Observe: tree, config dropdown, Run button, output, Stop, orphan
   check. Fix whatever breaks.

2. **Test C++ build end-to-end.** Create a `CMakeLists.txt` project.
   Same observation. This reveals the need for two-step builds
   (`cmake -S . -B build` then `cmake --build build`), which is a
   *design* moment, not a bug.

3. **New Project Wizard.** The "Create Project" flow with templates
   per language. This is what makes the C#/C++/Python story usable
   without manual `.craidd` editing.

4. **Get Started + multi-window.**

5. **DAP** (with `lldb-dap` installed, a client design, and a debug
   UI design).

**Not:** jumping straight to DAP. Not: the integrated terminal.

---

## What to ask in the new chat

> Here is the full state of Craidd-Studio after Phase 2.4 (Containment
> foundation, following the 2.3.3 Configurations dialog).
>
> I want to explore the C# build path first. Give me the exact shell
> commands to:
>   1. Create a fresh `dotnet new console` project under `workspaces/`
>      called `csharp-hello`.
>   2. Write a `csharp-hello/csharp-hello.craidd` by hand.
>   3. Create or update a `csharp-hello/csharp-hello.cln` that
>      references it.
>
> Then I'll open it in Craidd and report what happens. No script
> wrapper — I want to see the exact files on disk and open them
> manually so I can observe the IDE's behaviour.
>
> Reference documents: `docs/craidd-cln-model.md`,
> `docs/roadmaps/phase-3-rust-build-debug-toolchains.md`,
> `docs/philosophies/philosophy-tool-discovery.md`, `docs/working-protocol.md`,
> `docs/handoffs/handoff-phase-2.3.3.md`.

---

## Known cleanup items

- `src-tauri/tauri-app.cln` and `src-tauri/src-tauri.craidd` are early
  test artifacts. Harmless. Delete when convenient.
- `src-tauri/src/src.craidd` same.
- `docs/future/exclude-lang.md` may be truncated — verify.

---

## Full file dump

[Paste the full project file dump here in the new chat. Include
everything under `/mnt/ext_drives/Development/Development/Desktop
Development/Craidd-Studio/` except `node_modules/`, `target/`, `.git/`,
and `workspaces/tauri-app/src-tauri/target/`.]

---

*Last updated: end of Phase 2.4. Author: skira24, with assistance.*