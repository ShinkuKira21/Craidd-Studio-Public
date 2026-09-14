# Design: Solution Orchestration

**Status:** Planned. Not yet built.
**Scope:** What a `.cln` file contains, and how it drives build, run,
and debug.
**Governs:** Phase 3 (build orchestration, debug contexts).

---

## The thesis

**`.cln` is orchestration, not configuration.**

It says which projects belong to this solution, how they are built, how
they are run, and how they are debugged. It does not say what any
project *is* (that is `.craidd`) or where tools live (that is
preferences).

A `.cln` is the solution's runtime story. Portable. Committable. The
same `.cln` on two machines produces the same build, run, and debug
targets — using whatever tools each machine has.

---

## What already exists

`.cln` already holds:

    [solution]
    name = "tauri-app"
    version = "1.0"

    projects = [
      "src-tauri/src-tauri.craidd",
      "src/src.craidd",
    ]

    [[build]]
    target = "src-tauri/src-tauri.craidd"
    method = "cargo"
    command = "cargo build --release"

    [run]
    default = "src-tauri/src-tauri.craidd"

    [debug]
    default = "src-tauri/src-tauri.craidd"
    autostart = []

This works today — the loader parses it, the store keeps it, the
sidebar shows it. It has never been exercised because build and debug
have not been built.

---

## What this document is adding

Two concepts, both deferred to Phase 3:

1. **Named run configurations.** A solution can have multiple ways to
   run it. `npm run tauri dev` for the whole app. `npm run dev` for the
   frontend alone. `cargo run` for the Rust binary alone.
2. **Named debug configurations.** A solution can have multiple debug
   targets. The Rust backend, the TypeScript frontend, an attached
   Chrome DevTools session.

These become the entries in the **debug context dropdown** — a
long-planned UI element that finally has a reason to exist.

---

## Named configurations

### Shape

    [[run.config]]
    name = "Tauri (dev)"
    project = "src-tauri"
    command = "npm run tauri dev"
    cwd = "."

    [[run.config]]
    name = "Frontend only"
    project = "src"
    command = "npm run dev"
    cwd = "src"

    [[run.config]]
    name = "Rust backend"
    project = "src-tauri"
    command = "cargo run"
    cwd = "src-tauri"

    [[debug.config]]
    name = "Rust backend (LLDB)"
    project = "src-tauri"
    adapter = "lldb"
    command = "cargo run"

    [[debug.config]]
    name = "Frontend (web inspector)"
    project = "src"
    command = "npm run dev"
    attach = "cdp://localhost:1420"

    [[debug.config]]
    name = "Full app (backend + frontend)"
    project = "src-tauri"
    command = "npm run tauri dev"
    attach = "cdp://localhost:1420"
    spawn = ["Frontend (web inspector)"]

### What each field means

| Field | Meaning |
|---|---|
| `name` | The label in the dropdown. User-authored. |
| `project` | Which `.craidd` this config runs against. |
| `command` | The exact command to run, in `cwd`. |
| `cwd` | Working directory, relative to solution root. |
| `adapter` | Debug adapter to attach (Phase 3). `lldb`, `netcoredbg`, `cdp`. |
| `attach` | Attach to a running process on this address (Phase 3). |
| `spawn` | Start these other configs first (Phase 3). |

Not all fields apply to all configs. A run config has `command` and
`cwd`. A debug config has `adapter` or `attach` or both.

---

## The debug context dropdown

The toolbar has a dropdown (currently a placeholder) that shows the
active debug context. It becomes real when `[[run.config]]` and
`[[debug.config]]` exist.

    ┌─────────────────────────────────┐
    │ Debug:  [Full app ▾]            │
    └─────────────────────────────────┘
              │
              ├─ Rust backend (LLDB)
              ├─ Frontend (web inspector)
              ├─ Full app (backend + frontend)     ◀ active
              └─ Edit configurations…

**F5** runs the active debug config. **Ctrl+F5** runs the active run
config. Switching contexts switches what F5 does.

`Edit configurations…` opens a small editor for `[[run.config]]` and
`[[debug.config]]` entries, writing back to `.cln`.

This is how CLion works. This is how Rider works. This is how a proper
IDE works.

---

## The Tauri polyglot example, made concrete

A Tauri v2 app has two projects:

- `src-tauri/` — Rust, framework `tauri`
- `src/` — TypeScript, framework `tauri`

**Building:**

- `cargo build` in `src-tauri/`, driven by the `[[build]]` entry.
- `npm run build` in `src/`, if the user wants a production frontend.
- Or `npm run tauri build` from the solution root, which does both.

**Running:**

- `npm run tauri dev` — starts the Vite dev server, compiles Rust,
  launches the window. The everyday case.
- `npm run dev` — starts only the Vite dev server. Useful when the Rust
  side is stable.

**Debugging:**

- Rust backend: LLDB attaches to the compiled binary. Breakpoints in
  `.rs` files.
- Frontend: Chrome DevTools Protocol attaches to the WebView's
  inspector port. Breakpoints in `.tsx` files.
- Full app: both at once. The Rust process is spawned by
  `npm run tauri dev`; the frontend inspector attaches to the port
  Vite opens.

The debug context dropdown switches between them. This is the polyglot
story, made real.

---

## ASP.NET, made concrete

An ASP.NET project is a single C# project with `framework = "aspnet"`.

**Running:**

- `dotnet run` — starts Kestrel on the port in
  `Properties/launchSettings.json`.

**Debugging:**

- `netcoredbg` attaches to the `dotnet` process.

**Configurations:**

    [[run.config]]
    name = "ASP.NET (dev)"
    project = "MyApi"
    command = "dotnet run"
    cwd = "."

    [[debug.config]]
    name = "ASP.NET (debug)"
    project = "MyApi"
    adapter = "netcoredbg"
    command = "dotnet run"
    cwd = "."

The launch profile in `launchSettings.json` sets environment variables
and ports. Craidd runs `dotnet run` exactly, and the profile takes over.
No Craidd-specific ASP.NET knowledge required.

---

## C++ / CMake, made concrete

A C++ project with `framework = "cmake"` and `kind = "library"`
produces a shared object.

**Building:**

- `cmake --build build/` — builds the target declared in
  `CMakeLists.txt`.

**Running (for an `application` kind):**

- `./build/myapp` — runs the built binary.

**Debugging:**

- LLDB attaches to the compiled binary.
- For a `.so` loaded by another process (e.g., C# via P/Invoke), the
  debug config attaches to the host process.

**Configurations:**

    [[run.config]]
    name = "C++ app"
    project = "native"
    command = "./build/myapp"
    cwd = "."

    [[debug.config]]
    name = "C++ app (LLDB)"
    project = "native"
    adapter = "lldb"
    command = "./build/myapp"
    cwd = "."

Static libraries and managed C++ are out of scope for v1. `library`
means `.so`.

---

## What this is not

This document is a sketch, not a specification. Phase 3 will produce a
fuller design when build orchestration is actually built. The TOML
shapes above are illustrative of the direction, not commitments to
specific field names or structures.

What is committed:

- Build, run, and debug configurations live in `.cln`, not `.craidd`.
- Configurations are named.
- The debug context dropdown is the UI for switching between them.
- Every invocation is transparent (see
  `docs/philosophy-tool-discovery.md`).
- Tools are discovered, not bundled (same document).

What is deferred to Phase 3:

- Exact TOML field names and nesting.
- The `Edit configurations…` UI.
- Adapter registration and lifecycle.
- The `spawn` mechanism for multi-process configs.
- How configurations interact with the `[[build]]` entries that
  already exist.

---

## Open questions for Phase 3

- **Build vs run vs debug.** Currently `[[build]]` is a top-level array
  and `[run]` / `[debug]` are tables with defaults. When named
  configurations arrive, does `[[build]]` become `[[build.config]]`?
  Does the existing `default` field survive?
- **Ordering.** When multiple configs run (via `spawn`), what is the
  ordering rule? Does the frontend wait for the backend, or do they
  start in parallel?
- **Lifecycle.** When a debug session ends, do spawned processes get
  killed, or do they survive? What if the user closes the tab?
- **Ports.** If a config expects a specific port and the port is
  already in use, what happens? Detection, error, or silent failure?

None of these need answers today. They need answers before Phase 3
begins.

---

*Last updated: Phase 2.1.4. Author: skira24.*
*This file is a sketch. Phase 3 will rewrite it as a specification.*
