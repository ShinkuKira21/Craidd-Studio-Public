# Design: Project Tools and dependency workflows

**Status:** Proposed, 19 September 2026. Planning only; no UI or backend implementation in this document.
**Companions:** [Configuration megamenu](design-configuration-megamenu.md), [project configurations and NuGet](design-project-configurations-and-nuget.md), [tool discovery philosophy](../../philosophies/ide_editor/tool-discovery/philosophy-tool-discovery.md), [terminal design](../editor/design-terminal.md).

## Goal

Craidd should make a solution containing an ASP.NET API and a Tauri 2 app feel like one workspace while keeping each project's ecosystem intact. The toolbar configuration picker chooses the **default project and its action** for this window. The menu-bar label is **`{Project Name} Tools`**, derived from that default project. The menu, Command Palette, and Solution Explorer are three entrances to project actions.

This design covers *project dependencies*, such as NuGet packages and Cargo crates. It does not install an SDK, compiler, global package, or Linux system package. Every dependency operation is an explicit user action through the project's installed tool. This distinction needs to be recorded in [tool discovery philosophy](../../philosophies/ide_editor/tool-discovery/philosophy-tool-discovery.md) and the manifest ownership rules before implementation; their current absolute “never installs anything” wording also covers explicit project dependency operations.

## Progressive project understanding

Configuration is progressive. A newly declared project can start with only a name and language. When the user adds `Cargo.toml`, `package.json`, a `.csproj`, or an explicit configuration, Craidd learns another fact and adds the corresponding capability. A Tauri **solution best-fit suggestion** becomes recognisable when its Rust and frontend pieces are present. Removing a manifest removes that capability after a targeted refresh. The user should never need to complete a large configuration form just to see Project Tools.

Keep **observed facts** (manifests and available installed tools), **solution inference** (a best-fit label and the evidence behind it), and **user choices** (selected project/action and explicit defaults) distinct. Show only what is supported by the current facts, and let an explicit user choice override inference. The menu grows as the project grows; it does not list future features as disabled clutter.

## Picker, default project, and three entrances

These are different identities:

| Concept | Example | Meaning |
| --- | --- | --- |
| Solution best-fit label | `Tauri Dev` | A suggested grouping discovered from the solution. It is not a `.craidd` project name and is not the Project Tools title. |
| Default project in this window | `ASP.NET API`, `Desktop GUI`, or the project selected through `Tauri Dev` | Owns the toolbar's ordinary Build/Run/Debug context and names `{Project Name} Tools`. |
| Action/configuration | `dotnet run`, `dotnet build`, or a Tauri CLI launch | The concrete operation chosen from the project or best-fit grouping. |

The picker can show `Tauri Dev → <configuration list>`. When it has one useful choice, clicking `Tauri Dev` selects it directly; a needless extra submenu is omitted. In a solution with several C# projects, inference may suggest a GUI as the initial Run choice, but a user's saved default wins. The Build/Run chevrons remain one-off actions and do not change the default project. Each window may select a different project while viewing the same solution.

| Entrance | Target | Example |
| --- | --- | --- |
| Top menu: `{Project Name} Tools` | Default project selected through the toolbar picker | `ASP.NET API Tools` opens NuGet for the API's `.csproj`. |
| Command Palette | Same default project | `NuGet: Manage Packages (ASP.NET API)`; no hidden switch to another project. |
| Solution Explorer: right-click project | Project actually clicked | Right-click `Tauri Frontend` to add a Node package there even while the API is the default. |

The toolbar picker's **default project in this window** is the context for the top menu and palette. A solution best-fit choice may know associated components, such as Tauri's Rust and frontend projects; those associations can expose their relevant tools *under the selected project's menu*, with each component named. They must never pull in every project in the solution. Freeze the exact `projectId + manifestPath` when a package dialog opens, so changing the picker cannot silently redirect Add. If no project is selected, offer `Choose project…`. If two relevant projects have the same kind of manifest, label both and ask which one before writing. A missing or undeclared project has no package action until repaired.

### Top menu sketch

```text
File  Edit  View  Project  ASP.NET API Tools  Run  Help
                         ┌──────────────────────────────────┐
                         │ ASP.NET API · C# · Api.csproj   │
                         ├──────────────────────────────────┤
                         │ Manage NuGet Packages…           │
                         │ Restore Packages                 │
                         ├──────────────────────────────────┤
                         │ Project Configurations…          │
                         │ Toolchain Configuration…         │
                         └──────────────────────────────────┘
```

`Project` retains solution structure actions such as add/remove project. The adjacent dynamic menu follows the default project. For long names, truncate the label but show its full name in the header. Selecting another C# project changes both the label and NuGet target. When no project is selected, label it `Project Tools` and offer `Choose project…`. Keep the menu compact, with only current capabilities; a missing executable may leave its relevant item disabled with a short reason and a `Configure toolchain…` route. No giant “all C# features” list.

## Capability rules

Language alone is too coarse. A Tauri best-fit grouping may connect Rust **and** Node projects, and a C++ folder can use vcpkg, Conan, plain CMake, or none. Derive cheap per-project capabilities from declared projects and known manifests, then let a solution recommendation reference the projects it actually found. The following is a conceptual relationship, **not a committed `.cln` schema**:

```text
ProjectCapability {
  projectId, manifestPath, ecosystem,
  packageTool, packageToolStatus,
  supportedActions, lastManifestRevision
}

SolutionBestFit {
  label: "Tauri Dev",
  suggestedDefaultProjectId,
  relatedProjects: [{ role, projectId, manifestRef }],
  choices: [actionConfigurationId]
}
```

The `.craidd` project declaration establishes project identity; `Cargo.toml`, `.csproj`, `package.json`, `vcpkg.json`, or `conanfile.*` establish dependency ownership. A toolchain preference selects among supported installed tools; a lockfile or `packageManager` field is a strong project hint. If a hint and user override disagree, show the mismatch before writing a lockfile. Do not use language detection alone to claim that a package manager is supported. Capability calculation reads existing discovery state and manifest facts; opening a menu never rescans a toolchain, walks `node_modules`, or queries a registry.

`Tauri Dev` is a **solution best-fit name** backed by findings about a Rust backend and a TypeScript/JavaScript frontend. The grouping retains references to both findings and offers its available run/build choices. It is not a new `.craidd` project or the name of the Project Tools menu. The chosen option sets the default project/action in this window; the actual project name supplies `{Project Name} Tools`. Persist a user-chosen solution default deliberately, not every hover or one-off execution. Resolve current manifests and tool status from project references instead of saving stale copies of those facts.

```text
Solution best fit: Tauri Dev
  evidence: Rust backend   -> src-tauri/Cargo.toml
            TS frontend    -> package.json
  choices:  Tauri CLI dev  -> default project: frontend
            Tauri CLI build, if available

After choosing Tauri CLI dev:
  toolbar default project: <actual frontend project name>
  menu-bar label:          <actual frontend project name> Tools
  related component:      Rust backend, visibly labelled where relevant
```

Related project findings and action execution are separate. A normal Tauri CLI `dev` invocation can launch the frontend hook and compile the Rust app; Craidd must not start an extra Cargo process merely because two components were found. Tauri's [configuration reference](https://v2.tauri.app/reference/config/) defines `beforeDevCommand` and `beforeBuildCommand`. Today, inference checks both manifests but stores only a frontend-targeted `ConfigEntry` named `Tauri Dev`. That flattens the best-fit grouping into an action row and loses the Rust relationship. A future model should retain the inference evidence separately from the concrete action. Do **not** infer relationships from the words “Tauri Dev”, a shell command string, or every project in the solution.

| Manifest/capability | Menu action | First dialog | Executor |
| --- | --- | --- | --- |
| C# `.csproj` | `Manage NuGet Packages…`, `Restore Packages` | Project-scoped NuGet manager | Installed `dotnet` SDK |
| Rust `Cargo.toml` | `Add Cargo Dependency…`, later `Manage Cargo Dependencies…` | Compact Add dialog | Installed `cargo add` |
| JS/TS `package.json` | `Add Node Package…`, later `Manage Node Packages…` | Compact Add dialog | Project's npm/pnpm/Yarn selection |
| C++ `vcpkg.json` | `Add vcpkg Port…`, later `Manage vcpkg Dependencies…` | vcpkg Add dialog | Installed `vcpkg add port` |
| C++ `conanfile.py` or supported Conan manifest | `Manage Conan Dependencies…` | Conan-specific view | Installed Conan, feature-gated by version |
| Plain CMake without a package manifest | `Open Dependency Guidance…` | Guidance for `find_package`/`FetchContent`, no fake installer | No automatic mutation |
| Other languages | No invented package action | Later ecosystem adapter | Explicitly supported tool only |

When the selected default project has a known Tauri association, show its own frontend tools and an explicitly labelled **Rust backend** section for the associated Cargo manifest. This works whether the manifests belong to one `.craidd` project or two related projects. An unrelated Rust project in the same solution never appears there. A future Tauri plugin wizard may coordinate two package changes, but a basic `cargo add` must not pretend to install the corresponding JavaScript package automatically.

### Language service placement

IntelliSense is an editor capability, not a dependency action. Keep completion, diagnostics, and language-server configuration in editor/language settings. A small `Language service status…` entry can appear in Project Tools once a real service integration exists; it must report the current project and offer a restart only if Craidd can perform it. Opening Project Tools must never launch Roslyn, rust-analyzer, clangd, or a TypeScript service. Build, Run, and Debug remain in the toolbar and their configuration dialog rather than being copied into this menu.

## Dialogs and actions

### C#: Manage NuGet Packages

Use the two-column project dialog from [project configurations and NuGet](design-project-configurations-and-nuget.md): project and `.csproj` identity at top, `Installed`, `Browse`, and eventually `Updates` tabs, selected-package detail on the right, Output for operation progress. First delivery: direct installed packages, optional transitive view, and explicit Restore. Next: on-demand source search, Add, Remove, and version selection. Show configured feed name, prerelease state, and exact action before applying. Preserve Central Package Management and existing NuGet source/credential handling by delegating to `dotnet`; do not hand-edit `.csproj` or `Directory.Packages.props`.

The CLI adapter must account for .NET 10's `dotnet package ...` spelling and older SDKs' `dotnet ... package` spelling. Inspection uses `--no-restore` where supported so opening the manager does not perform network work. Search occurs after the user enters a query. The earlier companion document defines the staged NuGet scope in more detail. [Microsoft's package-add reference](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-add) documents the SDK command distinction; [package list](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-list) documents JSON output and restore behavior.

### Rust: Add Cargo Dependency

```text
Add Cargo Dependency                 Rust backend · src-tauri/Cargo.toml
Package       [ serde____________________ ]
Version       [ latest compatible  ▾      ]
Kind          [ Normal ▾ ]    Features [ derive____________ ]
Options       [ ] Optional  [ ] Disable default features
Command       cargo add serde --features derive --manifest-path …
                                      [Cancel] [Add Dependency]
```

The first release accepts a crate name and optional version, kind (`normal`, `dev`, `build`), features, and optional flag. No registry autocomplete is necessary for the first release. `cargo add` receives separate arguments and an explicit manifest path; for a workspace member, use Cargo's package selection when required. Show progress, failures, and changes to `Cargo.toml`/`Cargo.lock` in Output and refresh only that manifest's capability/dependency state afterward. The command may fetch metadata and edit the lockfile; it runs only after `Add Dependency`. [Cargo's `add` reference](https://doc.rust-lang.org/cargo/commands/cargo-add.html) documents these flags and manifest targeting.

### JavaScript/TypeScript: Add Node Package

```text
Add Node Package                 Tauri Frontend · package.json
Package       [ @scope/name________________ ]
Version       [ default selected by manager ]
Save as       (•) Dependency  ( ) Dev  ( ) Optional  ( ) Peer*
Manager       pnpm  ·  project setting / lockfile hint
                                      [Cancel] [Add Package]
```

The action uses the project's chosen manager and workspace package, rather than defaulting to npm or the solution root. Build separate argument adapters for npm, pnpm, and Yarn; their flags and workspace semantics differ. Show only dependency types supported by the detected manager version (`Peer` can follow later). Warn if the operation would create a second lockfile or target a workspace root unintentionally. A package install can run lifecycle scripts; make the tool, working directory, and resulting manifest/lockfile changes visible before execution. The existing Build/Run setup can continue using its own dependency bootstrap behavior; this dialog is for an explicit package addition. See [npm install](https://docs.npmjs.com/cli/v11/commands/npm-install/), [pnpm add](https://pnpm.io/cli/add), and [Yarn add](https://yarnpkg.com/cli/add).

### C++: follow the project's dependency model

There is no universal C++ library registry. `vcpkg.json` can support a direct Add dialog using `vcpkg add port`; use the detected manifest directory and let vcpkg write its manifest. A Conan adapter can come after the Conan version and manifest form are established; the current `conan require` command is documented as experimental and does not cover every recipe shape. For plain CMake, offer guidance and an explicit `Open CMakeLists.txt`, not a guessed package edit. `FetchContent` is a CMake mechanism, but inserting correct targets into an arbitrary build script requires more context than a package name. Do not install OS packages with apt/pacman from Project Tools. See [vcpkg add](https://learn.microsoft.com/en-us/vcpkg/commands/add), [Conan require](https://docs.conan.io/2/reference/commands/require.html), and [CMake FetchContent](https://cmake.org/cmake/help/latest/module/FetchContent.html).

### Configuration and toolchain links

The bottom of Project Tools may link to **Project Configurations…** (Build/Run/Debug/profile settings) and **Toolchain Configuration…** for the default project. A related component, such as a Tauri Rust backend, gets a clearly labelled route to its own toolchain settings. Project Tools does not add a second configuration model. Global discovery stays under `File → Preferences → Toolchains`.

## Command Palette contract

The current palette is a static list of view commands. Add a shared command registry with a dynamic provider fed by the default project's cached capabilities and any explicitly related components. The same action IDs and target resolver serve the top menu and Explorer context menu; only the target source differs. Do not construct a separate package runner in each React component.

Examples after choosing the frontend project through the solution's `Tauri Dev` best-fit entry:

```text
>
  Cargo: Add Dependency…             Rust backend · Cargo.toml
  Node: Add Package…                 Tauri Frontend · package.json
  Project: Configure Toolchain…      Tauri Frontend
```

Examples when `ASP.NET API` is the default project:

```text
> nuget
  NuGet: Manage Packages…            ASP.NET API · Api.csproj
  NuGet: Restore Packages            ASP.NET API · Api.csproj
```

Register a package command only when the default project or a specifically related component has the relevant manifest/capability. If an unrelated project in the solution has that capability, select it through the picker or use its Explorer context menu. If the tool is missing, keep a relevant command visible but disabled with a reason and a path to toolchain preferences; do not silently run it. The command label always names the target. Palette search is local string filtering, with no registry request on each keystroke.

## Solution Explorer contract

Right-clicking a project shows a compact `Dependencies` group appropriate to its manifests: `Manage NuGet Packages…`, `Add Cargo Dependency…`, `Add Node Package…`, or the supported C++ action. The group appears near the existing `Toolchain Configuration…`, `Fine Tune…`, and project actions. It is scoped to the clicked project even if the toolbar chip points elsewhere. A right-click on a file or folder must not inherit a guessed project when ownership is ambiguous; only a project node gets project package actions. For Tauri with two manifests, use explicit `Rust dependencies` and `Frontend dependencies` subentries or two direct items, depending on available width. Do not hide actions behind hover alone; click and keyboard navigation must work on ChromeOS.

## Execution and consistency

1. The user invokes an action. Resolve `projectId + manifestPath + tool + tool version` and freeze them in the dialog.
2. Validate that the target manifest remains inside the declared project, still exists, and has not changed since the dialog opened. If it changed, reload the preview before applying.
3. Run the ecosystem CLI as an argument vector with an explicit working directory; do not join untrusted names into a shell command. Honor project-level tool selection, then global preference, then detected default.
4. Stream progress to Output and offer Cancel where the process supports it. Keep package work in a background task. Do not block the WebKit UI thread.
5. Serialize operations that write the same manifest/lockfile. Coordinate with Build/Run so an install and a build of that project do not race. The present runner has one active process per window; package work needs either an explicit temporary limit or a small separate task lane before shipping.
6. On completion, refresh the affected project manifest, dependency view, file tree, and relevant diagnostics. Preserve a clear failure state; do not claim success because the process started.

Package commands may modify project files and download dependencies. The user explicitly triggers them and sees the exact project, tool, and target. Craidd does not silently restore, add, or update packages when a menu or solution opens. A future integrated terminal can display or rerun an operation, but package actions should work through Output and the task runner before that terminal exists.

## Running several projects: Duplicate Window

**One Play button starts one run target per window.** To run three GUIs and an ASP.NET API at once, open the same solution in four windows with `File → Duplicate Window`, select a different default project/configuration in each, and press Play in each window. This follows [the one-solution-per-window model](../linked-windows/design-window-model.md): each window sees one solution, and several windows may intentionally see the same solution. A Tauri CLI run may itself coordinate frontend and Rust child processes; it still occupies one window's run slot.

The current Rust runner already keys active runs by window label, so process/output/Stop can remain isolated. The new window must have its **own in-memory project selection, profile, debugger session, Output, and Stop control**; choosing an API in one window must not change a GUI window. The saved solution default is only the starting suggestion for a new window. Selecting a row or using a chevron must not rewrite `.cln`; an explicit `Make solution default` action may do that. The duplicate opens the same on-disk solution in a fresh window, rather than copying unsaved editor buffers or an active process.

Before shipping Duplicate Window, fix recent-session bookkeeping: `record_workspace_open` currently removes prior entries with the same solution path, so two windows on one `.cln` cannot both be restored. Identify session entries by window label while deduplicating only the *recent solutions* list by path. On shared `.cln` or manifest edits, refresh the other window on focus and detect conflicting writes. If two windows try the same server port, report the actual process error with its window/project context; do not silently stop another window's run. Additional webviews cost memory on ChromeOS, so duplicated windows should load editor and tooling work on demand and reuse the same background detection cache where safe.

## Performance plan

The user's “0–1 ms variable check” is plausible for a cached predicate. It is not a safe budget for the whole menu: React rendering, WebKit layout/paint, disk reads, process startup, registry access, and language services can dominate. The design keeps expensive work away from the interaction path:

| Moment | Allowed work | Deferred work |
| --- | --- | --- |
| Solution/project load | Parse known manifest names and small manifest metadata once, reuse background tool detection | Full dependency graph, registry query, language-server startup solely for menus |
| Menu open / project right-click | Read cached capability descriptor and render a short list | File traversal, IPC scan, CLI process, network request |
| Palette typing | Filter local command labels | Package search or tool discovery |
| Dialog open | Lazy-load dialog code, read cached direct dependencies; show loading state if needed | Full restore/install |
| User searches | Debounced, cancellable query with a small result page | Repeated requests for stale query text |
| User confirms | Background CLI task and bounded Output streaming | Synchronous work on the UI thread |
| Manifest/tool preference changes | Invalidate only affected project capabilities | Rebuilding all projects on every keystroke |

Target **under one animation frame (16 ms) at p95** for opening a cached menu on the ChromeOS Linux environment, and no subprocess or network access on that path. This is a measurement target, not a claim about current speed. Use `performance.mark` around menu open-to-paint, React profiling for rerenders, and Rust timing around manifest parsing and process execution on both Arch and Debian/Crostini. Compare cold and warm opens. Cap result rows and Output memory; do not recursively watch or index `node_modules`, `target`, `.git`, or build outputs. Reuse one capability registry and stable selectors so toolbar, palette, and Explorer do not each recompute discovery. Prioritize observed bottlenecks over speculative Tauri-versus-Electron explanations.

## Delivery order

1. **Picker and project identity.** Keep the solution best-fit label distinct from the default project and concrete action. Make choosing a picker row set the default project for this window; `{Project Name} Tools` follows that project. Preserve best-fit evidence for Tauri's Rust/Node relationship without renaming the project or forcing a new project/configuration model. Add targeted cache invalidation when a relevant manifest, project, or tool preference changes.
2. **Shared command registry and UI entrances.** Dynamic Project Tools menu, conditional palette commands, and project context menu all dispatch the same action ID with an explicit target. Dialog skeletons show target identity and missing-tool reasons.
3. **First useful operations.** NuGet Installed/Restore and compact Cargo Add and Node Add dialogs, each with a cancellable background task and targeted refresh. Add NuGet Browse/Add/Remove after Installed/Restore works with real project files.
4. **C++ adapters.** vcpkg manifest Add first; Conan only after compatible version/recipe detection; plain CMake stays guidance until a safe edit workflow is designed.
5. **Duplicate Window.** Open the same solution in another window with independent selection/run state. Correct recent-session storage and shared-file conflict handling before presenting it as a way to run several projects.
6. **Broader ecosystem work.** Dependency lists, updates, Tauri plugin coordination, and package adapters for additional languages. Add language-service status only with actual editor integration.

## Acceptance checks

- Select `ASP.NET API` through the picker: the label becomes `ASP.NET API Tools`, only API-relevant package commands appear in the top menu/palette, and NuGet targets its exact `.csproj`. Selecting `Desktop GUI` changes the label and target to that project. Right-clicking another project still acts on the clicked project.
- `Tauri Dev` appears as a solution best-fit entry, not as the Project Tools label. If it has one viable choice, clicking it selects that choice directly. The grouping retains evidence for its Rust/backend and TypeScript/frontend relationship; relevant Cargo and Node actions are visibly scoped to their exact manifests. Neither writes the other's manifest.
- With several C# projects, the suggested initial Run may be a GUI, but an explicit saved default takes precedence. One-off Build/Run chevrons never change `{Project Name} Tools`.
- Duplicate the same solution into four windows, select three GUIs and one ASP.NET API, and run them independently. Stopping one window leaves the other three running; each window keeps its own project/profile/Output. Both windows survive recent-session storage and report shared-file changes safely.
- A project with two `.csproj` files requires choosing one. A missing `dotnet`, Cargo, or Node manager yields an actionable disabled state rather than a crash.
- npm, pnpm, and Yarn projects use the selected/project-hinted manager and do not accidentally create a second lockfile; a C++ folder without a supported package manifest does not advertise an installer.
- Open the menu and type in the palette while offline: no registry calls or process launches. Measure cached menu p95 on Arch and Debian/Crostini; record any breach of the 16 ms target.
- Cancel a package task, change the active chip while a dialog is open, and modify a manifest externally: no retargeted or concurrent write, and the UI reports the actual outcome.
