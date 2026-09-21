# Philosophy: Tool Discovery

**Status:** Design. Not yet implemented.
**Applies to:** Phase 2.2b onward (discovery), Phase 3+ (build, run, debug).
**Governs:** How Craidd relates to the tools on the user's machine.

---

## The thesis

**Craidd owns no tools.**

Craidd does not bundle a compiler. It does not bundle a package manager. It
does not bundle a runtime. It does not install anything, ever. Every tool
Craidd uses — `cargo`, `dotnet`, `node`, `pnpm`, `clang`, `lldb`, `pyright`,
`debugpy` — is a tool the user already has on their machine, or a tool the
user must install themselves.

Craidd discovers these tools. It records what it found. It delegates to them.
When they are missing, Craidd says so, explains how to install them when it
knows how, and gets out of the way.

This is the entire relationship. Nothing more.

---

## Why

### 1. Because tools belong to the user

A Linux developer installs `rustup`, or `node` via `nvm`, or `dotnet` via
their distro's package manager, or a preview SDK via Microsoft's own
installer. These choices are theirs. Their paths, their versions, their
alternatives systems (`update-alternatives`, `nvm`, `rustup toolchain`) are
theirs. Craidd has no business shadowing any of it.

### 2. Because bundling tools is a treadmill we cannot win

Visual Studio bundles everything, and reinstalling it reinstalls the world.
Rider bundles a JVM and a runtime and a C# toolchain, and every version
drift between bundled and system becomes a support burden. Every IDE that
bundles tools eventually fights the user's system.

Craidd does not fight. It reads.

### 3. Because bundling tools breaks startup

Loading a bundled toolchain means initializing a process, a runtime, a
heap. That is hundreds of milliseconds before a window paints. Craidd
launches in under a second because it launches nothing. Tools load when
invoked, on demand, exactly the way a terminal does.

### 4. Because the user is not a child

The user has a shell. They have `sudo`. They have a package manager and
opinions about it. Craidd suggesting an install and letting the user decide
is respect. Craidd running an install "for convenience" is not.

---

## Detect all, let the user choose

For each language, Craidd probes the machine for **every tool that could
be relevant**, records all of them, and picks a sensible default. The
user can see what was found, change the default globally, and — per
project — override it.

This is the whole model. It is simple, it is honest, and it costs almost
nothing.

### What Craidd probes, per language

**Rust:**
- `cargo`, `rustc`, `rustup`
- Detected with `which` + `--version`.

**C#:**
- `dotnet`
- Detected with `which` + `--version` + `--list-sdks` (to see which SDK
  versions are installed).

**Node / TypeScript / JavaScript:**
- `node` (runtime)
- `pnpm`, `yarn`, `npm` (package managers — record *every one present*)
- Detected with `which` + `--version` for each.

**C / C++:**
- Compilers: `g++`, `clang++`
- Build systems: `cmake`, `ninja`, `make`
- Detected with `which` + `--version` for each.

**Python:**
- `python3` (interpreter)
- `pip`, `uv`, `poetry`, `pdm` (package managers — record *every one
  present*)

**Config:**
- No tools. Nothing to probe.

That is the whole discovery surface. Nothing else runs. Nothing else is
recorded.

### How the default is picked

Fixed priority order per language. Visible in the preferences panel.
The user can change it.

- **Node package manager:** `pnpm` → `yarn` → `npm`.
- **C++ build system:** `cmake` → `make`.
- **C++ compiler:** `g++` → `clang++`.
- **Python package manager:** `uv` → `poetry` → `pdm` → `pip`.
- **Rust:** only `cargo`.
- **C#:** only `dotnet`.

These priorities reflect the modern, safer, faster choice first. They are
defaults, not policy. The user overrides them and Craidd obeys.

### Two scopes, one discovery

Tool configuration lives in two places, scoped differently:

**Global (machine-wide)** — `File → Preferences → Toolchains`

- Lists **every language Craidd supports**. Always. Whether or not the
  user has that language installed.
- Each language shows what was found, or `Not yet scanned` if never
  probed, or `Not found` if probed and missing.
- Each language has a `Rescan my system` button. It re-runs discovery for
  that language and updates the record.
- Each language has dropdowns for choosing the default from what was
  found.
- This is the machine-level fallback. Applies to every project unless
  overridden.

**Per-project** — right-click a project → `Toolchain Configuration…`

- Scoped to one project in one solution.
- Shows the language the project declares.
- Shows the inheritance: `Global default: pnpm. Folder hint: yarn.
  Current: inheriting pnpm.` with a dropdown to override.
- Choosing an override writes to the `.cln`'s `[[project]]` table.
- The same `Rescan my system` button is present, for convenience. It
  updates the *machine-wide* record (discovery is always machine-scoped;
  there is only one record per language), which then feeds back into the
  picker.

**Both scopes share one discovery mechanism.** The only difference is
where the *choice* is stored — global in
`~/.craidd-studio/user_preferences.toml`, per-project in `.cln`.

### Where the pick lives

**Machine default** — in `~/.craidd-studio/user_preferences.toml`:

+++
[toolchains.node]
runtime = "node"
runtime_path = "/usr/bin/node"
runtime_version = "20.11.0"
package_managers_present = ["pnpm", "yarn", "npm"]
package_manager_default = "pnpm"
discovered_at = 1726238400

[toolchains.cpp]
compilers_present = ["g++", "clang++"]
compiler_default = "g++"
build_systems_present = ["cmake", "make"]
build_system_default = "cmake"
discovered_at = 1726238400
+++

This is written when discovery completes for a language. It is read on
every subsequent invocation. If the user changes a dropdown in global
preferences, this is what gets rewritten.

**Per-project override** — in `.cln`, in the project's table:

+++
[[project]]
path = "src/src.craidd"
role = "application"
package_manager = "yarn"
+++

The `.cln` value beats the machine default. It is only written when the
user explicitly overrides (via right-click → *Toolchain Configuration…* →
override). Absent = use the machine default. The `.craidd` is never
touched — it stays the six-line classification cache it always was.

### The folder as a hint, never a decision

A `yarn.lock` in a Node project folder is a **hint** that the project
probably wants yarn. A `Makefile` in a C++ folder is a hint. A
`poetry.lock` in a Python folder is a hint.

Craidd **displays** the hint in the project's Toolchain Configuration
dialog. It **never applies** the hint silently. The user's word always
wins; the hint only fills in when the user has not spoken anywhere.

The resolution order, when Craidd needs to invoke a tool:

1. **Per-project override** (`.cln` `[[project]]` table).
2. **Machine default** (`~/.craidd-studio/user_preferences.toml`).
3. **Folder hint** (a lockfile or manifest present in the folder).
4. **First available** in the language's priority order.
5. **Nothing.** Craidd reports no tool available and shows install
   guidance.

Layers 1 and 2 cover 99% of cases. Layer 3 exists for the very first use
of a project with no preference set, and is only reached when neither 1
nor 2 has been spoken. Layer 4 is the final fallback.

### Re-scanning

The user can trigger discovery at any time:

- **`File → Preferences → Toolchains → <language> → Rescan my system`.**
  Re-probes that one language, updates the machine record.
- **Right-click project → `Toolchain Configuration…` → Rescan my
  system`.** Same effect — updates the machine record — but reachable
  from the project context.
- **Failure-driven.** An invocation fails with `command not found`. The
  record for that tool is invalidated and re-probed on next use.

No ambient re-probing. No background watcher. No service.

---

## Compile targets are not toolchains

A toolchain question is: *which binary?* — `g++` or `clang++`, `pnpm`
or `yarn`.

A compile target question is: *which language standard?* — C++11 or
C++20, ES2015 or ES2022, Rust edition 2018 or 2021, Python 3.9 or
3.11.

These are orthogonal. A user may pick `g++` (toolchain) and C++11
(compile target) for a legacy project, and `clang++` and C++23 for a
new one, on the same machine, in the same session. Both are correct.

**Compile targets do not belong in tool preferences.** A machine-wide
"default C++ standard" is a footgun — the standard is a property of
the code, not the machine. Craidd does not offer one.

Compile targets resolve in this order:

1. **Explicit in `.cln`** — `[project.standard] cpp = "c++20"`.
2. **Read from the project's manifest** — `CMakeLists.txt`'s
   `CMAKE_CXX_STANDARD`, `Cargo.toml`'s `edition`, `tsconfig.json`'s
   `target`, `pyproject.toml`'s `requires-python`.
3. **The tool's own default** — for `g++`, whatever its built-in default
   is for the version installed.

Craidd never invents a standard. It passes `-std=c++20` when the user or
the manifest says so, and nothing when neither says so.

---

## Manifests are read, never written

Every ecosystem has its own manifest. `Cargo.toml`, `package.json`,
`*.csproj`, `CMakeLists.txt`, `pyproject.toml`, `Makefile`, `meson.build`.

Craidd reads them. Craidd never writes them. Craidd never mirrors their
contents into its own configuration files.

This is the rule that keeps Craidd a *polyglot* IDE rather than a
replacement for any single ecosystem's tooling. If Craidd mirrored CMake
into `.cln`, it would then have to mirror Cargo, dotnet, meson, and make
— each with their own quirks — and `.cln` would become a cache of every
build system's output, fighting each of them for truth.

The arrow is one-directional:

- CMake writes `CMakeLists.txt`. Craidd reads it.
- Cargo writes `Cargo.toml`. Craidd reads it.
- dotnet writes `.csproj`. Craidd reads it.
- Craidd writes `.craidd` and `.cln`. Nothing else does.

When a manifest and `.cln` disagree — for example, `.cln` says
`command = "g++ -std=c++11 ..."` but `CMakeLists.txt` declares
`CMAKE_CXX_STANDARD 20` — the explicit `.cln` command wins, because the
user typed it. Craidd does not silently reconcile the two. It runs what
the user asked and shows the result.

### Advanced project detection is out of scope

Craidd does not run CMake to read its generated build graph. Craidd does
not mirror CMake targets into `.cln` configurations. Craidd does not
attempt to understand the semantic structure of any project it did not
create.

This is a deliberate design boundary. Craidd is a polyglot IDE built by
a small team. It reads manifest files as text — a `CMAKE_CXX_STANDARD`
line is a line, a `scripts.dev` key is a key — and it never attempts to
be a build-system parser. That is CLion's job for CMake, Rider's job for
MSBuild, and neither scope serves a polyglot audience.

When the user wants Craidd to do something with a CMake project, the user
writes a `[[config.step]]` in `.cln` and names the command. Craidd runs
it. That is the whole interface.

---

## Where Craidd *does* generate

The read-only rule applies to manifests that already exist. It does not
apply to the moment of creation.

When the user creates a **new project** from Craidd — "New Rust
Application", "New CMake Library", "New CMake Application", "New Python
Package", "New TypeScript Library" — Craidd owns that moment entirely. It
generates the scaffold:

- The folder structure.
- The manifest file (`Cargo.toml`, `CMakeLists.txt`, `pyproject.toml`,
  `package.json`) with sensible defaults.
- The `.craidd` classification cache.
- A `[[project]]` entry in the solution's `.cln`.

This is where Craidd **dominates** over reading. We're not parsing someone
else's CMake; we're writing our own correct starting point. The user can
edit the manifest afterwards — Craidd will read whatever they produce —
but on day one, the project is right, because we made it right.

Two consequences:

1. **Templates are our territory.** A "New CMake Library" produces a
   `CMakeLists.txt` with `add_library()`, `CMAKE_CXX_STANDARD`, the
   right `target_include_directories`, and a `CMakePresets.json`. A
   "New CMake Application" produces `add_executable()` instead. These
   are correct scaffolds, not guesses.

2. **We never regenerate.** If the user edits `CMakeLists.txt` after
   creation, Craidd does not touch it again. It reads it. It never
   rewrites what the user has touched. Templates are one-shot at
   creation; after that, the folder belongs to the user and its
   ecosystem.

That is the line: **Craidd generates what it creates, and reads what it
didn't.**

---

## Discovery

### When discovery runs

**Once per language in the background when a project first needs it.**
Explicit rescans and a first-invocation fallback are also available.

1. **Project load or creation.** When a solution opens, or a project is
   created or declared, each project language without a cached scan is
   detected in a separate background task. The solution and project tree
   become usable immediately. A banner announces newly found toolchains or
   missing core tools and links to Toolchain Preferences.

2. **First invocation.** The first time a build, run, or debug action
   touches a language whose tools are not cached, discovery runs before
   launching the command. This also covers an action started before its
   background discovery completes.

3. **Explicit rescan.** The user clicks `Rescan my system` in either
   scope.

All three triggers write results to
`~/.craidd-studio/user_preferences.toml`. The background trigger skips
languages already scanned. An explicit rescan refreshes the cache.

Newly detected core toolchains show a blue notice that closes after a short
delay. Missing core tools show a red notice until the user dismisses it or
opens Toolchain Preferences. A missing Rust debug adapter is reported only
when a Rust debug configuration uses Cargo; this is separate from whether
the build toolchain is installed.


### When discovery does NOT run

- **On app launch.** Never. Zero cost.
- **On opening a solution.** Unscanned project languages are discovered in
  background tasks; opening the solution does not wait for them.
- **On expanding a project tree.** Never.
- **On switching between projects.** Never.

### What discovery actually does

For Rust: search for `cargo`, `rustc`, `rustup`, and `lldb-dap`, then
query versions for tools that are present. Cargo and rustc are the core
tools used for the missing-tool warning.

For C#: `which dotnet`, `dotnet --version`, `dotnet --list-sdks`. Two to
three shell calls. ~200–400ms.

For Node: `which node`, `node --version`, then `which pnpm`, `which yarn`,
`which npm`. Up to five shell calls. ~80ms.

For C/C++: `which g++`, `g++ --version`, `which clang++`, `clang++
--version`, `which cmake`, `cmake --version`, `which make`, `make
--version`, optionally `which ninja`, `ninja --version`. Up to ten shell
calls. ~150ms.

There is no daemon, watcher, or service. Craidd runs these commands on
background workers and reads their outputs. The editor remains usable
while the scans complete.

---

## When a tool is missing

Craidd shows the shell error, augmented with guidance when Craidd knows
how to help.

**Raw shell output is always shown.** If the user has a terminal open and
types `cargo build` and there is no cargo, they see:

+++
bash: cargo: command not found
+++

Craidd shows the same thing, plus, when it knows:

+++
cargo is not installed.

To install Rust and cargo on your system:
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

[ Copy to Clipboard ]   [ Open Terminal Here ]   [ Show Shell Error ]
+++

**Craidd never runs the install.** The user copies, or opens a terminal,
or ignores. All three are valid. Craidd does not take that decision from
them.

If Craidd does not know how to help on this user's distro, it shows only
the shell error. No guessing, no "maybe try apt-get" when the system is
Alpine. Honesty over helpfulness when the two conflict.

### The distro question

Craidd may detect the distro family (`apt`, `dnf`, `pacman`, `zypper`,
`apk`) by reading `/etc/os-release`. It uses this only to choose which
install command to *show*. It never runs any of them. Knowing is fine.
Acting is not.

Examples of what Craidd might show:

+++
# On a Debian/Ubuntu system
sudo apt install cargo

# On a Fedora system
sudo dnf install cargo

# On an Arch system
sudo pacman -S rust

# On an Alpine system
apk add cargo
+++

The right one is chosen from `/etc/os-release`. The others are never
shown. But the user still runs it themselves.

---

## Version minimums

**Craidd does not enforce version minimums.**

If a tool is present but too old for a task, the task fails, the shell
error is shown, and the user sees exactly what a terminal would show.
Craidd is not a version gatekeeper. It reports what it found, runs what
the user asked, and shows the outcome — success or failure — without
editorializing.

Same rule as everything else: report, don't hide; delegate, don't decide.

---

## The banner

When discovery completes, a small non-modal banner appears in the corner
of the main panel:

+++
Node toolchain detected:  node 20.11.0, pnpm, yarn, npm  ·  [ View ]
+++

Clicking **View** opens `File → Preferences → Toolchains → Node`, showing
the discovered tools, versions, and the current default package manager.

If discovery found nothing:

+++
No Node tooling found. JavaScript and TypeScript projects will not build
or run until node is installed.  ·  [ Help ]   [ Dismiss ]
+++

**Help** opens a small panel with install guidance, per the section above.

Both banners auto-fade after a while if not interacted with. Neither
blocks the user.

---

## The global preferences panel

`File → Preferences → Toolchains` — a list of **every language Craidd
supports**. Always. Not just the ones the user has.

+++
Rust
  Status:  cargo 1.75.0 at /usr/bin/cargo
  [ Rescan my system ]

C#
  Status:  Not yet scanned
  [ Rescan my system ]

TypeScript / JavaScript / Node
  Status:  node 20.11.0, package managers: pnpm, yarn, npm
  Default package manager:  [ pnpm ▾ ]
  [ Rescan my system ]

C / C++
  Status:  compilers: g++ 13.2.0, clang++ 17.0.6
           build systems: cmake 3.28.1, make 4.4.1
  Default compiler:      [ g++ ▾ ]
  Default build system:  [ cmake ▾ ]
  [ Rescan my system ]

Python
  Status:  Not yet scanned
  [ Rescan my system ]

Config
  No tools required.
+++

The dropdowns let the user pick from what was *actually found*. If the
user wants something Craidd didn't detect, they use **Choose Path…**,
which opens a file picker and stores whatever they choose.

**`Rescan my system`** re-runs discovery for that language. If the user
installed something new, it shows up. If a tool was removed, it's marked
missing. The user can re-run this any time.

**Nothing else is configurable.** No build commands. No run commands. No
toolchain strings. No project standards. Those belong to `.cln` (Phase
2.3) and to Craidd's own code.

---

## The per-project toolchain dialog

Right-click any project in Solution Explorer → `Toolchain Configuration…`
→ a dialog scoped to that project:

+++
Project:  src  (typescript)

Global default:  package manager = pnpm
Folder hint:     package manager = yarn  (yarn.lock present)

Current:         inheriting global default (pnpm)

  [ Inherit global default ]   [ Use: yarn ▾ ]

  [ Rescan my system ]   [ Cancel ]   [ Apply ]
+++

Three things this dialog is careful about:

1. **It shows the inheritance.** The user can see what the machine default
   is, what the folder suggests, and what the project is currently using.
   No surprises.

2. **The folder hint is displayed, never applied silently.** The user has
   to choose "Use: yarn" for the hint to take effect. Merely having a
   `yarn.lock` does not change behaviour.

3. **`Inherit global default` is the default state.** The project uses
   the machine default unless the user deliberately overrides.

Choosing an override writes to `.cln`'s `[[project]]` table:

+++
[[project]]
path = "src/src.craidd"
role = "application"
package_manager = "yarn"
+++

Choosing "Inherit global default" removes the override line. The `.craidd`
is never touched.

---

## What Craidd never does

- **Never installs.** No `apt install`, no `npm install -g`, no `rustup`,
  no installer script. Ever. Even if the user clicks a button that would
  obviously benefit from it.
- **Never bundles a runtime.** No hidden JVM. No embedded Node. No
  vendored dotnet.
- **Never rewrites commands.** If `.cln` says run `cargo build --release`,
  Craidd runs exactly that, in exactly the declared `cwd`, with exactly
  the declared environment. No "improvements." No substitutions.
- **Never hides the shell error.** Augment, yes. Replace, no. If Craidd's
  guidance doesn't apply, the user sees the raw error and figures it out —
  same as if they were in a terminal.
- **Never probes at launch.** No tool runs until the user's action
  requires it.
- **Never trusts a cached path blindly.** If an invocation fails, the
  cache is invalidated and re-probed on next use.
- **Never assumes a package manager.** It probes for all of them, records
  all of them, and lets the user choose. The default is a *suggestion*,
  not a decision.
- **Never lets the folder override the user.** A lockfile is a hint,
  displayed in the dialog, used only when neither a per-project override
  nor a machine default exists. The user's word always wins.
- **Never populates `.cln` from an ecosystem.** CMake, Cargo, dotnet,
  and every other build system are read. Their output is never written
  into Craidd's own configuration files.
- **Never touches `~/.bashrc`, `~/.zshrc`, `/etc/profile`, or any shell
  configuration.** Not once, not ever, for any reason.
- **Never enforces a version minimum.** Reports what it found. Runs what
  was asked. Shows the outcome.

---

## What this costs, and why it is worth it

**Cost 1 — Setup friction.** A user who installs Craidd on a fresh Linux
system and opens a Rust project will not have the Rust toolchain
installed. Craidd will say "cargo not found," and the user must install
it. This is real friction.

**Mitigation:** The banner, the install guidance, the "Open Terminal
Here" button, the `Rescan my system` button that makes new tools appear
without an app restart, and the fact that any Linux developer who opens a
Rust project almost certainly has Rust installed. The friction exists
mostly on fresh systems and mostly resolves itself the first time the
user tries to build.

**Cost 2 — No "it just works."** Visual Studio installs a .NET SDK when
you install Visual Studio. If you install Craidd and expect .NET to work,
it won't, unless you already have it.

**Mitigation:** This is a *feature* for the audience Craidd serves. A
polyglot developer with three or four toolchains already configured does
not want an IDE that installs its own shadow copies. They want an IDE
that uses their tools. Craidd does.

**Cost 3 — Less control over the environment.** Craidd cannot optimize
the toolchain. It cannot ship a patched compiler, or a specific version
guaranteed to work with its own code. It lives with whatever the user has.

**Mitigation:** This is also a feature. The alternative is an IDE that
breaks when the user upgrades a tool, or that refuses to use a preview
SDK the user needs. Craidd tries what the user has, and reports the
version, and trusts the user.

The costs are the price of the philosophy. We pay them.

---

## What this buys us

- **Startup speed.** Nothing launches until the user's action requires
  it. The IDE opens at the speed of the UI, not the speed of a toolchain.
- **No install footprint.** Craidd is the size of its own binary. No
  bundled runtimes, no vendored tools, no multi-gigabyte installer.
- **Works on any Linux.** Debian, Fedora, Arch, Alpine, NixOS, whatever.
  Craidd reads what is present and does not assume a package manager, an
  init system, or a directory layout.
- **No version treadmill.** When the user updates Rust, Craidd sees the
  new version on next discovery. No update cycle, no coordination, no
  "please update to support the new compiler."
- **No security surface.** Craidd does not download tools. It does not
  execute installers. It runs what the user has, exactly as the user's
  shell would run it.
- **Composability.** Every tool Craidd uses is a tool the user can use
  from a terminal, in their own scripts, in their own CI. Craidd does not
  invent a parallel world. It orchestrates the existing one.
- **No restart needed.** New tools appear the moment the user rescans.
  Changed compilers appear the same way. The IDE never has to be
  restarted to see a new toolchain.
- **Correct starting points.** When Craidd creates a project, the
  scaffold is right — because we wrote it. The user starts from a
  working state and edits from there. This is where Craidd has an
  advantage over reading someone else's build.

---

## The one rule that governs everything

> **Craidd does not own tools. Craidd discovers them, records them, and
> delegates to them. When they are missing, Craidd says so and gets out
> of the way. Craidd never installs, never bundles, never rewrites, never
> hides.**

Everything in this document is a consequence of that rule.

---

*Last updated: Phase 2.2. Author: skira24.*
*This document is a philosophy. It governs the phases that follow it.*
