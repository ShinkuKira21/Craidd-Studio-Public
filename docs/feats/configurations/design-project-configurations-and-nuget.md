# Design: Project configurations and NuGet

**Status:** Proposed, 19 September 2026. Design only; no implementation in this document.
**Scope:** The toolbar configuration picker, Build/Run/Debug defaults, the
Configurations dialog, and project-scoped NuGet package management.

## Decision

The toolbar should select a **project configuration**, not a command. One
configuration can provide Build, Run, and eventually Debug actions. The
currently selected configuration is the default context for every action it
supports. Each action button retains its chevron for a one-off choice.

For the four C# examples, the main picker should show four project rows. The
current eight rows (`Project: dotnet build` and `Project: dotnet run` for each)
are implementation detail, not eight meaningful choices for the user.

NuGet is a good next project feature. Start with a small package view and
explicit restore. Add search, add, remove, and update after project identity
and the configuration editor are reliable. This uses the installed `dotnet`
CLI; Craidd does not need its own package resolver or a bundled SDK.

## Toolbar behavior

```text
[Build ▾] [ASP.NET API ▾] [Profile  Debug ▾] [Run ▾] [Stop] [Debug ▾]
```

- The center chip names the active project configuration, e.g. `ASP.NET API`.
  `Debug`/`Release` stays in the adjacent Profile chip; neither creates a
  second project row.
- The main Build and Run buttons use that same configuration. Debug uses it
  only after a real debugger adapter exists. If an action is unavailable,
  disable its main button and say why in the tooltip.
- A button chevron lists available configurations for **that action**. Choosing
  one fires it once. It does not silently change the active project.
- Selecting a project in the center chip changes the shared default context
  for Build and Run, plus Debug when supported. There is no need to maintain
  separate, invisible default projects for each button.
- A user may explicitly assign a different default for one action in the
  dialog. Show that exception on the relevant button; do not let a one-off
  chevron choice create it accidentally.
- Persist the active configuration per solution. A temporary one-off action
  choice does not persist. A named user configuration and its default choices
  belong in `.cln`; `.craidd` remains a folder marker, and `.csproj` remains
  the source of .NET project facts.

### Main picker

```text
INFERRED
  CSharp Smoke                         ›
  Console Main                         ›
  Desktop GUI                          ›
  ASP.NET API                           ›
────────────────────────────────────────
  Add / Edit Configurations…

                    ASP.NET API ›
                    ┌────────────────────────────┐
                    │ Build    dotnet build      │
                    │ Run      dotnet run        │
                    └────────────────────────────┘
```

The submenu shows only actions the project can perform. The C# sample has two
rows today; Debug appears when it is actually wired. A configured override
replaces its inferred counterpart in the compact list and gets a quiet
`Custom` badge. If a project has multiple named variants, the submenu can
show `Run · Local` and `Run · Staging`; the project still occupies one row.

Hover opens the submenu after a short delay. Clicking the project row selects
the project; clicking its arrow opens the submenu. Keyboard Right/Left and
Enter must work, and touch users must be able to open it by click. Keep the
submenu within the window edge. The menu should feel compact and calm, with
four rows in the example rather than eight repeated command names.

### Action chevrons

The Build chevron can keep the familiar quick list, but use project names:

```text
BUILD
  CSharp Smoke
  Console Main
  Desktop GUI
  ASP.NET API
```

Show the command and profile as secondary text on hover or in a small detail
line. Do not repeat `: dotnet build` in every primary label. Run and Debug
chevrons follow the same pattern and omit unsupported projects. The user can
always see which project and profile will fire before invoking an action.

## Configuration model and migration

Today `ConfigEntry` has one `kind` (`build`, `run`, or `debug`). Recent C#
inference produces two entries for an executable so both toolbar buttons
work. Grouping those entries in the UI is the safe first step. It is **not**
the final data model: one entry cannot currently be the default for both
Build and Run.

The next model should make a named configuration own optional action slots:

```text
Project configuration
  identity: stable ID, name, target .craidd, origin
  profile: Debug / Release / custom
  build: command or method, optional
  run: command or method, optional
  debug: adapter and launch/attach settings, optional
```

One `ASP.NET API` configuration can then supply Build and Run without two
stored `[[config]]` rows. Multiple configurations for the same project remain
possible when they represent real choices, such as `API · Local` and
`API · Staging`. A missing Debug slot stays missing; Run does not pretend to
be Debug.

Migration should read existing single-kind `.cln` entries unchanged, pair
compatible entries by target and intent for display, and write the new shape
only after a user edits or explicitly saves it. Do not combine entries merely
because their names look similar: custom commands, environment variables, or
working directories may differ. Keep a way to inspect the original command
for every slot. This proposal changes the toolbar grouping in
`design-configurations-sketches.md`; its Universal/Common/Method fields are
still useful inside the editor.

## Smarter Configurations dialog

Use a two-column dialog rather than a long command tree:

```text
PROJECTS                 ASP.NET API
  CSharp Smoke           [General] [Build] [Run] [Debug]
  Console Main           Profile: Debug ▾
  Desktop GUI            Build: dotnet build --configuration Debug
  ASP.NET API  ●          Run:   dotnet run --configuration Debug
  + New configuration   Debug: unavailable — no C# adapter
                         [Make default] [Save]
```

- Left: projects and their named variants, one line per meaningful
  configuration. `Inferred`/`Custom` is a small badge, not a duplicate group.
- Right: one selected configuration, with General and action tabs. Retain
  command preview, inherited toolchain information, profile args, and env.
- An inferred configuration is read-only until the user chooses `Customize`;
  customizing creates a user-owned override without changing the ecosystem
  manifest.
- The form must save, reload, and validate `.cln` edits. The current dialog's
  local-only Add/Duplicate rows are a prototype and must not be presented as
  durable configuration editing.
- The default marker belongs to the configuration, with an explicit per-action
  override only when requested. Build and Run buttons must report the same
  project after selecting it in the center chip.

## NuGet: right-sized first release

Entry point: right-click a C# project in Solution Explorer → **Manage NuGet
Packages…**. It is scoped to the exact `.csproj`, not the whole `.cln` and
not the global toolchain preferences. A project with multiple `.csproj`
files must first let the user choose the manifest; the current
`read_manifests` command only returns the first one in a folder.

Staged scope:

1. **First release — Installed.** List direct packages and their
   requested/resolved versions. An optional `Show transitive` toggle adds
   dependency packages. If restore assets are absent, show `Restore required`
   instead of launching a restore during inspection.
2. **First release — Restore.** Make restore explicit and cancellable, with
   progress and errors in Output. Opening the IDE or package pane does not
   start it.
3. **Second release — Browse.** Search configured NuGet sources only when the
   user searches. Show source, version, and prerelease state. Show framework
   compatibility only when package metadata establishes it; never guess.
4. **Second release — Add / Remove.** Add selects an exact package and version;
   Remove targets a direct package reference. Show the command and files that
   may change, then invoke the installed `dotnet` CLI. Refresh the list and
   project manifests afterward. A failed restore remains visible.
5. **Later — Updates.** Separate available updates from vulnerability
   findings; never apply either silently.

For .NET 10, the CLI already supplies JSON from
`dotnet package list --project <csproj> --format json --no-restore` and supports
`dotnet package search`, `dotnet package add`, and `dotnet package remove`.
The installed SDK successfully listed the sample API's
`Swashbuckle.AspNetCore` reference in JSON. Older supported SDKs use the
earlier `dotnet list/add/remove package` spelling, so the adapter should
choose commands from the detected SDK version. `--no-restore` on inspection
is deliberate: .NET 10 otherwise restores when needed.

Let NuGet/MSBuild own edits to `.csproj` and `Directory.Packages.props`.
Central Package Management, multi-target frameworks, private feeds, and
credential providers make manual XML edits unreliable. Use the user's
configured package sources and credential provider; do not store feed
secrets in Craidd preferences. Package operations are explicit project
dependency changes, distinct from installing an SDK or toolchain. Before
implementation, clarify the absolute “does not install anything, ever”
sentence in `philosophy-tool-discovery.md` and the manifest read-only rule in
`craidd-cln-model.md` to preserve that distinction.

## Delivery order and acceptance

1. Group inferred entries by project in the toolbar and action chevrons.
   Four example projects show four main rows, each with Build and Run.
2. Make the selected project and profile drive both main actions. A chevron
   action remains a one-off choice. Restarting Craidd restores the explicit
   solution default, not the last one-off run.
3. Make the Configurations dialog truly writable and migrate old entries
   without losing custom commands or profiles.
4. Add the project-scoped NuGet Installed/Restore view. Then Browse/Add/Remove,
   followed by Updates and source handling.
5. Add a real Debug slot only with debugger integration. No duplicate `Run`
   configuration labelled `Debug`.

The menu and dialog should be checked with mouse, keyboard, and touch-style
clicks, including a small ChromeOS window. The NuGet view should be checked
with direct PackageReference, transitive packages, a centrally managed
version, an offline restore error, and a private feed that needs the user's
existing credential provider.

## References

- [Microsoft: list packages in JSON](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-list)
- [Microsoft: search packages](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-search)
- [Microsoft: add packages](https://learn.microsoft.com/dotnet/core/tools/dotnet-package-add)
- [Microsoft: remove packages](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-remove)
- [Microsoft: Central Package Management](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management)
- [Microsoft: authenticated feeds](https://learn.microsoft.com/en-us/nuget/consume-packages/consuming-packages-authenticated-feeds)
