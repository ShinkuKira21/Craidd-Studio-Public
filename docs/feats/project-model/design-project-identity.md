# Design: Project Identity

**Roadmap track:** Phase 2 identity/discovery foundation; retained in Phase 3.x. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Foundational design. Current source includes project identity,
discovery and project dialogs. Earlier implementation notes below describe the
original Phase 2 baseline; review the current codebase map before using them
as a change list.

**Applies to:** Phase 2.1.4 (schema), Phase 2.5 (detection + dialog).

**Governs:** What a `.craidd` file is, what it declares, and where every
other kind of fact lives.

---

## The three-file model

Craidd has three files, three scopes, three concerns. Everything else is
built on this split.

| File | Scope | Contains | Portable? |
|---|---|---|---|
| `.craidd` | Project | Identity — what this project *is* | Yes |
| `.cln` | Solution | Orchestration — how the solution *runs* | Yes |
| `~/.craidd-studio/user_preferences.toml` | Machine | Facts — what tools *exist here* | No |

The rule for what belongs where:

- **A fact about the project** → `.craidd`.
- **A fact about the solution** → `.cln`.
- **A fact about this machine** → preferences.

A fact that is true on every machine where the project exists belongs in
`.craidd` or `.cln`. A fact that is only true on one machine belongs in
preferences. Nothing is ever ambiguous under this rule.

---

## `.craidd` is a marker

The guiding principle: **`.craidd` should be so small it could be a sticky
note.**

A complete, valid `.craidd`:

+++toml
[project]
name = "src-tauri"
language = "rust"
framework = "tauri"
kind = "application"
root = "."
+++

Five lines. That is all.

It says: this folder is a Rust Tauri application, and its source root is
the folder itself. Nothing else.

### What `.craidd` contains

**Required:**

- `name` — human-readable project name.
- `language` — one of the supported language enums.

**Optional:**

- `framework` — a framework profile for this language. Defaults to
  `"standard"` if omitted.
- `kind` — `application`, `library`, `test`. Defaults to `"application"`.
- `root` — path to the source root relative to the `.craidd` file.
  Defaults to `"."`.

**Original later-scope note (Phase 2.1.3+ at drafting):**

- `[membership]` — the Fine Tune persistence. Which files belong to the
  project, which belong to its config, which belong to neither.
- `[config]` — the config facet declaration, for projects that have one.

### What `.craidd` does NOT contain

- **No toolchain paths.** Where `cargo` lives is a fact about the machine.
- **No build commands.** `cargo build` is Craidd's knowledge, not the
  user's declaration. If the user needs a custom build, that goes in
  `.cln`.
- **No run commands.** Same reason. `.cln` territory.
- **No debug configurations.** Same reason. `.cln` territory.
- **No environment variables.** Same reason. `.cln` territory.
- **No paths outside the project.** The `.craidd` describes itself, not
  its relationship to the solution. That is `.cln`'s job.

If a user ever needs to put any of these in a `.craidd`, the answer is:
that fact belongs in `.cln` or preferences, and the schema does not
accommodate putting it here.

---

## The language enum

Craidd supports seven languages, and only these:

| Value | Display | Extensions |
|---|---|---|
| `rust` | Rust | `rs` |
| `typescript` | TypeScript | `ts`, `tsx`, `mts`, `cts`, `d.ts` |
| `javascript` | JavaScript | `js`, `jsx`, `mjs`, `cjs` |
| `python` | Python | `py` |
| `cpp` | C++ | `cpp`, `cc`, `cxx`, `c`, `h`, `hpp`, `hxx` |
| `csharp` | C# | `cs` |
| `config` | Config | `json`, `toml`, `yaml`, `yml`, `ini`, `conf` |

Each language has an interop extension list (TS includes JS, C# includes
C/C++ headers, Python includes C for extensions). Interop extensions
appear in the project's tree but do not change the project's declared
language.

**This list does not grow by user request.** It grows when Craidd
implements full support for a new language — LSP, build, debug,
templates. Adding `java` to the enum without any of those is a fake
feature, and we do not ship fake features.

---

## The framework enum

Framework is a string, but the valid set is closed and enumerated per
language. The initial set:

+++
rust:       standard, tauri
typescript: standard, vite, next
javascript: standard
python:     standard, django
cpp:        standard, cmake, meson
csharp:     standard, console, aspnet
config:     standard
+++

- `standard` is the default when nothing else is declared.
- Every framework name is lowercase, no spaces, no version numbers.
  `tauri` not `Tauri`, not `tauri-2`.
- A framework implies a toolchain and a set of build/run conventions that
  Craidd knows. `tauri` implies `cargo` for the backend and `npm`/`pnpm`
  for the frontend and a CDP debug attach for the WebView.
- A framework does not change the language. A Tauri project is a Rust
  project whose framework is `tauri`.

**A project whose stack does not fit any framework in this list is out of
scope.** The user should use VS Code, or declare the project as
`standard`, or wait until the framework is added. This is deliberate (see
below).

---

## Detection

Detection runs only in one flow: **"Make This a Project"**, when the user
declares an existing folder as a project. It reads manifests on disk and
suggests language and framework.

### Signals, by confidence

**High confidence — the manifest declares itself:**

| Signal | Suggests |
|---|---|
| `Cargo.toml` + `tauri.conf.json` in same folder | Rust / tauri |
| `Cargo.toml` alone | Rust / standard |
| `*.csproj` with `Sdk="Microsoft.NET.Sdk.Web"` | C# / aspnet |
| `*.csproj` with `Sdk="Microsoft.NET.Sdk"` + `OutputType=Exe` | C# / console |
| `*.csproj` with `Sdk="Microsoft.NET.Sdk"` alone | C# / standard |
| `package.json` with `next` in deps | TypeScript / next |
| `package.json` with `vite` in devDependencies | TypeScript / vite |
| `package.json` alone | TypeScript / standard |
| `CMakeLists.txt` | C++ / cmake |
| `meson.build` | C++ / meson |
| `pyproject.toml` with `[tool.poetry]` | Python / standard |
| `manage.py` | Python / django |

These are not inferences. A `.csproj` with `Sdk="Microsoft.NET.Sdk.Web"`
*is* the framework declaring what it is. Reading it is reading a
declaration, not guessing.

**Medium confidence — strong convention:**

| Signal | Suggests |
|---|---|
| `*.csproj` present but no `Sdk` attribute | C# / standard |
| `*.toml` with `[package]` and `name` | Rust / standard (uncertain) |

Medium signals are shown with the label **"likely"**, not **"detected ✓"**.

**Low confidence — extensions alone:**

| Signal | Suggests |
|---|---|
| `.rs` files, no `Cargo.toml` | Rust / — (flag: no manifest) |
| `.cs` files, no `.csproj` | C# / — (flag: no project file) |
| `.ts` files, no `package.json` | TypeScript / — (flag: no manifest) |

Low signals suggest a language but never a framework. The dialog says
**"no signal"** for framework and lets the user choose.

**No signal:** the folder has no recognizable manifests. Language field
is empty, framework field is empty. The dialog cannot be submitted until
the user picks a language.

### Detection never runs in the background

Detection runs only when the "Make This a Project" dialog opens. It reads
manifests at the top level of the folder (not recursively) and returns
its suggestions in under 20ms. There is no watcher, no cache, no
background scan.

This is not the same as toolchain discovery, which is a separate concern
(see `philosophy-tool-discovery.md`).

### Confidence is always shown

The dialog labels every field:

- **`detected ✓`** — high confidence. A manifest declared it.
- **`likely`** — medium confidence. A convention suggests it.
- **`no signal`** — low confidence or nothing found. User must choose.

The wording is honest. The user knows exactly how much to trust each
suggestion.

---

## The "Make This a Project" dialog

When the user right-clicks a folder and chooses "Make This a Project," the
dialog opens with detection results pre-filled:

+++
Make This a Project

Folder:      src-tauri/
             Contents:  5 folders, 12 files

Language:    [ Rust ▾ ]                    detected ✓
             Cargo.toml found in this folder

Framework:   [ Tauri ▾ ]                   detected ✓
             tauri.conf.json + Cargo.toml both present

Toolchain:   cargo 1.75.0 (/usr/bin/cargo)   found ✓

[ Advanced… ]              [ Cancel ]   [ Create Project ]
+++

**Advanced…** opens the full picker for cases where the guess is wrong or
the user wants to specify more.

**Create Project** writes the `.craidd` and closes the dialog. If a
toolchain was discovered, a banner appears asynchronously (see
`philosophy-tool-discovery.md`).

### If detection is uncertain:

+++
Language:    [ Rust ▾ ]                    likely
             .rs files found, but no Cargo.toml in this folder

Framework:   [ (choose) ▾ ]                no signal
             No manifest file present
+++

The user picks, and the dialog remembers the choice for the current
session.

### If detection finds nothing:

+++
Language:    [ (choose) ▾ ]                no signal

Framework:   [ (choose) ▾ ]                no signal
+++

The Create button is disabled until both are chosen.

---

## What "Make This a Project" costs

A folder that contains files Craidd supports but no manifest — say, a
folder of `.rs` files with no `Cargo.toml` — is a Rust project in a
folder that Cargo cannot build. Craidd can declare it. Cargo cannot run
it.

The dialog says so:

+++
Language:    [ Rust ▾ ]                    likely
Framework:   [ Standard ▾ ]                no signal

⚠ No Cargo.toml found. This project will open for editing but
  cannot be built until a Cargo.toml is added.

[ Open Documentation ]                    [ Create Project ]
+++

Craidd does not refuse. It declares what the user asked, warns about the
consequence, and creates the project. The user may know something Craidd
does not.

---

## Out of scope, deliberately

**Custom languages.** A user cannot define a new language in `.craidd`.
The list of supported languages is fixed and small. Adding to it requires
Craidd to ship real support — LSP, build, debug, templates — not just a
name.

**Custom frameworks.** A user cannot define a new framework. `framework`
is a value from the enumerated list. `"standard"` is the escape hatch for
projects Craidd does not specifically know about.

**Custom detection rules.** Detection is Craidd's own table, in Rust.
Users cannot add signals. If a framework should be detected, it belongs
in the table, which means it belongs in Craidd's supported set.

**User-authored toolchain commands.** Build and run commands do not live
in `.craidd`. They live in `.cln`, and even there, they reference
Craidd-known methods (`cargo`, `dotnet`, `npm`), not arbitrary strings.
The user can change *what* runs, but not by writing shell code into a
project file.

### Why

Craidd supports a defined set of languages and frameworks. The set is
explicit, small, and auditable. Everything outside it is out of scope —
not guessed at, not half-supported, not "coming soon."

A developer whose stack does not fit this set has VS Code, and that is a
fine answer. VS Code is a general editor; Craidd is a specific IDE for
specific stacks. Their scopes are different, and that is healthy.

### When we revisit this

After Rust, TypeScript, C++, C#, and Python all work end-to-end with LSP,
build, and debug. Not before.

When we do revisit, it will not be a `.craidd` feature. It will be a
separate, adjacent mechanism that Craidd reads but does not own. A
`.vscode/`-style config, or a Craidd-specific sidecar file, or a user
preferences extension. The `.craidd` schema will not grow to accommodate
it. The marker stays a marker.

This paragraph exists so that future-you, at 2 AM in Phase 3, does not
re-open this decision because a `.vscode/`-equivalent seems neat.

---

## Original Phase 2 implementation baseline (historical)

`src/types/project.ts` already has `Language` and `ProjectKind` enums.
It does not yet have `Framework`. Phase 2.1.4 adds it as an optional
string field. No behavior changes; no dialogs change; detection is not
yet built.

`src-tauri/src/types.rs` mirrors this. The `CraiddProject` struct gains
an optional `framework: Option<String>` field with `#[serde(default)]`.
Backward compatible. Existing `.craidd` files load unchanged.

The full detection flow and the updated Make This a Project dialog arrive
in Phase 2.5, after the save system (Phase 2.2) and file operations
(Phase 2.3) are complete.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
