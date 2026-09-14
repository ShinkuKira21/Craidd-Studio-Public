# Philosophy: Tool Discovery

**Status:** Locked.
**Scope:** How Craidd relates to the tools on the user's machine.
**Governs:** Phase 2.5 (discovery), Phase 3 (LSP, DAP, build).

---

## The thesis

**Craidd owns no tools.**

Craidd does not bundle a compiler, a runtime, a package manager, or a
language server. It discovers what the user already has, records the
answer, and orchestrates those tools exactly as a terminal would.

This is not a limitation. It is the design.

---

## Why

Every IDE that bundles its toolchain pays for it three times:

1. **Install size.** Visual Studio ships gigabytes before you open a
   project. Rider ships a JVM and eats 1.5 GB before your code loads.

2. **Drift.** The bundled toolchain and the system toolchain move apart
   the moment either is updated. The user's `cargo` and the IDE's
   `cargo` become different programs with the same name.

3. **Platform lock.** A bundled toolchain ties the IDE to the platforms
   the bundle targets. This is why Visual Studio is not a Linux product.
   Not because Microsoft can't port it, but because the installer model
   doesn't survive the port.

Craidd inverts all three:

- **Small.** A Tauri app over a React shell. Startup under a second.
- **In sync.** Craidd runs the user's `cargo`, the user's `dotnet`, the
  user's `clang`. Always. When the user updates the tool, Craidd sees
  the update. There is no second copy.
- **Linux-native.** Tools belong to the system. The IDE orchestrates,
  it does not own.

---

## The three-file model

Three files govern Craidd. Three scopes. Three concerns.

| File | Scope | Contains | Portable? |
|---|---|---|---|
| `.craidd` | Project | Identity — what this project *is* | Yes |
| `.cln` | Solution | Orchestration — how it runs | Yes |
| `~/.craidd-studio/user_preferences.toml` | Machine | Toolchain facts | No |

**The rule:** a project fact goes in `.craidd`. A solution fact goes in
`.cln`. A machine fact goes in preferences. Never ambiguous.

This document is about the third file. `.craidd` and `.cln` have their
own documents.

---

## What lives in preferences

Facts about *this machine*. Not facts about projects.

- **Toolchain locations.** Where `cargo` is, where `dotnet` is, where
  `g++` is. Discovered, not authored.
- **Toolchain versions.** What version each tool reports.
- **User overrides.** "Use `pnpm` for Node on this machine, not `npm`."
  Recorded once, applied everywhere.

Nothing else. Preferences does not contain project names, build
commands, debug configurations, or anything that belongs to a
`.craidd` or `.cln`.

### Shape

    [toolchains.rust]
    sdk = "cargo"
    path = "/usr/bin/cargo"
    version = "1.75.0"
    discovered_at = 1726238400

    [toolchains.csharp]
    sdk = "dotnet"
    path = "/usr/bin/dotnet"
    version = "8.0.404"
    available = ["6.0.412", "7.0.410", "8.0.404"]
    discovered_at = 1726238400

    [toolchains.cpp]
    compiler = "g++"
    path = "/usr/bin/g++"
    version = "13.2.0"
    build_system = "cmake"
    build_system_path = "/usr/bin/cmake"
    build_system_version = "3.28.3"
    discovered_at = 1726238400

One entry per language. Written once, read on every relevant action,
updated only on explicit refresh or failed invocation.

---

## When discovery runs

**Discovery runs exactly once per language, at first use. Never at
app launch. Never at solution open.**

"First use" means one of:

1. **Project creation.** The first time the user creates or declares a
   project in that language. Discovery runs in the background. The
   dialog closes immediately. A banner appears when discovery finishes.
2. **First invocation.** The first time the user tries to build, run,
   or debug a project in a language whose toolchain isn't cached.
   Discovery runs synchronously — because we need the result to
   invoke — takes roughly 300ms, and the result is cached.

Re-probe only happens when:

- The user clicks **Re-discover** in preferences.
- An invocation fails with "not found" (stale path — the tool moved or
  was uninstalled).
- The user clicks **Refresh toolchain** on the project's context menu.

Three triggers, all explicit. No ambient re-probing.

### Why this ordering matters

Startup speed is the whole point of the architecture. If Craidd probed
every toolchain on launch, a solution with Rust, C++, C#, and
TypeScript would spend 1-2 seconds before the UI painted.

Instead:

- App launch: 0ms spent on discovery.
- Open solution: 0ms spent on discovery.
- Create a project: discovery for that one language, in the background,
  never blocking.
- Second project in the same language, same session: 0ms — cached.
- Next session: read from preferences. 0ms.

The latency budget is spent exactly once per language, ever, at the
moment the user's action justifies it.

---

## The banner

When discovery completes in the background, a non-modal banner appears
in the corner of the main panel:

    Toolchain detected for C#:  dotnet 8.0.404  ·  [ View ]

On failure:

    dotnet is not installed. C# projects will not build or run
    until it is.  ·  [ Help ]   [ Dismiss ]

**View** opens the toolchain preferences panel, scrolled to that
language.

**Help** opens a small panel that explains what to install and how, for
the user's distro family, with a copy button. Craidd never runs the
install.

The banner is dismissible. It fades after a while. It never blocks.

---

## Missing tools

When Craidd needs a tool that isn't installed, it does three things,
in order:

1. **Says what's missing.** Not "build failed." "cargo is not
   installed."
2. **Suggests an install command** for the user's distro family, with
   a copy button.
3. **Offers a terminal** opened in the right place.

It does not install. Ever. Not on first launch, not on missing-tool
detection, not "just for convenience." A user's package manager
belongs to them. An IDE that installs packages is an IDE that can
break a distro.

The distinction: **Craidd suggests, the user acts.**

### The failure mode we avoid

We could know that the user is on Debian, that `apt` is present, and
that `apt install rustup` would work. We do not run it. We show it.

If Craidd were to install tools:

- A wrong package selection could break the user's environment.
- The user would have no record of what changed.
- The IDE and the user would be in conflict over the machine.

None of that. The IDE owns nothing, including the act of installing.

---

## Transparency

Every tool invocation is logged. In the Output panel, before any
output:

    [14:32:07] Running build for project "Tauri V2" (rust)
    [14:32:07] $ cargo build --release
    [14:32:07] cwd: /path/to/src-tauri
    [14:32:07] env: CARGO_TARGET_DIR=/path/to/target
    [14:32:08] <build output>

Three rules:

1. **The exact command is shown.** Not a summary. The string Craidd
   passed to the shell.
2. **The exact cwd is shown.**
3. **The exact environment is shown.**

This is VS Code's principle. It is the single biggest difference
between a magic IDE and an honest one. It costs nothing, and it
prevents entire classes of "why did that happen."

### What Craidd never does

- **Never rewrites the user's command.** If the command is wrong, the
  user fixes it.
- **Never runs a command the user didn't see.** Every invocation is
  logged first, then run.
- **Never hides output.** If the build fails, the raw error is visible
  alongside any Craidd-formatted summary.

---

## The "Auto Detect" button

The toolchain preferences panel has an **Auto Detect** button per
language. It runs discovery again, synchronously, and shows the result
inline.

This is for the user who wants to know what Craidd thinks, or who just
installed a new SDK and wants Craidd to notice without waiting for a
failure.

It is not the default path. The default path is: Craidd discovers when
it needs to, caches, and moves on. The button exists so the user has a
handle, not because the user has to use it.

---

## What discovery knows, and what it doesn't

Discovery knows **presence**: which of `cargo`, `dotnet`, `g++`,
`cmake` are on `PATH`, and what version each reports.

Discovery does **not** know:

- Which package manager installed the tool.
- Which distro the user is on. It can detect this, but it does not act
  on it.
- Whether the tool is up to date.
- Whether the user wants to use a different version.

Those are the user's concerns. Discovery is a fact-finder, not an
advisor.

---

## What this buys us

- **Startup under a second.** No tools loaded, no daemons, no probes.
  The IDE is a React app over a Tauri shell. It opens at Vite speed.
- **Zero system risk.** Craidd never modifies the user's machine. It
  cannot break a distro.
- **Works on any Linux.** Ubuntu, Fedora, Arch, Alpine, NixOS — as long
  as the tools are on `PATH`, Craidd works. No install matrix to
  maintain.
- **Drift-free.** The tools Craidd runs are the same tools the user
  runs in their terminal. Always.
- **The user stays in control.** Which tools, which versions, which
  package manager. All the user's choices, not Craidd's.

---

## What this costs us

- **Setup friction.** A user on a fresh machine has to install their
  toolchain before Craidd can build anything. Visual Studio would have
  installed it for them. We don't. The mitigation is the missing-tool
  UX: Craidd tells the user exactly what to install and offers a copy
  button. The path from "missing tool" to "working build" is short and
  clear. It just isn't automatic.
- **No bundled fallback.** If the user doesn't have `cargo` and doesn't
  want to install it, Craidd can't build their Rust project. That is
  correct behavior. The alternative — bundling — is the thing we
  rejected at the top.

Both costs are accepted. The philosophy is worth them.

---

## Out of scope, deliberately

- **User-authored detection rules.**
- **User-authored toolchain commands.**
- **A `.vscode/`-style config directory.**
- **Bundled toolchains.**
- **Automatic installs.**

Craidd supports a defined set of languages and frameworks. Discovery
and delegation are the mechanism. Everything outside that set is out
of scope, not "coming soon." A user with a stack outside this set is a
VS Code user, and that is fine.

If we ever revisit this: revisit it after the supported set works end
to end with LSP, build, and debug. Not before.

---

*Last updated: Phase 2.1.4. Author: skira24.*
*This file is a philosophy. It changes only by rewriting it.*
