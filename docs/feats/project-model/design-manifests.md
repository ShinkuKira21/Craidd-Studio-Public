# Design: Manifests

**Roadmap track:** Phase 2.3 foundation; Phase 3 build/debug consumers. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Foundational design, reading introduced in Phase 2.3.2. Current
source includes manifest reading, configuration inference and build execution.
The milestone descriptions below record the original progression; they are
not a claim that inference/build are still unimplemented.

**Applies to:** Phase 2.3.2 (read), Phase 2.3.3 (inference from), Phase 3+ (build from).

**Governs:** What a manifest is, what it is not, and how Craidd uses it.

---

## What a manifest is

A **manifest** is a file that a project's own ecosystem wrote to describe
itself to its own build tool. It is the ecosystem's declaration of:

- What the project is called.
- What it builds.
- What it depends on.
- How its own tool should invoke itself.

Craidd **reads** these files. Craidd never writes them. Craidd never
mirrors their contents into `.craidd` or `.cln`.

A manifest file is *not* a Craidd file. It is owned by Cargo, npm,
MSBuild, CMake — whichever ecosystem the project belongs to. It travels
with the project folder, not with the solution.

### The recognized manifest types

| Language | Manifest | Ecosystem | Presence |
|---|---|---|---|
| Rust | `Cargo.toml` | Cargo | Effectively always |
| TypeScript / JavaScript | `package.json` | npm / yarn / pnpm | Effectively always |
| C# | `*.csproj` | .NET SDK / MSBuild | Effectively always |
| C++ (CMake) | `CMakeLists.txt` | CMake | Optional |
| C++ (Meson) | `meson.build` | Meson | Optional — not parsed in 2.3.2 |
| C++ (Make) | `Makefile` | Make | Optional — not parsed in 2.3.2 |
| C++ (bare) | *(none)* | — | Common |

For Rust, TypeScript, and C#, the manifest is guaranteed by the ecosystem —
the language's own tool refuses to work without it. For C++, there is no
single default. CMake is one option among several, and "no build system,
just files" is completely normal.

There is no manifest for a bare `.cpp` file. A folder containing
`main.cpp` and nothing else is not a C++ *project* in the manifest sense.
It is source code, and the decision of how to compile it is the user's,
made by typing a command. That decision becomes a Craidd build
configuration (Tier 3), not a manifest.

---

## What Craidd does with a manifest

### Phase 2.3.2 — Reading (foundation)

A Rust command, `read_manifests(folder)`, reads the top level of a folder
and returns any recognized manifests as loose structs:

+++
pub struct Manifest {
    pub kind: String,               // "cargo" | "npm" | "dotnet" | "cmake"
    pub path: String,               // absolute path to the file
    pub folder: String,             // absolute path to its folder
    pub values: serde_json::Value,  // loosely-typed extracted fields
}
+++

- One level only. No recursion. No ascent.
- No dependency added: `toml` and `serde_json` were already in the crate;
  `.csproj` and `CMakeLists.txt` are parsed as text.
- The frontend calls this once per project in `populateTrees`, and stores
  the result on the project object as `manifests?: Manifest[]`. It is
  session-only and refreshed alongside the tree.

### Phase 2.3.3 — Inference (subsequent milestone)

The three-tier build configuration system reads `project.manifests` and
infers build defaults:

- **Tier 1 — Solution Default.** Inferred from the loaded `.cln` and its
  projects' manifests. E.g. a Rust project with a `Cargo.toml` beside a
  TypeScript project whose `package.json` exposes `scripts.tauri` is the
  Tauri signature; Solution Default becomes `npm run tauri dev`.
- **Tier 2 — Per-project Defaults.** Inferred from each project's
  `.craidd` + manifest. E.g. a Rust project with a `Cargo.toml` that
  declares a binary → `cargo build`.
- **Tier 3 — User-authored configs.** `[[build]]` entries written into
  `.cln` by the Add/Edit Build Configuration dialog. Overrides Tiers 1
  and 2 for their scope.

Each tier only shows entries it has actual evidence for. No empty rows.
No "probably X." When evidence is weak or absent, State 0 applies — the
dropdown shows a call to action instead of a guess.

### Phase 3+ — Build and debug

The build runner invokes the ecosystem's own tool with the manifest's
declared command. Craidd never parses the compiler's arguments on the
user's behalf; it runs the tool the ecosystem declared, in the folder
the manifest lives in, and streams the tool's own output.

---

## Linux-native implications

Craidd Studio targets **Linux exclusively**. No Windows support is planned.
Every design assumption flows from that.

- **No drive letters.** Paths are absolute from `/`. Prefix checks like
  `starts_with(root)` are clean and unambiguous.
- **No backslashes.** `/` is the only separator. Defensive
  `.replace('\\', '/')` calls exist because some `.cln` files may be
  hand-edited or authored on other systems; they are not load-bearing.
- **No `.exe`.** Cargo produces extensionless binaries. CMake produces
  extensionless binaries. `.NET` on Linux produces `MyApp.dll` plus a
  native apphost `MyApp` (extensionless). The `.exe` extension does not
  exist here and Craidd never reasons about it.
- **Case-sensitive filesystem.** `Cargo.toml` and `cargo.toml` are
  different files. Manifests are read by exact name.

### The .NET case specifically

On Linux, `dotnet build` produces:

- `MyApp.dll` — the managed assembly, cross-platform, run via
  `dotnet MyApp.dll`.
- `MyApp` — the native apphost, extensionless, produced when the
  `.csproj` declares `<OutputType>Exe</OutputType>`.

Neither is a `.exe`. Both are produced by the same `dotnet build`.
Craidd's future build runner will not special-case the extension —
because on this platform, there is no extension to special-case.

---

## What a manifest is not

- **Not a Craidd file.** Never written by Craidd. Never mirrored into
  `.craidd` or `.cln`.
- **Not a project declaration.** That is `.craidd`'s job. `.craidd` says
  a folder *is* a Rust project; `Cargo.toml` says *what that Rust project
  builds*.
- **Not a solution declaration.** That is `.cln`'s job. `.cln` says which
  projects compose a solution; each project's manifest says how that
  project builds itself.
- **Not a machine fact.** That is
  `~/.craidd-studio/user_preferences.toml`'s job. Which `cargo` binary
  exists on the machine is a preferences question. What `Cargo.toml`
  says the crate is called is a manifest question. They are orthogonal.

---

## What Craidd never does with a manifest

- Never writes to it.
- Never caches its contents to disk.
- Never copies its fields into `.craidd` or `.cln`.
- Never overrides its declared commands without the user asking.
- Never reads it from outside the project's resolved folder.

The manifest belongs to the ecosystem. Craidd reads it, holds the parse
in memory for the session, uses it to inform build inference, and
forgets it when the session ends.

---

## Future: Convert to CMake Project

A C++ project with no manifest is a common case: a folder of `.cpp` and
`.h` files with no build system. Today this project sits at State 0 —
no inferred build configuration. The user writes one manually.

The natural upgrade path — modelled on JetBrains' behavior — is a
**right-click C++ project → Convert to CMake Project…** wizard:

1. The user invokes it from the Solution Explorer context menu.
2. The wizard inspects the folder and proposes a `CMakeLists.txt`:
   - Project name from the folder name.
   - `add_library` if it finds only headers and translation units.
   - `add_executable` if it finds a `main.cpp`.
   - `CMAKE_CXX_STANDARD` from an optional picker, default C++20.
3. The user reviews and confirms.
4. Craidd writes the `CMakeLists.txt` — the only time Craidd writes a
   manifest, because at that moment it is *creating* the ecosystem's
   file for a project the user just declared.

Once written, the file belongs to the project and to CMake. Craidd never
modifies it again. It reads it like any other manifest.

This is not scoped for Phase 2.x. It is recorded here so the direction is
on the record. When it lands, it lands as a Phase 3.x or later feature,
and it inherits the same rule everything else does: the manifest is
ecosystem-owned, read-only from Craidd's side, and written exactly once
at the moment of creation.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
