# Philosophy: Tool Discovery

**Status:** Design. Not yet implemented.
**Applies to:** Phase 2.5 onward (discovery), Phase 3+ (build, run, debug).
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
When they are missing, Craidd says so, explains how to install them if it
knows, and gets out of the way.

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

## What Craidd knows about a tool

For every tool Craidd uses, it records exactly:

+++toml
[toolchains.rust]
sdk = "cargo"
path = "/usr/bin/cargo"
version = "1.75.0"
discovered_at = 1726238400
+++

Four fields. Nothing more.

- **sdk** — the tool's identifier in Craidd's vocabulary (`cargo`, `dotnet`,
  `node`, `clang`). Not the path. Not the command. Just the name.
- **path** — the absolute path Craidd will invoke, if it invokes directly.
  Some tools are shell commands (`cargo`) where `which` gives a path.
  Some tools are always invoked via a runner (`dotnet`, `npm`) where the
  runner is the "path" and the sdk name is its identifier.
- **version** — the version string the tool reports. Recorded, displayed,
  not compared. Craidd does not refuse to work because the version is
  "unsupported." It reports what it found.
- **discovered_at** — a Unix timestamp. For display. Not for logic.

Craidd never invents values. Everything in this record was read from the
machine.

---

## Discovery

### When discovery runs

**Exactly once per language, at first use.** Two triggers, no others.

1. **Project creation.** When the user creates a new project or declares
   an existing folder as a project, and the language is chosen, discovery
   runs for that language. **In the background.** The dialog closes
   immediately; the tree appears immediately; a small banner appears when
   discovery completes.

2. **First invocation.** The first time a build, run, or debug action
   touches a language whose toolchain is not cached, discovery runs
   synchronously (300ms or less), then the action proceeds.

Both triggers write to `~/.craidd-studio/user_preferences.toml`. Both are
**one-time, ever, per language, per machine.**

### When discovery does NOT run

- **On app launch.** Never. Zero cost.
- **On opening a solution.** Never. Opening a solution is instant, always.
- **On expanding a project tree.** Never.
- **On switching between projects.** Never.

### Re-discovery

Discovery re-runs only when explicitly requested:

- The user clicks **"Auto Detect"** in the toolchain preferences panel.
- An invocation fails with "command not found" or "no such file" — the
  tool has moved or been uninstalled. Craidd re-probes once and updates
  the record.
- The user clicks **"Refresh Toolchain"** on a project's context menu.

Three triggers, all explicit or failure-driven. No ambient re-probing.

### What discovery actually does

For Rust: `which cargo`, then `cargo --version`. Two shell calls. ~50ms.

For C#: `which dotnet`, then `dotnet --version`, then
`dotnet --list-sdks`. Two to three shell calls. ~200–400ms.

For Node: `which node`, `node --version`, then for package manager:
`which pnpm`, `which yarn`, `which npm` — first one present wins, or the
user's explicit preference. ~80ms.

These calls are synchronous, cheap, and total. There is no daemon, no
watcher, no service. Craidd runs a command and reads its output.

---

## Preference hierarchy

When Craidd needs to know which tool to use, it resolves in this order:

1. **Project override** (`.craidd` `[toolchain]` section — Phase 5+, not
   currently planned; reserved for cases where a project declares it needs
   a specific SDK version).
2. **Solution override** (`.cln` — Phase 3+, for build entries that name a
   specific SDK path).
3. **User preference** (`~/.craidd-studio/user_preferences.toml`).
4. **Auto-discovery** (run now, record result, use result).

Layers 3 and 4 cover 99% of cases. Layers 1 and 2 are for future edge
cases and are not implemented in the current phase.

**Only layer 3 is written by the user in normal use.** They open the
preferences panel, click a language, and either confirm what Craidd found
or change it. The change is written to layer 3. From then on, layer 3
wins.

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

To install Rust and cargo:
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

---

## The banner

When discovery completes, a small non-modal banner appears in the corner
of the main panel:

+++
Toolchain detected for C#:  dotnet 8.0.404  ·  [ View ]
+++

Clicking **View** opens `File → Preferences → Toolchains → C#`, showing
the discovered path, version, and available SDKs.

If discovery failed:

+++
dotnet is not installed. C# projects will not build or run until it is.
· [ Help ]   [ Dismiss ]
+++

**Help** opens a small panel with install guidance, per the section above.

Both banners auto-fade after a while if not interacted with. Neither
blocks the user.

---

## The preferences panel

`File → Preferences → Toolchains` — a list of languages. Clicking a
language shows:

+++
Rust

  SDK:      cargo
  Path:     /usr/bin/cargo
  Version:  1.75.0
  Detected: 2026-09-14 14:32

  [ Auto Detect ]   [ Choose Path… ]

C#

  SDK:      dotnet
  Path:     /usr/bin/dotnet
  Version:  8.0.404
  Available SDKs:  6.0.412, 7.0.410, 8.0.404
  Detected: 2026-09-14 14:33

  [ Auto Detect ]   [ Choose Path… ]
+++

**Auto Detect** re-runs discovery, shows what it found, lets the user
accept or reject.

**Choose Path…** opens a file picker. Whatever the user chooses becomes
the recorded path. Craidd uses it without further validation beyond "does
this file exist and is it executable."

**Nothing else is configurable.** No build commands. No run commands. No
toolchain strings. Those belong to `.cln` (Phase 3) and to Craidd's own
code.

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
- **Never assumes a package manager.** If the user has not chosen one,
  Craidd looks for `pnpm`, then `yarn`, then `npm`, in that order. If
  none is present, it says so.
- **Never touches `~/.bashrc`, `~/.zshrc`, `/etc/profile`, or any shell
  configuration.** Not once, not ever, for any reason.

---

## What this costs, and why it is worth it

**Cost 1 — Setup friction.** A user who installs Craidd on a fresh Linux
system and opens a Rust project will not have the Rust toolchain
installed. Craidd will say "cargo not found," and the user must install
it. This is real friction.

**Mitigation:** The banner, the install guidance, the "Open Terminal
Here" button, and the fact that any Linux developer who opens a Rust
project almost certainly has Rust installed. The friction exists mostly
on fresh systems and mostly resolves itself the first time the user tries
to build.

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

---

## The one rule that governs everything

> **Craidd does not own tools. Craidd discovers them, records them, and
> delegates to them. When they are missing, Craidd says so and gets out
> of the way. Craidd never installs, never bundles, never rewrites, never
> hides.**

Everything in this document is a consequence of that rule.

---

*Last updated: Phase 2.1.3. Author: skira24.*
*This document is a philosophy. It governs the phases that follow it.*
