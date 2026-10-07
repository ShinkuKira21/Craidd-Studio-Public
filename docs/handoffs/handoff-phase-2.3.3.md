# Handoff: Phase 2.3.3 — Configurations

**Date:** Session ending after Phase 2.3.3.2.3.
**Current phase:** Configurations feature, UI complete, functionality partial.
**Next session:** Wire the runner (Stage C.3).

---

## What this project is

A native polyglot IDE for Linux, built on Tauri v2 + React + Monaco.

**The thesis:** organization over mixed debugging. Each language in a
solution gets its own tree, its own build target, its own debug context.
The user declares structure; the IDE never infers.

**Not** a VS Code replacement. **Not** a Visual Studio clone. An
organizer for projects that mix languages — the tool VS Code refuses to
be, and the tool Rider can't be on Linux.

---

## Where we are right now

### Foundation (Phase 2.0 → 2.1)
- `.cln` (solution) and `.craidd` (project) file formats.
- One `.craidd` per folder, named after the folder.
- `[config]` section in the same file (config as a facet, not a separate
  project).
- Multi-tree Solution Explorer + File Discovery.
- Ancestor solution detection with choice dialog.
- Heal-on-load for orphan `.craidd` files.
- Boundary rule: subfolder with its own `.craidd` stops parent walk.
- Interop extensions: TS↔JS, C#↔C/C++, Python↔C.

### Phase 2.3.1 — Bug fixes
- `preferences_file_path` exposes the real preferences path.
- Toolchain Configuration dialog (per-project tool overrides in `.cln`).

### Phase 2.3.1.2 — The anchor fix (Stage A)
- `load_solution` and `load_solution_named` return `SolutionWithPath`,
  which carries the actual `.cln` path they loaded.
- The store uses that path, never reconstructs it from a name string.
- `rootPath` is the `.cln`'s own parent folder, not the folder the user
  opened.
- **The invariant, now enforced:** The loaded `.cln`'s folder is the top.
  Manifests, trees, and build commands live at it or below it. Config
  directories may ascend WITHIN it. Nothing ascends PAST it.

### Phase 2.3.2 — Manifest reading (Stage B)
- `read_manifests(folder)` in Rust.
- Four parsers: `Cargo.toml`, `package.json`, `*.csproj`, `CMakeLists.txt`.
- Loose structs, session-only, never written to disk.
- Manifests read from the project's resolved folder AND from the config
  folder if `[config].directory` is declared and distinct.
- Cargo's auto-bin convention applied: `src/main.rs` + `[package].name`
  produces a bin, same as Cargo's own rule.
- `docs/feats/project-model/design-manifests.md` written.

### Phase 2.3.3.1 — Configuration schema + inference
- `.cln` gains `[[config]]` array and `default_config` string.
  Legacy `default_build` preserved for old files.
- `ConfigEntry` struct: name, kind, target, method, command, cwd,
  origin, profiles, default_profile.
- `Profile` struct: name, args, env, description.
- `infer_configs(solution)` reads each project's manifests and proposes
  Configurations.
- Inference rules:
  - Tauri signature (Rust bin + TS with `scripts.tauri`) → `Tauri Dev`.
  - Cargo manifest with a bin → `{name}: cargo build`.
  - npm manifest with `scripts.dev` → `{name}: npm run dev`.
  - dotnet `.csproj` with `OutputType=Exe` → `{name}: dotnet run`.
  - CMake manifest with `add_executable` → `{name}: cmake build`.
- Profiles populated per method:
  - Cargo → `debug`, `release`.
  - dotnet → `Debug`, `Release`.
  - CMake → `Debug`, `Release`, `RelWithDebInfo`, `MinSizeRel`.
  - npm, shell, composed → none.

### Phase 2.3.3.2 — Configurations dialog (UI)
- Toolbar rewritten: `[🔨] [Configuration ▾] [▶] [⏹] [🐛]`.
- Configuration chip opens a dropdown grouped by "Configured" /
  "Inferred", with an `Add / Edit Configurations…` footer.
- `ConfigurationsDialog.tsx` — modal shell with a section rail.
- Build section:
  - `ConfigurationTree.tsx` — list of configurations, grouped by target
    project. Each row shows a `auto` badge for inferred entries.
  - `ConfigurationForm.tsx` — three-section composition:
    - **Universal** — name, kind, target, method, cwd.
    - **Common** — profile dropdown (stateful), args, env.
    - **Method-specific** — dispatched by method.
  - `InheritedField.tsx` — CLion-style inherited value display with a
    `↻` override affordance (visual only).
  - `CommandPreview.tsx` — "Will run" line at the bottom.
- Six method forms: Cargo, npm, dotnet, CMake, Shell, Composed. Each
  reads its project's manifest and renders the appropriate fields.
- `CommonSection` profile dropdown is stateful — switching profile
  updates the Args/Env fields to show that profile's values.
- **Still display-only.** Fields are read-only. Nothing writes to `.cln`.

---

## Locked design decisions

### The `.cln` / `.craidd` split

- `.craidd` = folder classification. Three to six lines. Never a version,
  never a toolchain, never a build command.
- `.cln` = solution composition. Names, project list, `[[config]]`
  entries, `default_project`, `default_config`.

### Manifests

- Manifests are ecosystem-owned. Craidd reads them, never writes them,
  never mirrors them into `.craidd` or `.cln`.
- Where project-intrinsic facts live, the IDE **points** at the file
  (offers to open `CMakeLists.txt`) rather than offering a shadow field.
- Where per-invocation facts live (build type, args, env), the IDE
  stores them in the Configuration, in `.cln`.

### The three-section form

Every Configuration, whatever its method, is edited in the same shape:

- **Universal** — name, kind, target, method, cwd. Never varies.
- **Common** — profile, args, env. Same shape across methods.
- **Method-specific** — one component per method. The only part that
  changes.

This is what makes the dialog fluid. Adding a method is one file.

### Debugging (recorded, not implemented)

- True cross-language step-through at the FFI boundary is **not
  delivered by any IDE on Linux**. Craidd doesn't attempt it.
- Debug attaches to one project, one process.
- Composed Configurations aren't debuggable as a whole.
- A library with no entry point needs a driver project (Phase 3 feature).
- `docs/philosophies/debugging/mixed-debugging/philosophy-mixed-debugging.md` is the reference.

### The manifesto

**The manifest is the contract.** Craidd reads what the ecosystem
declared. When the declaration exists, Craidd proposes a Configuration.
When it doesn't, State 0 — the IDE is silent, the user writes one.

The escape hatch is always available and cheap: one command line in
`.cln`, done.

---

## Forward-looking (do not build yet)

- **C.3 — wire the runner.** Build / Run / Stop fire the selected
  Configuration. Output streams. (This is the next push.)
- **C.4 — editable dialog.** Field edits write to `.cln`.
- **C.5 — right-click project → Preferences.** Opens the dialog scoped
  to one project.
- **Custom Build Instructions.** A step-list editor inside the dialog,
  producing a `method = "composed"` Configuration. This is the general
  answer to "I have a C# project that consumes a C++ .so."
- **Command Palette integration.** `Ctrl+Shift+P` → "Run Tauri Dev".
- **Create Driver Project.** Right-click a C++ library → generates a
  driver project. Phase 3.
- **First LSP.** `rust-analyzer` as a subprocess feeding Monaco.

---

## Known cleanup items

- The `docs/feats/configurations/design-configurations-sketches.md` sketches use `inherit:`
  annotations that should become `override` affordances now that
  inherited fields are visually distinct.
- `infer.rs` is one file. When it grows to per-language modules
  (cargo.rs, npm.rs, dotnet.rs, cmake.rs), split it.
- The `InheritedField` component is visual-only. It will need real
  toolchain state when C.4 lands.

---

## Files added/changed in this phase

**Rust:**
- `src-tauri/src/types.rs` — `Profile`, `ConfigEntry`, `SolutionWithPath`,
  `CraiddProject.manifests`, `CraiddSolution.configs`,
  `CraiddSolution.inferred_configs`.
- `src-tauri/src/commands/manifests.rs` — new.
- `src-tauri/src/commands/infer.rs` — new.
- `src-tauri/src/commands/solution.rs` — reads/writes `[[config]]` and
  `[[config.profile]]`.
- `src-tauri/src/commands/build.rs` — honest failure message when the
  manifest guard trips.

**Frontend:**
- `src/components/layout/Toolbar.tsx` — rewritten as chip + icon buttons.
- `src/components/dialogs/configurations/ConfigurationsDialog.tsx` — new.
- `src/components/dialogs/configurations/SectionRail.tsx` — new.
- `src/components/dialogs/configurations/build/` — the build page and
  its components (13 files).
- `src/store/buildStore.ts` — `selectedConfigName`, `selectedProfileName`.
- `src/types/project.ts` — `Profile`, `ConfigEntry`, `Manifest`.

**Docs:**
- `docs/feats/project-model/design-manifests.md`
- `docs/feats/configurations/design-configurations-sketches.md`
- `docs/philosophies/debugging/mixed-debugging/philosophy-mixed-debugging.md`

---

## Roadmap

**Immediate (this feature):**
- C.3 — runner wire.
- C.4 — editable dialog + write to `.cln`.
- C.5 — right-click Preferences.
- Custom Build Instructions (step editor).
- Command Palette integration.

**Phase 3 (stretch):**
- First LSP (`rust-analyzer`).
- First DAP (`lldb-dap` for Rust).
- Debug context dropdown populated from `[[config]]` entries with
  `kind = "debug"`.

**Later:**
- Build orchestration across projects (the C# + C++ case, end to end).
- Other languages' full support (C++, C#, Python).
- Open source release when three languages work end to end.

**Open source gate:** Rust + TypeScript + C++ (or C#) with real editing,
LSP, build, and debug. When three languages work end-to-end, it goes
public.

---

## The opening prompt for the next session

> Here is the full state of Craidd-Studio after Phase 2.3.3.2.3.
> The Configurations dialog renders and reflects what the IDE sees;
> the toolbar has the Configuration chip and icon buttons. Fields
> are read-only; the runner isn't wired.
>
> I want to start Stage C.3: wire the runner. Build, Run, and Stop
> should fire the selected Configuration. Output streams to the
> bottom panel. The idle/running state shape works.
>
> Generate `setup-v2.3.3.3.sh`.

---

*Last updated: end of session, Phase 2.3.3.2.3. Author: skira24, with
assistance.*
