# Design: Solution Orchestration

**Status:** Placeholder. Not yet designed in full.
**Applies to:** Phase 3+.
**Governs:** How `.cln` declares what a solution does — build, run, debug.

---

## Why this document exists

In Phase 2.1.3, we sketched the polyglot story concretely for the first
time. The clearest example was Tauri:

- The backend is Rust, built with `cargo build`.
- The frontend is TypeScript, served by `npm run dev`.
- The combined dev flow is `npm run tauri dev`, which starts both.
- The debugger attaches to the WebView through CDP.

That is four different things, and none of them belong in `.craidd`.
They belong to the solution — the thing that knows how the pieces fit.

`.cln` is the file that will hold this. Its schema already exists for
the simplest case (`[[build]]` entries, `[run] default`, `[debug]
default`). This document will define the full schema when Phase 3
designs it.

**This document is a placeholder.** It captures the shape of what we
sketched, so that the shape is not lost. The specifics will be written
when Phase 3 begins.

---

## The three-file boundary, restated

- `.craidd` says *what a project is*. (See `design-project-identity.md`.)
- `~/.craidd-studio/user_preferences.toml` says *what the machine has*.
  (See `philosophy-tool-discovery.md`.)
- `.cln` says *how the solution orchestrates the tools to build, run, and
  debug*.

The `.cln` is the only file that references more than one project. It is
the only file that describes actions across the solution. It is the file
that makes a polyglot project into a polyglot *system*.

---

## What `.cln` will hold (sketch)

The current schema supports the simplest case:

+++toml
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
+++

The full Phase 3 schema will extend this with:

**Named run configurations:**

+++toml
[[run.config]]
name = "Tauri (dev)"
project = "src-tauri"
command = "npm run tauri dev"

[[run.config]]
name = "Frontend only"
project = "src"
command = "npm run dev"
+++

**Named debug configurations:**

+++toml
[[debug.config]]
name = "Backend (LLDB)"
project = "src-tauri"
adapter = "lldb-dap"

[[debug.config]]
name = "Frontend (CDP)"
project = "src"
adapter = "cdp"
attach = "http://localhost:1420"
+++

**Build orchestration across projects:**

+++toml
[[build.pipeline]]
name = "Release"
steps = [
  { target = "src-tauri", method = "cargo", args = ["build", "--release"] },
  { target = "src",       method = "npm",   args = ["run", "build"] },
]
+++

None of this is designed yet. The point is that the `method` field names
a *known* tool category (`cargo`, `npm`, `dotnet`, `cmake`), and Craidd
knows how to invoke that category. The user does not write arbitrary
shell strings. The user names a method and provides arguments.

---

## The debug context dropdown

The toolbar already has a placeholder for this — the Run/Debug controls
that say "arrive in Phase 3."

When Phase 3 ships, this dropdown will be populated from `.cln`'s
`[[run.config]]` and `[[debug.config]]` entries. Switching contexts
changes what `F5`, `Ctrl+F5`, and the step controls do. This is the
same pattern as CLion's Run Configurations and Rider's Run/Debug
Configurations.

The dropdown reads from `.cln`, not from preferences, not from `.craidd`.
Same reasoning as everywhere else.

---

## The Tauri example, made concrete

A Tauri project's `.cln` (sketch, Phase 3):

+++toml
[solution]
name = "tauri-app"
projects = ["src-tauri/src-tauri.craidd", "src/src.craidd"]

[[run.config]]
name = "Tauri dev"
project = "src-tauri"
method = "npm"
args = ["run", "tauri", "dev"]
# craidd knows npm from preferences; knows Tauri dev flow from the
# "tauri" framework on the Rust project.

[[debug.config]]
name = "WebView (CDP)"
project = "src-tauri"
method = "cdp-attach"
port = 1420
+++

Pressing `F5` with "WebView (CDP)" selected:
1. Craidd runs `npm run tauri dev` via the frontend project's `npm`
   (from preferences).
2. Tauri starts the Rust backend and serves the frontend.
3. Craidd attaches a CDP client to port 1420.
4. The WebView inspector opens as a debug pane inside Craidd.

The user declared the run flow in `.cln`. The user's machine provided
`npm` and `cargo` through preferences. The framework was declared as
`tauri` in `.craidd`. Each fact lives in the right file.

This is the polyglot story. It is why Craidd exists.

---

## What this document is not

This document is not a design. It is a sketch. Nothing here is committed.
When Phase 3 begins, this document will be rewritten with the actual
schema, the actual commands, the actual flows.

What matters now is that the *shape* is preserved:

- `.cln` holds orchestration.
- Tools are named, not scripted.
- Machine facts stay in preferences.
- Project identity stays in `.craidd`.
- The debug context dropdown reads from `.cln`.

Everything else is negotiable.

---

*Last updated: Phase 2.1.3. Author: skira24.*
*This document is a placeholder. Rewrite it when Phase 3 begins.*
