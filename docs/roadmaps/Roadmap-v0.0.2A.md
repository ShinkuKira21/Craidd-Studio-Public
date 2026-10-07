# Roadmap

**Status:** Living document. Updated at the end of every phase.
**Purpose:** A single source of truth for phase ordering, for the
constraints that hold across every phase, and for the two ambitions
that fit the model without straining it.

**Companion:** `Current_Place_Roadmap.md` describes what exists now.
This document describes what comes next.

---

## Where we are

Current phase: **2.4.4** — the debugger slice is being wired.
Previous phase: **2.4.3** — the linked-window design documents were
sharpened to state the thesis (window is a viewport, session is a
process, tray is the switcher, hiding is turning a viewport off) and
to define the window identity, hide semantics, and close semantics.

What works today:

- The `.cln` / `.craidd` model, manifest reading, and configuration
  inference.
- Multi-project Solution Explorer, File Discovery, editor, search,
  save, rename, delete.
- Linked Build / Run / Stop across windows on the same solution, with
  problem aggregation.
- The gold / white toolbar split and the focus preference.

What is in progress:

- The first Debug Adapter Protocol client, which will make the linked
  system's pause-driven behaviors real.

---

## The sequence

+++
2.4.4         Debugger slice (first DAP client)              in progress
2.4.5         invokeSafe + external terminal
2.5           Get Started screen + multi-window
2.6           New Project Wizard

Phase 3       LSP (first: rust-analyzer)
Phase 3.x     DAP (first: lldb-dap for Rust, full debug UI)
Phase 3.y     Integrated terminal (xterm.js, contained)

Phase 4       AI pipeline, in-window, on the project graph
Phase 4.x     Python and ML tooling (training view, evaluation view)
+++

Phase numbering reflects order, not urgency. A later phase is not more
important than an earlier one — it just comes after, because it depends
on the earlier one.

---

## Constraints that hold across every phase

These are the rules that any contribution must respect, whatever the
phase. They are not preferences. They are what makes Craidd Craidd.
The full argument for each is in a design document; the short version
is here.

**1. Linux is the reference platform.**

The containment model relies on Unix primitives: `setsid`, `killpg`,
signal semantics, process groups, `ptrace`'s one-tracer-per-thread
rule. The runner, the containment module, and path handling have Linux
implementations. **A Windows port implements the same interfaces with
Windows mechanisms.** It does not change the interfaces. The project
model — `.craidd`, `.cln`, the linked-window registry, the DAP client,
the entire frontend — is platform-neutral and does not change.

Windows support is welcome. Windows support that requires the model to
bend is not.

**2. No bundling. Ever.**

Craidd does not ship a compiler, a runtime, a package manager, a
language server, a debug adapter, an AI runtime, or a Python
interpreter. Tools are discovered on the user's machine, recorded, and
delegated to. When a tool is missing, Craidd says so and gets out of
the way. See `docs/philosophies/ide_editor/tool-discovery/philosophy-tool-discovery.md` for the full
argument. The rule applies to every phase, including the AI pipeline
in Phase 4.

**3. No silent mutation. Ever.**

Every file change Craidd makes is visible to the user. Every process
it spawns appears in the Output panel. Every diagnostic it emits goes
to Problems. If a file is edited by any means — a human keystroke, a
build script, an AI pipeline — the edit is a real save with the same
confirm path as any other save. See `docs/feats/runtime/design-error-handling.md`.

**4. `.craidd` is a marker. `.cln` is composition. Neither grows.**

`.craidd` stays five to six lines. `.cln` stays a declaration of
projects, roles, and configurations. Anything that would add a field
to either file for convenience — a cached manifest value, a
workspace-wide setting, a machine fact — belongs in the machine
preferences file, or is read from the manifest, or is a bug in the
model. See `docs/craidd-cln-model.md` and
`docs/feats/project-model/design-project-identity.md`.

**5. The user declares. The IDE obeys.**

Detection has confidence levels (`detected ✓`, `likely`, `no signal`)
and never blurs them. Inference is a first guess, correctable by the
user, and never a silent decision. The `.craidd` marker exists because
language is not always inferrable from a filename, and stating it once
is cheaper than guessing it every scan.

---

## Two ambitions that fit the model

Two directions a contributor may want to take that *do* compose with
the model. Both are welcome. Both are downstream of the foundation.
Both preserve every constraint above.

### Windows support

**What it means.** Craidd today targets Linux exclusively. A Windows
port is a real and valuable direction. It is also smaller than it
looks, because the model is already portable.

**What changes.** The modules that touch OS primitives get Windows
implementations with the same interfaces:

- `commands/containment.rs` — signal names and panic guarding. On
  Windows, signals do not exist in the same form; the same *reporting*
  interface is preserved, backed by Windows error codes.
- `commands/runner.rs` — process spawning, process groups, and the
  SIGTERM / SIGKILL teardown. On Windows, the equivalent is job
  objects and `TerminateProcess`. The `RunSpec` interface and the
  `craidd:build` event stream do not change.
- Path handling — separators, drive letters, case sensitivity. Central
  enough that a small path module already exists; a Windows port
  extends it, not the call sites.

**What does not change.** `.craidd`, `.cln`, the project model, the
linked-window registry, the gold / white semantics, the DAP client,
the tray, the frontend, the manifest readers, the configuration
inference. All platform-neutral.

**What must not change.** The containment discipline. Every process
spawned is contained, every process group is cleaned up on exit, every
failure is reported. Windows job objects implement this natively, and
the Windows port uses them, rather than relaxing the rule.

**The gate.** The Linux version must reach its open-source threshold
(Rust, TypeScript, C++ or C#, with real editing, LSP, build, and
debug) before a Windows port starts. Not because Windows is less
important, but because a port of a half-built system is half-built
twice. The gate is in the "Open source gate" section below.

### AI pipeline, on the project graph

**What it means.** An AI assistant lives inside Craidd's project
model. It reads `.cln` and `.craidd`. It knows which project owns a
file. It acts through the same file and process paths the user does.
It is not a chat box beside the editor. It is a consumer of the same
model every other feature uses.

**What it changes.** A new panel, in-window, in Phase 4. The panel has
the project graph as context: which projects compose the solution,
what language each one is, which configuration is selected, what is
running, what is paused. When it edits a file, the edit goes through
the standard save path — with the same dirty-state prompt, the same
conflict check, the same undo behavior. When it runs a command, the
command goes through the same runner, with the same containment, the
same Output stream, the same Stop button.

**What it does not change.** The model. The AI does not invent a
project structure, does not bypass the save flow, does not run
processes outside the runner, does not write to `.cln` or `.craidd`
without the user asking. It is a *user* of the model, not a *peer* of
it.

**Why this composes.** Because Craidd already has the thing an AI
needs to be useful in an IDE: a project graph. VS Code-based editors
do not. They see a folder and a set of files. An AI built on them has
to guess what the project is, and it guesses wrong, and the user
corrects it. An AI built on Craidd does not guess. It is handed the
project.

**The gate.** LSP and DAP must be working before the AI panel lands.
The panel is not a research project; it is a feature, and features
ship after the foundation. See `docs/future/future-ide-considerations.md` for
the shape of the panel and `docs/future/future-idea-python.md` for the ML
angle below.

### Python and ML tooling

**What it means.** Python is on the language list. It is supported
like every other language: a `.craidd` project with
`language = "python"`, LSP via `pyright`, DAP via `debugpy`,
interpreter discovery from `.venv` / `venv` / `pyproject.toml`. No
special cases.

**What makes it interesting later.** Once Python works like any other
language, Craidd can treat ML projects as first-class project *kinds*
rather than as "Python scripts with extra files." A `.craidd` could
declare `kind = "model"`, and the bottom panel could gain a
**Training** tab showing live loss and metric curves, step count, GPU
memory, and checkpoint files as they appear. The debug context could
include a Training Run context, so a conditional breakpoint on
`step == 3000` pauses the run and freezes the chart at the moment the
model broke.

This is not "adding AI features." It is treating ML projects as the
polyglot systems they actually are: Python orchestrating, C++ or CUDA
in the kernels, Rust or Go in the serving layer, YAML in the configs.
No existing IDE treats the whole thing as one project. Craidd can.

**What it does not change.** The same rule as every other language:
Python is a table entry in `src/lib/languages.ts` plus a small
interpreter-discovery helper. The ML view is a use of the existing
bottom panel, not a new architecture.

**The gate.** Python support and the Training view are Phase 4.x. They
wait for Phase 3 (LSP) and Phase 3.x (DAP) to be complete, and for
Rust, TypeScript, C++, and C# to work end-to-end. The full sketch is
in `docs/future/future-idea-python.md`.

---

## What we deliberately do not build

- Session restore of tabs. State, not intent.
- Terminal restore. A "restored" terminal is a new shell.
- Debug session restore. A "restored" debug session is a lie.
- Persistent build logs. The console is the log.
- Auto-telemetry. No. Ever.
- Custom languages and frameworks. Fixed set. See
  `docs/feats/project-model/design-project-identity.md`.
- A workspace concept. `.cln` is the workspace.
- An AI that acts outside the project graph. The AI is a consumer of
  the model, not a peer of it.

---

## The open source gate

Rust + TypeScript + C++ (or C#) with real editing, LSP, build, and
debug. When three languages work end-to-end, Craidd goes public.

Not before. A half-working three-language IDE is worse than no IDE.

The Windows port and the AI pipeline both wait on this gate. Not
because they are less important, but because a port of an unfinished
system and an AI on top of an unfinished model are both premature.

---

## The direction

Craidd is a Visual Studio / JetBrains IDE wearing VS Code's jacket.

Solution and project model from Visual Studio. Per-language trees from
CLion and Rider. Config-as-facet from both. Lightweight chrome,
command palette, and modern feel from VS Code. None of VS Code's "a
folder is a folder" model.

The thesis: **the user declares structure. The IDE never infers.**

Every feature in the sequence above is a consequence of that thesis.
Every constraint above exists to protect it. Every ambition above is
welcome *because* it composes with it.

A feature that requires the thesis to bend is not a feature of
Craidd. It is a different product wearing Craidd's clothes.

---

*Last updated: Phase 2.4.4. Author: skira24.*
*This document is a plan. It is the ordering reference.*
