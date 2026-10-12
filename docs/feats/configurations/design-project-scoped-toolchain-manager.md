# Design: Project-scoped tool selection and optional downloads

**Roadmap track:** Later, unassigned toolchain work. This proposal does not
change the Phase 3.x debugger release gate. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal, 8 October 2026. Craidd has tool discovery, machine
defaults, and a per-project override editor; it has no tool download manager.
Per-project debugger overrides are persisted but are not yet used by debug
launch. No managed tool or exclusive-step behavior is accepted by this design.

**Companions:** [Project configurations and NuGet](design-project-configurations-and-nuget.md),
[the `.craidd`/`.cln` model](../../craidd-cln-model.md), and
[per-thread execution control](../mt-debugging/design-per-thread-execution-control.md).

## Decision

Craidd starts with the tools the user has installed. A project may choose a
specific installed compiler, SDK, runtime, build tool, or debugger without
changing the machine default or another project's choice. Later, an explicit
**Get tool** action may acquire a supported upstream release for this user and
associate it with a project. Opening a project, reading a manifest, rescanning
the machine, or pressing Debug never downloads a tool silently.

"Project-scoped" describes **which project uses a tool**. It does not require
placing executable binaries in the source tree. The proposed default is a
versioned, per-user managed-tools directory, with a project binding to the
selected version. Keep archives in a separate disposable download cache. On
Linux, follow the [XDG base-directory specification](https://specifications.freedesktop.org/basedir/0.8/)
and let users inspect and remove managed versions. A future explicit
workspace-local option needs its own portability and cleanup review.

NuGet package management remains a different feature: it changes a project's
package references and uses the installed .NET tooling. A debugger executable
or compiler is not treated as a NuGet project dependency merely because both
can be downloaded. Respect ecosystem mechanisms such as .NET `global.json`
for SDK selection and `.config/dotnet-tools.json` for actual .NET local tools;
do not duplicate their version truth in Craidd files.
[.NET SDK selection](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json),
[.NET local tools](https://learn.microsoft.com/en-us/dotnet/core/tools/local-tools-how-to-use).

## Current source and the first repair

- `src-tauri/src/commands/toolchain.rs` discovers a fixed role/name catalog,
  saves machine defaults in user preferences, and reads/writes per-project
  role paths in `.cln` `[[project]]` entries.
- `ToolchainConfigurationDialog.tsx` presents those per-project choices and a
  manual **Choose Path** action.
- `src-tauri/src/commands/debug.rs::adapter_path` currently resolves a
  language-wide debugger default or discovered executable. It does not read
  the per-project override. The editor therefore must not claim that choosing
  a project debugger changes the actual debug launch yet.

First make the existing selection effective and visible in the launch record:
project choice, resolved executable, version, and execution environment. Use
one resolution path for the displayed choice and the process actually started.
If an explicit choice is missing or incompatible, explain it and stop; do not
silently substitute another debugger. Keep the inherited machine/PATH behavior
for projects without an explicit choice.

The current `.cln` override is an absolute machine path, which is not portable
when a solution is shared. Before extending the format, decide how a portable
project intent (tool family/version or capability) maps to a machine-local
binding. Preserve existing `.cln` files and migrate only with an explicit
schema decision. Do not add `[toolchain]` to `.craidd`: that file is a folder
classification marker, not a tool installation manifest.

## Optional acquisition contract

Only offer a download for a tool with a maintained, platform-specific
acquisition recipe. Show the publisher, exact version, platform/architecture,
source URL, licence, expected size, and integrity evidence before the user
chooses **Get tool**. Prefer official release artifacts; verify a published
checksum or signature before use. If authenticity or platform support cannot
be established, offer manual path selection instead of a one-click install.

Download to a temporary location, verify, then install atomically into the
managed-tools directory. No `sudo`, system package-manager mutation, global
`PATH` edit, shell installer, or automatic switch of another project's tool.
Record the origin and version, show updates as an explicit choice, allow an
offline project to keep its current binding, and remove a version only when
no active project/session needs it. A failure leaves the previous selection
usable. Executables run with the user's privileges, so a download is a trust
decision, not a convenience click. [.NET tool trust guidance](https://learn.microsoft.com/en-us/dotnet/core/tools/global-tools).

The first catalog should be narrow and qualified by real build/debug tests.
Craidd does not offer a patched netcoredbg through a product download manager.
The source checkout contains a pinned Linux x64 experiment build, selected
explicitly through Toolchain preferences; it is not an app-bundled or managed
download. A user may also select a debugger they obtained themselves.
Exclusive Step still requires the separate adapter capability and behavioral
gates. CI conformance tests for an experimental build do not make it a
supported managed download.

## Environment boundary, including WSL2

A tool binding includes its execution environment, not just a file path. A
Linux debugger for a Linux process must run in the environment that owns that
process. On a future Windows-hosted Craidd using WSL2, discovery and managed
downloads would run **inside the chosen distribution**, with a transport that
starts the tool and carries DAP/output back to the IDE. Downloading a Linux
binary into a Windows project folder does not provide that transport or
cross-environment process control. Craidd is currently Linux-focused; WSL2 is
a future qualification track, not a capability granted by this manager.
[Microsoft WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl-interop).

## Delivery and acceptance order

1. Prove an existing per-project tool choice is the executable used by Build,
   Run, or Debug, with missing-path and inherited-default cases. Qualify each
   role separately; the current UI/storage is not proof of launch behavior.
2. Decide the portable project-intent versus machine-local binding format,
   including migration of today's absolute `.cln` paths.
3. Add one opt-in acquisition recipe and verify source, integrity, install,
   update, offline use, rollback, and removal on a real Linux machine. No
   project-open download and no new required debugger.
4. Broaden the catalog only with per-tool ownership and platform tests. Treat
   WSL2, other operating systems, and remote hosts as separate execution
   environments with their own acceptance records.

The manager is accepted only when the chosen project actually launches the
recorded tool and a failed acquisition leaves prior working tools intact. A
passing download test does not establish debugger capabilities or independent
thread stepping.

---

*Last updated: Proposal, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
