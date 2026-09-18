# Roadmap

**Status:** Living document. Updated at the end of every phase.
**Purpose:** A single source of truth for phase ordering, so that a
fresh session can orient without reading every handoff in sequence.

---

## Where we are

Current phase: 2.4 complete (containment foundation).

---

## The sequence

2.3.3         Configurations dialog (UI complete)              DONE
2.4           Containment foundation                            DONE

2.4.1         Documentation pass (this file + design docs)     current
2.4.2         Rust panic hook + React error boundary + crash banner
2.4.3         Problems panel + command box in Output
2.4.4         invokeSafe + external terminal

2.5           Get Started screen + multi-window
2.6           New Project Wizard

Phase 3       LSP (first: rust-analyzer)
Phase 3.x     DAP (first: lldb-dap for Rust)
Phase 3.y     Integrated terminal (xterm.js, contained)

Phase 4       The assistant panel (has project graph context)

---

## What each phase is for

### 2.4.2 — Rust panic hook + React error boundary

Why: the IDE currently dies silently on an internal panic in a
packaged build, or produces a white screen on a React render error.

Ships:
- Panic hook writing to `~/.craidd-studio/crashes/`.
- Native dialog on panic.
- React error boundary with a red panel.
- Crash banner on next launch.

Design doc: `design-error-handling.md`.

### 2.4.3 — Problems panel + command box

Why: errors are scattered between Output, alerts, and console. Nothing
is structured. The Output panel has no way to run a command.

Ships:
- Problems tab lists every structured error the IDE produces.
- Command box at the bottom of Output.
- Export Log button.

Design doc: `design-error-handling.md`, `design-terminal.md`
(Tier 1).

### 2.4.4 — invokeSafe + external terminal

Why: silent Tauri command failures. No way to get a terminal in the
project folder without an integrated one.

Ships:
- `invokeSafe()` wrapper, migration of all call sites.
- Ctrl+Shift+` opens the preferred external terminal in the solution
  root.

Design doc: `design-error-handling.md`, `design-terminal.md`
(Tier 2).

### 2.5 — Get Started + multi-window

Why: no launch screen. No recent solutions. No multi-window.

Ships:
- Multi-window support (one solution per window).
- Recent solutions in `~/.craidd-studio/recent.toml`.
- Session persistence (last N windows + positions).
- Get Started screen (actions, tutorials, what's new, tip, privacy
  note).
- File > Get Started to reopen it.

Design doc: `design-window-model.md`.

### 2.6 — New Project Wizard

Why: creating a project today requires manual `.craidd` editing. Users
with a fresh install have no good path to "start something."

Ships:
- Template system per language.
- New Project flow with language-specific scaffolds.
- Wizard suggests folder structure.

Design doc: to be written.

### Phase 3 — LSP

Why: the whole polyglot IDE thesis needs language intelligence.
rust-analyzer is first because the IDE is written in Rust, so it
dogfoods the workflow immediately.

Ships:
- LSP client in Rust.
- Document sync, diagnostics, hover, completion.
- Problems panel integrated with compiler diagnostics.
- rust-analyzer auto-discovery via the toolchain system.

Design doc: to be written.

### Phase 3.x — DAP

Why: the debugger. This is the thing that makes "an IDE" true rather
than "an editor with a project tree."

Prerequisites:
- `lldb-dap` installed on the dev machine.
- DAP client protocol implementation in Rust.
- Debug sidebar (Call Stack, Variables, Watch, Breakpoints).
- Breakpoint markers in Monaco gutter.
- Debug context dropdown.

Ships:
- First DAP session: launch a Rust binary, hit a breakpoint, inspect
  variables, step, stop.

Design doc: to be written.

### Phase 3.y — Integrated terminal

Why: Mode 2 users (browse-only folders) need a real terminal. The
command box and external terminal cover the common cases, but a
polished in-panel terminal is the expected feature.

Prerequisites:
- Containment foundation proven on LSP and DAP.
- xterm.js integrated as a dependency.

Ships:
- `craidd-pty-host` subprocess per terminal.
- Terminal webview, child of the main window.
- Grid-delta protocol between pty-host and IDE.
- Canvas renderer with the six rules.

Design doc: `design-terminal.md`.

### Phase 4 — The assistant panel

Why: this is the moat. An AI assistant that has a project graph is
fundamentally different from one that has a folder.

Prerequisites:
- LSP and DAP working. The assistant needs protocol discipline.
- Project graph API stabilized.

Ships:
- In-window chat panel with solution context.
- Structured file access that respects project boundaries.
- Build, run, and debug awareness.

Design doc: `future-ide-considerations.md` (sketch).

---

## What we deliberately do not build

- Session restore of tabs. State, not intent.
- Terminal restore. A "restored" terminal is a new shell.
- Debug session restore. A "restored" debug session is a lie.
- Persistent build logs. The console is the log.
- Auto-telemetry. No. Ever.
- Custom languages and frameworks. Fixed set. See
  `design-project-identity.md`.
- A workspace concept. `.cln` is the workspace.

---

## The open source gate

Rust + TypeScript + C++ (or C#) with real editing, LSP, build, and
debug. When three languages work end-to-end, Craidd goes public.

Not before. A half-working three-language IDE is worse than no IDE.

---

## The direction

Craidd is a Visual Studio / JetBrains IDE wearing VS Code's jacket.

Solution and project model from Visual Studio. Per-language trees from
CLion and Rider. Config-as-facet from both. Lightweight chrome,
command palette, and modern feel from VS Code. None of VS Code's "a
folder is a folder" model.

The thesis: organization over mixed debugging. The user declares
structure. The IDE never infers.

---

*Last updated: Phase 2.4. Author: skira24.*
*This document is a plan. It is the ordering reference.*
