# The Craidd Model: `.craidd` and `.cln`

**Roadmap track:** Phase 2 foundation, governing Phase 3 and later work. See the [current roadmap](roadmaps/Roadmap-v0.0.4A.md).

**Status:** Target design contract locked in Phase 2.1, retained during the
Phase 3.x documentation review. It defines where information belongs,
but its schema migration is not fully implemented. Current code still
reads and writes optional `[project] kind` in `.craidd`, and writes a
`[solution].projects` path array instead of the `[[project]] role`
tables shown below. It also retains `[[build]]` entries when present.
It does not write a `framework` field. Do not treat the target examples
as the current on-disk format.

---

## The three layers

Craidd recognizes exactly three places where a project's nature and
behaviour can live. Each kind of information lives in exactly one of
them. No duplication. No drift.

### 1. Manifests on disk — ecosystem truth

`Cargo.toml`, `package.json`, `*.csproj`, `CMakeLists.txt`,
`pyproject.toml`, `setup.py`.

These belong to their ecosystems. Craidd **reads** them. Craidd never
writes them. Craidd never duplicates their contents into our own files.

What we learn from them:

- Whether a folder is buildable, and by what tool.
- What commands are available (`scripts.dev` in `package.json`,
  `[[bin]]` in `Cargo.toml`, targets in a `.csproj`).
- Whether a project can produce a binary, a library, or both.

This is where "the framework" lives — and it is never named by us.
A Tauri app is not "a Tauri project." It is a Rust project with a
`Cargo.toml`, whose `.cln` configuration happens to say
`command = "cargo tauri dev"`. Tauri is a string in a command, not a
field in a schema.

### 2. `.craidd` — folder classification cache

A marker stays small. This example includes an optional config facet:

+++
[project]
name = "src-tauri"
language = "rust"
root = "."

[config]
name = "src-tauri (Config)"
enabled = true
+++

**What it holds:** only what is *intrinsic to the folder itself*.

- `name` — the folder's declared name (usually the folder name).
- `language` — the language (not inferrable from `.tsx` alone,
  not inferrable from `.h` alone, so it must be declared).
- `root` — usually `.`, only non-default when the user deliberately
  points a project at a subfolder of itself.
- `[config]` — whether this folder's config files are treated as a
  config facet. Presence of `[config]` = yes. Absence = no.

**What it does NOT hold:**

- No `kind`. Library/application/test is *relational*, not intrinsic.
- No `[toolchain]`. `Cargo.toml` already says Cargo.
- No `[[launch]]`. Launching is composition, which is `.cln`'s job.
- No `framework`. See the Tauri discussion above.
- No dependencies, no versions, no build commands.

**Why it exists at all:** as a *cache*. The IDE could infer language
from the manifest every scan, but `.craidd` states it once so scans
are cheap and language is never a guess. It travels with the folder.
It is the folder's self-classification, treated as ground truth.

**Why it is small:** because a marker should be a marker. Every field
we add here is a field that duplicates a manifest, and duplicated
truth is drift. The smaller `.craidd` becomes, the more it stays true.

### 3. `.cln` — solution composition

The solution file is where *relationships* live. What projects exist,
in what order they build, what role each plays, what runs when you
press F5.

+++
[solution]
name = "craidd-studio"
version = "1.0"

[[project]]
path = "src-tauri/src-tauri.craidd"
role = "application"

[[project]]
path = "src/src.craidd"
role = "application"

[[config]]
name = "Dev (Tauri)"
kind = "run"
default = true

[[config.step]]
project = "src-tauri/src-tauri.craidd"
action = "run"
command = "cargo tauri dev"
+++

**What it holds:**

- Which projects are in this solution (`[[project]]`), their `path`,
  and their `role` (`application` / `library` / `test`).
- Named configurations (`[[config]]`) with `kind`
  (`run` / `debug` / `build`) and a `default = true` marker.
- Ordered steps inside each configuration (`[[config.step]]`),
  each pointing at a project and naming an `action`.
- Optional command overrides for steps (`command = "cargo tauri dev"`).
- Artifact operations (`action = "install"` with `into = "..."`).
- Future: startup project, build order, environment variables,
  pre/post steps.

**What it does NOT hold:**

- No language. That is `.craidd`'s declaration.
- No project name. That is `.craidd`'s declaration (cached from folder).
- No manifest contents. Those are the ecosystem's.

**Why it exists:** because composition is a distinct kind of truth.
A Rust library does not know it is consumed by a C# application.
A Node frontend does not know it is bundled into a Tauri shell.
The projects stay independent; the solution declares the relationship.
This is the only place relationships live.

---

## The rules, distilled

Three sentences cover every decision:

1. **If it can be read from a manifest, we read it — we never store it.**
2. **If it is true of the folder alone, it goes in `.craidd`.**
3. **If it is true only because of the solution, it goes in `.cln`.**

Consequences of applying these rules:

| Fact | Layer | Reason |
|---|---|---|
| Language | `.craidd` | Intrinsic; not always inferrable from files |
| Name | `.craidd` | Intrinsic; folder's declared name |
| Root | `.craidd` | Intrinsic; usually `.` |
| Config presence | `.craidd` | Intrinsic; folder has config files or not |
| Role (library/application/test) | `.cln` | Relational; the same folder can be a library in one solution and an application in another |
| Build order | `.cln` | Relational |
| Startup project | `.cln` | Relational |
| What command runs when you press F5 | `.cln` | Relational; and it can override the manifest's default |
| Whether Cargo or npm is the toolchain | **Neither** | Manifest on disk |
| Which subcommands the toolchain exposes | **Neither** | Manifest on disk |
| Framework identity ("Tauri") | **Neither** | Encoded in `.cln` as a literal command string |

The bottom three rows are the important ones. They are where earlier
drafts of this model went wrong. They are where the temptation to
add `[toolchain]` to `.craidd` will return. They are wrong.

---

## Worked example: the Tauri polyglot case

The case that most clearly demonstrates the model.

**On disk:**

+++
src-tauri/
  Cargo.toml
  tauri.conf.json

src/
  package.json
  vite.config.ts
+++

**Declared (`src-tauri/src-tauri.craidd`):**

+++
[project]
name = "src-tauri"
language = "rust"
root = "."
+++

**Declared (`src/src.craidd`):**

+++
[project]
name = "src"
language = "typescript"
root = "."
+++

**Composed (`studio.cln`):**

+++
[solution]
name = "craidd-studio"
version = "1.0"

[[project]]
path = "src-tauri/src-tauri.craidd"
role = "application"

[[project]]
path = "src/src.craidd"
role = "application"

[[config]]
name = "Dev (Tauri)"
kind = "run"
default = true

[[config.step]]
project = "src-tauri/src-tauri.craidd"
action = "run"
command = "cargo tauri dev"

[[config]]
name = "Release"
kind = "build"
default = true

[[config.step]]
project = "src/src.craidd"
action = "build"
# no command → the IDE reads src/package.json and uses scripts.build

[[config.step]]
project = "src-tauri/src-tauri.craidd"
action = "build"
command = "cargo tauri build"
+++

**Observations:**

- Neither `.craidd` mentions Tauri.
- Neither `.craidd` mentions npm or Cargo.
- The word "Tauri" appears exactly once, as a string inside a command
  override in `.cln`. That is correct. It is not a schema concept.
- The Vite build step has no `command`, so the IDE reads
  `src/package.json` and invokes `scripts.build`. Inferred, not stored.
- The Tauri dev step has a `command`, so it overrides the inferred
  default. Explicit wins; inference is the fallback.

---

## Worked example: C# application + C++ library

The case that most clearly justifies `role` living in `.cln`.

**On disk:**

+++
native/
  CMakeLists.txt
  src/foo.cpp

app/
  App.csproj
  Program.cs
+++

**Declared (`native/native.craidd`):**

+++
[project]
name = "native"
language = "cpp"
root = "."
+++

**Declared (`app/app.craidd`):**

+++
[project]
name = "app"
language = "csharp"
root = "."
+++

**Composed (`studio.cln`):**

+++
[solution]
name = "pipeline"
version = "1.0"

[[project]]
path = "native/native.craidd"
role = "library"

[[project]]
path = "app/app.craidd"
role = "application"

[[config]]
name = "Main Build"
kind = "run"
default = true

[[config.step]]
project = "native/native.craidd"
action = "build"

[[config.step]]
project = "native/native.craidd"
action = "install"
into = "app/bin/Debug/net8.0"

[[config.step]]
project = "app/app.craidd"
action = "run"
+++

**Observations:**

- `native` is a `library` **here**. In another solution, if `foo` has
  its own `main`, it could be an `application`. Same folder, different
  roles. That is why `role` cannot be in `.craidd`.
- The `.so` / `.dll` copy is an `action = "install"` step. It exists
  because the *solution* knows these two projects belong together.
  Neither `.craidd` knows. Correct.
- The C# run step has no `command`, so the IDE reads `App.csproj`
  and runs `dotnet run`. Inferred, not stored.

---

## What this model replaces

### `.cln` `[[build]]` (Phase 2.0–2.1)

The current reader and writer still support:

+++
[[build]]
target = "src-tauri/src-tauri.craidd"
method = "cargo"
command = "cargo build"
cwd = "."
+++

The target design replaces this with `[[config]]` / `[[config.step]]`.
Reasons:

- `[[build]]` only models build, not run or debug. Three toolbar
  buttons deserve three configuration kinds, not one.
- `method` duplicates the manifest's identity. The manifest already
  says Cargo. It never needed to be repeated.
- There was no way to compose multiple projects in one action.

Current code parses `[[build]]` into a separate build list and writes it
back when that list is nonempty. Converting existing entries to the
target configuration schema remains future migration work.

### `.craidd` `[project] kind` (Phase 2.0–2.1)

Current code reads `kind`, writes it for non-application projects, and
uses it for behavior such as library selection. In the target model:

- Removed from `.craidd`.
- Renamed `role`, moved to `.cln`'s `[[project]]` tables.
- Old `.craidd` files with `kind` need backward-compatible handling;
  the solution's role will take precedence after the migration.

This is a future migration, not a free cleanup of unused data.

---

## What this model does NOT change

- **Boundary rule.** A subfolder with its own `.craidd` stops the
  parent's language-tree walk. Unchanged.
- **Interop extensions.** TS↔JS, C#↔C/C++, Python↔C. Unchanged.
- **Config as a facet.** `[config]` remains a section inside
  `.craidd`, not a separate project. Unchanged.
- **File Discovery vs Solution Explorer duality.** Raw disk view vs
  declared view. Unchanged.
- **Ancestor detection, heal-on-load, placeholder handling.**
  Unchanged.

This document refines two things: what `.craidd` holds, and what
`.cln` holds. Everything else stands.

---

## The horizon: `.craidd` as optional

A future simplification is possible, noted here so the direction is
on record but **not committed**:

Because language is *usually* inferrable from the manifest
(`Cargo.toml` → rust, `*.csproj` → csharp), `.craidd` could become
optional and rare. In that model:

- Being listed in `.cln`'s `[[project]]` array makes a folder a project.
- Language is inferred from the manifest when possible, declared in
  `.cln` when not.
- `.craidd` only exists for folders whose language cannot be inferred
  (a folder of `.tsx` files with no `package.json`, a folder of `.h`
  files with no build system).

This would make the common case one file (`.cln`). It would also
require the boundary rule to read from `.cln` instead of `.craidd`,
and a language-inference table to exist.

It is a **Phase 3.x** possibility. It is not a Phase 2.x change.
`.craidd` remains the primary classification cache for now. The
direction is noted because it is coherent — but it is not urgent, and
rushing it would be the kind of foundation-cracking change this
document exists to prevent.

---

### The marker earns its keep today

`.craidd` is a tool, not a tenet. It exists today because it makes three
real things work:

1. **A project travels with its folder.** Copy `src-tauri/` out of a
   solution and it still knows it's Rust.
2. **A solution can reference a project by path.** The project doesn't
   need to know about the solution.
3. **A user can save a project folder and drop it into a new solution.**

None of those are guaranteed by folder names or file extensions alone.
So the marker earns its keep — now.

When inference is good enough — when "Make This a Project" can read
`Cargo.toml`, `package.json`, `CMakeLists.txt`, `*.csproj`,
`pyproject.toml` and *know* with confidence what a folder is, and when a
folder can carry its project identity in some other way that travels —
the marker becomes opt-in. Some users will want it (portability,
self-describing folders). Some won't.

Until then, we make the marker model correct, not minimal.

## Live ownership

**One folder may host multiple projects, provided each declares a different
language.**

This is a filesystem-level rule. It applies to the markers themselves, not to
which ones are declared in a solution. Two `.craidd` files in one folder
declaring the same language is a conflict, full stop.

**Live vs stale.** A project is *live* when its `.craidd` exists on disk. A
project is *stale* when its `.craidd` is missing. Stale projects do not claim
their folder's language; a live project does.

**The invariant.** Before any operation writes a marker into a folder:

- Same folder + same language + the other declaration is live → refuse.
- Same folder + same language + the other declaration is stale → allowed.
- Same folder + different language → allowed.
- Different folder → allowed.

**Where it is enforced.** Every entry point: redeclare (Option 1), repoint
(Option 2), move (Option 3), heal, marker-drop. One rule, one check, applied
everywhere.

**Resolution.** When two markers of the same language are found in one
folder (regardless of how they got there), the user picks one. Both markers
are deleted; a fresh one is written. No inheritance, no incremental fixes.

**Why strict.** User mistakes — bad `.gitignore` copy-paste, folders dragged
between projects, accidental duplicate declarations — become visible refusals
the IDE can resolve, instead of silent corruption the user discovers later.

## Summary

Three layers. Three kinds of truth. No duplication.

- **Manifests** — what an ecosystem says about itself.
- **`.craidd`** — what a folder is, intrinsically, with optional facets.
- **`.cln`** — how projects relate. Composition, ordering, roles.

When in doubt, ask: *Is this true of the folder, or true of the
solution?* Folder → `.craidd`. Solution → `.cln`. Manifest → read it,
don't store it.

---

*Last updated: Phase 3.x, 7 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
