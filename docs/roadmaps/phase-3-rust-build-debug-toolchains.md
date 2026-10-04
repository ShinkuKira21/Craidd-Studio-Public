# Phase 3 — Rust Build, Debug, and Toolchains

**Status:** Implementation plan. Review against the working app before coding.
**Date:** 2026-09-17.
**Goal:** Build and debug a declared Rust project from Craidd Studio, while establishing the global and per-project tool choices that later languages will share.

## Current baseline

- `File → Preferences…` exists, but contains editor controls only. `preferencesStore.ts` keeps those values in memory.
- The toolbar has Run, Debug, and step icons without actions. Output, Problems, Terminal, and the Debug sidebar are placeholders.
- `.cln` currently reads `[solution].projects`, `[[build]]`, `[run].default`, and `[debug].default`. The two older design documents show different future configuration shapes. Choose one canonical shape and migration before writing new configuration UI.
- The sample `workspaces/tauri-app` solution contains a Rust backend and a TypeScript frontend. It is the end-to-end test fixture.
- On this development machine, `cargo`, `rustc`, and `rustup` are found, while `lldb-dap` is not currently found on `PATH`. Build can be exercised now; a live debug session needs an installed adapter.

## Boundaries and storage

Follow `philosophy-tool-discovery.md`:

| Fact | Location |
| --- | --- |
| Tool paths, discovered versions, and machine defaults | `~/.craidd-studio/user_preferences.toml` |
| Project-specific tool overrides, selected default project, and named build/debug configurations | Solution `.cln` |
| Project language and file membership | `.craidd` |
| Package name, compiler options, and language standard already declared by the ecosystem | `Cargo.toml`, `CMakeLists.txt`, `package.json`, etc. |
| Breakpoints and transient debug session state | Craidd's local workspace state, outside `.cln` and `.craidd` |

The global path follows the existing philosophy document. `~/craidd-studio/user_preferences.toml` would create a second location, so this phase uses the hidden `~/.craidd-studio/` directory. The path should be shown in Preferences and errors. Write the file atomically and preserve unrelated settings on update.

Craidd discovers installed tools and delegates to them. It does not install or bundle compilers, package managers, or debug adapters. A project creation dialog may start a background scan for the selected language; it must not delay project creation.

## Tool discovery and Preferences

Extend **File → Preferences…** with **Editor** and **Toolchains** areas. Toolchains lists every supported language, including those never scanned. Each language shows `Not yet scanned`, `Not found`, or the installed tools with path and version. Each has **Rescan my system**. For each role, a dropdown lists discovered choices plus **Choose Path…** for a user-supplied executable. A missing executable must be shown with the original spawn error and available install guidance; it must not silently fall back to a different tool.

Use one native discovery service for both preference scopes. Probe the applicable language only:

| Language | Discoverable roles |
| --- | --- |
| Rust | `cargo`, `rustc`, `rustup`, and debug adapters such as `lldb-dap` |
| TypeScript / JavaScript | `node`; installed `pnpm`, `yarn`, `npm` |
| C / C++ | installed `g++`, `clang++`, `cmake`, `ninja`, `make` |
| C# | `dotnet` and installed SDKs |
| Python | `python3`; installed `uv`, `poetry`, `pdm`, `pip` |
| Config | no tool probe |

Rust Build and Debug use the Rust roles in this phase. The other language pages can detect and record tools, while build/debug adapters for those languages arrive later. Probe tool presence and version without starting a compiler or a language server. A GUI app may have a different `PATH` from a terminal: show the actual search result and allow **Choose Path…** rather than claiming that a tool is absent from the machine.

Discovery triggers are: after project creation or declaration (background, once for that language), first tool invocation when uncached, explicit rescan, and retry after a cached path fails. It does not run at application startup, solution open, or tree expansion. The global record is refreshed by either Preferences or a project-level rescan.

### Per-project tool choices

Add **Toolchain Configuration…** to a project's context menu. Show the declared language, the machine default, relevant folder hint, and effective choice. A role can **Inherit global default** or use an installed/custom executable. Save explicit overrides to the project entry in `.cln`. Rescan from this dialog refreshes machine discovery and the displayed effective choice; it does not change the project's explicit override.

Resolution order: explicit project override → explicit machine default → folder hint when neither was chosen → first available tool in the documented priority order → clear missing-tool state. A lockfile is a hint, never authority over a user choice.

**Language standards are separate.** C++17 or C++20 is a property of a project/build, not a machine-wide compiler choice. The project dialog may show the standard read from its manifest and offer an explicit `.cln` override. This phase establishes its data/UI placement; it does not add C++ build execution. The same rule applies to Rust edition: read `Cargo.toml`, do not copy it into tool preferences.

## Solution configuration and toolbar

Before implementing the dropdown, migrate from the current `[solution].projects` list to a canonical project entry format that can hold per-project overrides. Read existing `.cln` files without loss; only write the new format after an explicit edit. Preserve unknown tables and existing `[[build]]` entries. The schema migration needs round-trip tests, including the committed Tauri sample and an older solution. Do not keep two independently edited project lists.

Proposed extension, subject to a round-trip test before implementation:

+++toml
[solution]
name = "tauri-app"
default_project = "src-tauri/src-tauri.craidd"
default_build = "Rust Debug"

[[project]]
path = "src-tauri/src-tauri.craidd"
role = "application"
# Optional explicit override; absent means inherit machine default.
debug_adapter = "lldb-dap"

[[project]]
path = "src/src.craidd"
role = "application"
package_manager = "yarn"

[[build]]
name = "Rust Debug"
target = "src-tauri/src-tauri.craidd"
method = "cargo"
args = ["build", "--message-format=json-render-diagnostics"]
cwd = "src-tauri"
+++

Do not write machine-specific executable paths into a shared `.cln` when a tool name resolves through global preferences. An explicit project path override is allowed when the user chooses one, and should be visibly marked as machine-specific.

The toolbar gets two selectors: **Project** and **Build configuration**. Changing a selector affects the active session. **Set as default** explicitly writes the corresponding `.cln` field. The build selector filters or labels configurations by their target project; a missing or renamed target is shown as invalid rather than silently redirecting to another project. A solution with one Rust project may offer a clearly labelled temporary `Cargo Debug` configuration without rewriting `.cln` until the user saves it.

## Rust Build vertical slice

1. Resolve the selected `.cln` project to its `Cargo.toml` and working directory. Keep the chosen project and configuration visible in the toolbar and Output panel.
2. Resolve Cargo through the project/global discovery rules. If unavailable, show the exact failure and a path to Toolchain Preferences.
3. Spawn Cargo from the Rust backend with an executable path and argument array. Do not invoke a shell for ordinary build configurations. Stream stdout and stderr with a session ID, elapsed time, final exit code, and cancellation status.
4. Use Cargo's JSON messages for compiler diagnostics and `compiler-artifact.executable` for the debug target. Show readable compiler output in Output and link errors to files/lines in Problems. Never guess the executable from a package or folder name.
5. **Stop** cancels the active build and reaps its child process. A later build starts cleanly. Do not launch a second build for the same configuration while one is running.

First acceptance path: open `workspaces/tauri-app`, select its Rust backend and `Rust Debug`, build successfully, see the resulting artifact and any diagnostics, then edit a Rust file to produce an error and navigate to its source line. Test a failed build and a cancelled build too.

## Rust Debug vertical slice

The editor's **red dot** is a breakpoint marker in the gutter, distinct from the existing unsaved-file dot on a tab. Clicking toggles it without changing source text. Keep breakpoints locally per workspace; show pending versus adapter-verified state and the actual resolved line if the adapter moves one.

Debug first builds a debuggable Rust target using the chosen build configuration or a named debug build. Cargo's default `dev` profile has debug information, but project profiles may override it; report missing debug information rather than silently changing the project's manifest. If the build yields no executable target, explain that the selected package cannot be launched as a program.

Use a discovered, user-installed `lldb-dap` through a native DAP client. The minimum protocol slice is initialize, launch, setBreakpoints, configurationDone, continue/pause/step, stopped/continued, stackTrace, scopes, variables, disconnect, and terminated. Show adapter stdout/stderr and protocol errors in Output. Only enable step buttons during a stopped session. Stopping or closing the solution must end the adapter and launched process.

First debug acceptance path: set a gutter breakpoint in the Rust sample, start Debug, stop at that source line, inspect stack and variables, step and continue, then end without orphan processes. Exercise a missing adapter, rejected breakpoint, failed launch, and repeated session. ChromeOS/Penguin may impose debugger or process restrictions; test there explicitly rather than treating a Debian desktop pass as proof.

Frontend WebView debugging is a separate investigation. The older orchestration sketch assumes CDP attach, while Linux Tauri uses WebKitGTK. Do not make a Chrome DevTools Protocol implementation a prerequisite for this Rust milestone.

## ChromeOS performance check

The observed packaged `.deb` feeling faster than dev mode points to some dev overhead, but it does not identify the remaining Monaco or toolchain delay. Compare a release package on Debian/Penguin and Arch using the same workspace and file. Record launch time, folder-open time, keypress-to-paint latency in Monaco, toolbar response, build duration, CPU use, and memory. Also compare a workspace stored inside Penguin with one on a ChromeOS shared mount.

Tauri on Linux uses WebKitGTK; Electron uses Chromium. ChromeOS Linux apps run inside a VM/container. These differences make renderer, graphics, filesystem, and VM costs plausible explanations, but Tauri v2's age alone is not evidence of the cause. Separate UI rendering latency from Cargo compilation and disk I/O. Try any WebKit graphics workaround only after measuring it on the affected device, since a workaround can disable a faster rendering path elsewhere.

## Delivery order and gates

1. **Schema and persistence:** decide the canonical `.cln` form, add backward-compatible read/write and tests; persist global TOML preferences atomically.
2. **Discovery and UI:** File Preferences → Toolchains; project Toolchain Configuration; on-demand scans, rescan, inheritance, custom paths.
3. **Build UI and runner:** default project/build dropdowns; Cargo output, Problems, Stop, error and artifact handling.
4. **Breakpoints and DAP:** red gutter dots, Rust debug session, stack/variables, step/stop lifecycle.
5. **Platform validation:** Debian/Penguin and Arch release builds, installed tool lookup, repeatable ChromeOS performance measurements.

Each gate should leave a working app. Rust Build can ship before a debugger is installed; Debug cannot be called complete until a live `lldb-dap` session passes on a target system. Tool detection must report what it actually found and must never install a tool on the user's behalf.

## Deferred

TypeScript/WebKit frontend debugging, build/debug execution for other languages, an embedded terminal, full LSP support, complex multi-process orchestration, and plugin APIs follow this Rust slice. The shared toolchain model and process runner should accommodate them without launching their tools at startup.

## References

- Local design: `docs/philosophies/philosophy-tool-discovery.md`, `docs/craidd-cln-model.md`, `docs/feats/configurations/design-solution-orchestration.md`, `docs/future/future-ide-considerations.md`.
- [Cargo JSON messages and compiler artifacts](https://doc.rust-lang.org/cargo/reference/external-tools.html).
- [Cargo development and release profiles](https://doc.rust-lang.org/cargo/reference/profiles.html).
- [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) and [LLDB's `lldb-dap` guide](https://lldb.llvm.org/use/lldbdap.html).
- [Tauri's Linux WebView](https://v2.tauri.app/reference/webview-versions/), [Linux graphics guidance](https://v2.tauri.app/develop/debug/linux-graphics/), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), and [ChromeOS Linux environment](https://developers.google.com/chromeos/app-development/develop/web-environment).

+++
Last updated: Phase 3 planning, 2026-09-17. Author: skira24, with assistance.
This document is an implementation plan for review.
+++
