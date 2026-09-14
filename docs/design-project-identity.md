# Design: Project Identity

**Status:** Locked.
**Scope:** What a `.craidd` file contains, and what it means.
**Governs:** Phase 2.1.4 (schema), Phase 2.4 (membership), Phase 2.5 (detection).

---

## The thesis

**`.craidd` is a marker, not a manifest.**

It says what a folder *is*. It does not say how to build it, how to run
it, which tools to use, or where those tools live. Those are facts
about a solution (`.cln`) or a machine (preferences).

A `.craidd` should be small enough to read in five seconds.

---

## The shape

    [project]
    name = "src-tauri"
    language = "rust"
    framework = "tauri"
    kind = "application"
    root = "."

Five fields. Every one is a fact about *what this project is*,
portable across machines, meaningful in git.

Later phases add `[membership]`:

    [membership]
    main = ["src/**/*.rs", "Cargo.toml"]
    config = ["tauri.conf.json"]

And that is the whole file. Nothing else ever goes in `.craidd`. No
build commands. No toolchain paths. No debug configs. If a fact belongs
to the solution or the machine, it goes in `.cln` or preferences.

---

## Language

Closed enum. Five values.

    export type Language =
      | "rust"
      | "typescript"
      | "javascript"
      | "csharp"
      | "cpp";

`typescript` and `javascript` are separate language IDs because the
ecosystem distinguishes them, but they share the same frameworks and
interop: a TypeScript project can include `.js` files, and vice versa.

### No Custom

There is no "Custom Language" option. Craidd supports a defined set.
Everything outside it is out of scope. The user with a language we
don't support is a VS Code user, and that is fine.

See *Out of scope, deliberately* at the end of this document for the
full reasoning.

---

## Framework

Closed enum. Four values.

    export type Framework =
      | "standard"
      | "tauri"
      | "aspnet"
      | "cmake";

`standard` means "no specific framework — the language's default
toolchain." Every language supports `standard`.

`frameworksFor(language)` returns the valid frameworks for a language:

| Language | Frameworks |
|---|---|
| rust | `standard`, `tauri` |
| typescript | `standard`, `tauri` |
| javascript | `standard`, `tauri` |
| csharp | `standard`, `aspnet` |
| cpp | `standard`, `cmake` |

### What framework means

Framework is the **ecosystem profile** of a project. It determines:

- Which template to use when creating a project.
- Which detection signals to look for.
- Which build commands make sense.
- Which LSP and debugger configuration applies.
- What "Run" means for this project.

A C# console app and a C# ASP.NET app share a language but differ in
framework. Framework is the axis that captures this.

### Tauri is one framework, two projects

Tauri v2 spans a Rust project and a TypeScript project. Both declare
`framework = "tauri"`. They are separate `.craidd` files, in separate
folders, joined by the `.cln`'s project list. The framework value is
how Craidd knows they belong together.

---

## Kind

Closed enum. Three values now.

    export type ProjectKind = "application" | "library" | "test";

Kind is orthogonal to language and framework. A C++ CMake project can
be an `application` or a `library`. A Rust Tauri project is always an
`application`.

For C++ specifically, `library` in v1 means a shared object (`.so`).
Static libraries (`.a`, `.lib`) and managed C++ are out of scope. See
*Future kind values* below.

### Future kind values

Not implemented. Recorded here so the axis does not get lost.

- `shared_object` — when static and shared libraries need to be
  distinguished as separate kinds. Currently `library` means `.so` for
  C++, and no distinction is drawn.
- `model` — a training script with checkpoints and metrics. See
  `docs/future-idea-python.md`.
- `service` — a long-running process with an endpoint.
- `kernel` — performance-critical native code (CUDA, SIMD).

Each is a value in the same enum when the phase that needs it arrives.

---

## Detection

When the user says "Make This a Project," Craidd reads the folder's
contents and proposes a language and framework. The user confirms or
corrects.

**Detection reads declarations, not extensions.**

A `.csproj` file with `<Project Sdk="Microsoft.NET.Sdk.Web">` is the
framework *declaring what it is*. Reading it is not guessing. A folder
with `.cs` files and no `.csproj` is a folder with some C# in it.
Suggesting C# there would be guessing.

### The table

| Signal on disk | Suggests | Confidence |
|---|---|---|
| `Cargo.toml` + `tauri.conf.json` | Rust / Tauri | detected |
| `Cargo.toml` alone | Rust / Standard | detected |
| `.csproj` with `Sdk="Microsoft.NET.Sdk.Web"` | C# / ASP.NET | detected |
| `.csproj` with `Sdk="Microsoft.NET.Sdk"` | C# / Standard | likely |
| `package.json` with `@tauri-apps/*` in deps | TS / Tauri | detected |
| `package.json` alone | TS / Standard | likely |
| `CMakeLists.txt` | C++ / CMake | detected |
| `.rs` files, no `Cargo.toml` | Rust / — | no signal |
| `.cs` files, no `.csproj` | C# / — | no signal |
| `.cpp` / `.h` files, no `CMakeLists.txt` | C++ / — | no signal |

### Confidence vocabulary

Three levels. All three are visible in the dialog.

- **detected** — the framework declared itself. A manifest file is
  present with an unambiguous signal. Trust it.
- **likely** — the ecosystem's strong convention. A `package.json`
  exists but does not name a framework. Suggest `standard` with a note.
- **no signal** — no manifest file. Show the folder's contents and ask
  the user to pick. Do not pre-fill.

The wording is honest. "Detected" and "likely" are different. The user
should know which they are looking at.

### Why detection is not inference

We do not look at file extensions and guess. We look for declaration
files — manifests, project files, config files — and read what they
say. A `Cargo.toml` says "this is a Rust project." A `tauri.conf.json`
says "this is a Tauri app." These are declarations, not hints.

Extension-based inference is what every other IDE does, and it is why
they are wrong about mixed-language projects. Craidd reads
declarations.

---

## Overfitting doesn't matter

Because detection is correctable.

A wrong guess is a suggestion, not a bug. The dialog shows what Craidd
found. The user changes it if it is wrong. The correction is written to
`.craidd`, and Craidd never proposes that wrong value for that project
again.

This flips the entire problem: **Craidd does not have to be right. It
has to be correctable.**

### The endgame

The dialog becomes optional.

Not because automation got smart enough to be trusted blind, but
because it got smart enough that correcting it is rarely needed. The
dialog stays — as the "Advanced…" escape hatch — but most of the time,
the user does not open it.

Three lines, three checkmarks, hit Enter:

    Make This a Project

    Language:    Rust                    ✓
    Framework:   Tauri                   ✓
    Toolchain:   cargo 1.75.0            ✓

    [Advanced…]                  [Create Project]

That is the destination. Everything else is the road.

---

## The three scopes

A fact's scope determines which file it lives in.

| Fact | Scope | File |
|---|---|---|
| Project name | Project | `.craidd` |
| Language | Project | `.craidd` |
| Framework | Project | `.craidd` |
| Kind | Project | `.craidd` |
| File membership | Project | `.craidd` (later) |
| Which projects exist | Solution | `.cln` |
| Build entries | Solution | `.cln` |
| Run configurations | Solution | `.cln` (later) |
| Debug configurations | Solution | `.cln` (later) |
| Toolchain paths | Machine | preferences |
| Toolchain versions | Machine | preferences |
| User tool overrides | Machine | preferences |

**The rule:** a project fact goes in `.craidd`. A solution fact goes in
`.cln`. A machine fact goes in preferences. Never ambiguous.

### Why toolchain is not in `.craidd`

Because toolchain is not portable.

If a `.craidd` said `sdk_path = "/usr/bin/cargo"`, that path would be
right on one machine and wrong on another. On macOS, `/usr/bin/cargo`
might not exist at all. The file that was supposed to say "this is a
Rust project" ends up saying "this is a Rust project, on Linux, with
cargo here, on this specific machine."

Project files must be portable. Machine facts must not be. The
separation is the point.

### Why build, run, and debug configs are not in `.craidd`

Because they are solution-level concerns.

A solution has multiple projects. One is the startup project. Build
orchestration may span projects. Debug configurations reference launch
targets, ports, environment variables. All of these are the solution's
runtime story, not any single project's identity.

`.craidd` says "I am a C# ASP.NET project." `.cln` says "when you run
this solution, launch the ASP.NET project, on port 5000, with these
environment variables." Two different facts. Two different files.

---

## Out of scope, deliberately

- **Custom languages.**
- **Custom frameworks.**
- **User-authored detection rules.**
- **A `.vscode/`-style config directory.**

Craidd supports a defined set: five languages, four frameworks. The
set is explicit, small, and auditable. Everything outside it is out of
scope — not guessed at, not half-supported, not "coming soon."

### Why

1. **Custom solves a problem we do not have yet.** Craidd supports
   Rust, TypeScript, JavaScript, C#, and C++. That is the target
   audience. A user with an obscure framework is a user we have not
   designed for. Adding Custom now is building for people who are not
   here yet, at the cost of the people who are.
2. **Custom multiplies every schema decision.** Every field would need
   a "custom" variant and validation rules. Complexity in the core, for
   a feature at the edge.
3. **VS Code exists for that user.** If a developer's stack is outside
   the defined set, VS Code and a terminal is their answer. Craidd is
   not trying to serve them. Craidd serves the polyglot system
   developer.

### The guardrail

If we ever revisit this: revisit it after Rust, TypeScript, C++, and
C# all work end to end with LSP, build, and debug. Not before. And when
we do, it will not be a `.craidd` feature — it will be a separate,
adjacent mechanism that Craidd reads but does not own.

This paragraph is written so future-me does not re-open this at 2 AM in
Phase 3 and start building a `.vscode/`-equivalent because it seems
neat.

---

## The schema, final for v1

    [project]
    name = "src-tauri"
    language = "rust"
    framework = "tauri"
    kind = "application"
    root = "."

Five fields. `language` and `name` are required. `framework` defaults
to `"standard"`, `kind` defaults to `"application"`, `root` defaults to
`"."`. Older `.craidd` files without `framework` and `kind` still load.

---

*Last updated: Phase 2.1.4. Author: skira24.*
*This file is a design. It changes only by rewriting it.*
