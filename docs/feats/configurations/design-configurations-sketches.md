# Design: Configuration Sketches

**Roadmap track:** Phase 2 configuration foundation; Phase 3 build/debug and unscheduled future sketches. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design document. Reference for building the Configuration
editor's per-method forms.

**Applies to:** Phase 2.3.3 (Configuration editor), Phase 3+ (debug/test).

**Governs:** What fields each method's form contains, and why the layout
is shared across methods.

---

## The three-section form

Every Configuration, whatever its method, is edited in the same shape:

+++
┌─ Configurations ──┬─ {selected entry} ────────────────────────┐
│                   │                                            │
│  ...tree...       │  ─ Universal ───────────────────────────  │
│                   │  Name      [ ...........................]  │
│                   │  Kind      [ run | build | debug | test ▾] │
│                   │  Target    [ .......... .craidd ......... ]│
│                   │  Method    [ cargo | npm | dotnet | ... ▾ ]│
│                   │  cwd       [ (default: target's folder)  ] │
│                   │                                            │
│                   │  ─ Common ──────────────────────────────  │
│                   │  Profile   [ method-specific set      ▾ ] │
│                   │  Args      [ one per line              ]   │
│                   │  Env       [ KEY=VALUE per line        ]   │
│                   │                                            │
│                   │  ─ {Method} ────────────────────────────  │
│                   │  (method-specific fields)                  │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $ ......................................  │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

- **Universal** — same fields on every Configuration. Never varies.
- **Common** — same *shape* on every method; only the values vary.
  `Profile` is hidden when the method has no profiles (shell, npm).
- **Method-specific** — one component per method. This is the only
  part that changes shape from method to method.

The layout is fluid because only the bottom section varies. Adding a
new method is one new file. Adding a common field later is one place.

### Why the three sections exist

We tried designing field-by-field and it bloated. Most fields that
*look* method-specific are actually shared in shape:

- Every method passes extra arguments → `Args`, shared.
- Every method has env vars → `Env`, shared.
- Many methods have debug/release variants → `Profile`, shared shape,
  method-specific value list.
- Every method has a name, kind, target, cwd → `Universal`.

What's genuinely unique is: the tool paths, the tool-specific knobs
(Cargo features, CMake generator, dotnet framework), and how the command
is composed. Those go in the Method section. Nothing else.

---

## The seven methods

Twelve examples follow, but they map to **seven actual method
components**. The rest are field-value variations on those seven.

| Method     | Real forms |
|------------|------------|
| `cargo`    | Rust (standalone), Tauri (as a step) |
| `npm`      | TypeScript, JavaScript |
| `dotnet`   | C# ASP.NET, C# GUI |
| `cmake`    | C++ with CMake, C++ with MinGW, C++ library attached to C# (with install step) |
| `shell`    | C++ without CMake |
| `composed` | Tauri V2 (whole-solution) |
| `python`   | Python Application, Python Server, Python ML |

The doc shows the twelve examples so we can *see* the variations, but
the code is seven components, not twelve.

---

## 1. TypeScript / JavaScript (Node)

**Method:** `npm`

### Tier 3 — npm

+++
─ npm ─────────────────────────────────────
Script      [ dev                           ]   (from package.json)
Pkg mgr     [ inherit: pnpm            ▾ ]      (preferences default)
Node        [ inherit: node 20.11.0    ↻ ]      (preferences)
Scripts     dev · build · tauri · test           (read-only hints)
+++

### Full dialog

+++
┌─ Configurations ──┬─ Frontend (Vite) ──────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Frontend (Vite)             ] │
│   · Release       │  Kind      [ run                      ▾ ]  │
│ Frontend (Vite) ▶ │  Target    [ src/src.craidd             ]  │
│ Native Lib        │  Method    [ npm                      ▾ ]  │
│                   │  cwd       [ (default: src/)            ]  │
│ [+ New ▾]         │                                            │
│ [⧉ Duplicate]     │  ─ Common ──────────────────────────────  │
│ [- Remove]        │  Profile   [ (none)                     ]  │
│                   │  Args      [                            ]  │
│                   │  Env       [ VITE_PORT=1520             ]  │
│                   │                                            │
│                   │  ─ npm ────────────────────────────────  │
│                   │  Script    [ dev                        ]  │
│                   │  Pkg mgr   [ inherit: pnpm         ▾ ]     │
│                   │  Node      [ inherit: node 20.11.0  ↻ ]    │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  pnpm run dev                           │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- No `Profile` — npm has no debug/release concept.
- `Script` is a free-text field with a hint list of what `package.json`
  exposes. Inference fills it from `scripts.dev` when present.
- `Pkg mgr` and `Node` are inherited from preferences. Overriding here
  writes a per-project toolchain override, same shape as 2.3.1.

---

## 2. Tauri V2 (composed)

**Method:** `composed`

Tauri's dev flow is two tools running at once (`cargo` + `npm`/`pnpm`).
It is not one command in a shell — it's a composition. The Tier 3 form
is a step list.

### Tier 3 — composed

+++
─ composed ────────────────────────────────
Steps:                                       [+ Add step ▾]
 1.  src-tauri · cargo run          [✎] [✕]
 2.  src · npm run dev              [✎] [✕]
                                        [↑] [↓]
On stop:  ○ sequential   ● parallel-safe
+++

### Full dialog

+++
┌─ Configurations ──┬─ Tauri Dev ───────────────────────────────┐
│ Tauri Dev     ▶   │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Tauri Dev                  ]  │
│   · Release       │  Kind      [ run                      ▾ ]  │
│ Frontend (Vite)   │  Target    [ .                          ]  │
│ Native Lib        │  Method    [ composed                 ▾ ]  │
│                   │  cwd       [ (default: solution root)   ]  │
│ [+ New ▾]         │                                            │
│ [⧉ Duplicate]     │  ─ Common ──────────────────────────────  │
│ [- Remove]        │  Profile   [ (none)                     ]  │
│                   │  Args      [ (unused)                   ]  │
│                   │  Env       [                            ]  │
│                   │                                            │
│                   │  ─ composed ────────────────────────────  │
│                   │  Steps:                     [+ Add step ▾] │
│                   │   1.  src-tauri · cargo run      [✎] [✕]   │
│                   │   2.  src · npm run dev          [✎] [✕]   │
│                   │                                  [↑] [↓]   │
│                   │                                            │
│                   │  Will run:                                 │
│                   │    step 1 in parallel with step 2          │
│                   │    target: src-tauri/  and  src/           │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- `Target` is `.` — the whole solution. A composed config composes
  across projects, so it has no single target.
- Each step is either a `{project, command}` pair or a reference to
  another named Configuration. Clicking `[✎]` opens an inline editor
  for that step (three fields: project, command, cwd).
- The `[+ Add step ▾]` menu offers two options: **"Reference a
  Configuration…"** (opens the tree in a mini-picker) or **"Raw
  command…"** (opens a small form).
- Sequential vs parallel is a per-step flag in the spec, but the UI
  in this first pass is a single "on stop" preference. Phase 3 will
  grow it into a real dependency graph.

---

## 3. Rust (standalone)

**Method:** `cargo`

### Tier 3 — cargo

+++
─ cargo ───────────────────────────────────
Package     [ tauri-app                        ]
Bin         [ tauri-app                    ▾ ]  (from [[bin]])
Features    [ serde,json                       ]
Target      [ (host: x86_64-unknown-linux)  ▾ ]
Release     ☐  (mirrors Profile == "release")
Cargo       [ inherit: ~/.cargo/bin/cargo  ↻ ]
Rustc       [ inherit: ~/.cargo/bin/rustc  ↻ ]
+++

### Full dialog

+++
┌─ Configurations ──┬─ Rust · Release ──────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Release                    ]  │
│   · Release   ▶   │  Kind      [ build                    ▾ ]  │
│ Frontend (Vite)   │  Target    [ src-tauri/src-tauri.craidd ]  │
│ Native Lib        │  Method    [ cargo                    ▾ ]  │
│                   │  cwd       [ (default: src-tauri/)      ]  │
│ [+ New ▾]         │                                            │
│ [⧉ Duplicate]     │  ─ Common ──────────────────────────────  │
│ [- Remove]        │  Profile   [ Release                  ▾ ]  │
│                   │  Args      [ --release                  ]  │
│                   │  Env       [ RUST_BACKTRACE=1           ]  │
│                   │                                            │
│                   │  ─ cargo ───────────────────────────────  │
│                   │  Package   [ tauri-app                  ]  │
│                   │  Bin       [ tauri-app              ▾ ]    │
│                   │  Features  [ serde,json                 ]  │
│                   │  Target    [ (host)                 ▾ ]    │
│                   │  Cargo     [ inherit: ~/.cargo/...  ↻ ]    │
│                   │  Rustc     [ inherit: ~/.cargo/...  ↻ ]    │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  cargo build --release --features serde,json │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- `Package` and `Bin` are inferred from `Cargo.toml`. `Bin` shows the
  auto-detected binary if `[[bin]]` is absent and `src/main.rs` exists
  (Cargo's own rule).
- `Profile` is populated from `[profile.*]` in `Cargo.toml`, always
  including `debug` and `release`.
- The `Release` checkbox is a shortcut that just flips `Profile` and
  adds `--release` to args. It's a convenience for users who don't
  want to think about the Cargo profile system.
- `Target` defaults to `(host)`. Choosing a specific target triple
  enables cross-compilation and reveals a "Target toolchain" row,
  same shape as `Cargo` and `Rustc`.

---

## 4. C++ without CMake

**Method:** `shell`

This is State 0 in disguise. There's no manifest, so the IDE cannot
infer anything. The user writes a Configuration from scratch. The
form is `shell` with a rich set of common args and env.

### Tier 3 — shell

+++
─ shell ───────────────────────────────────
Command     [ g++                            ]
Args        [ -std=c++20                     ]
            [ -O2                          ]
            [ -o main                      ]
            [ src/*.cpp                    ]
Shell       ○ direct   ● via /bin/sh
+++

### Full dialog

+++
┌─ Configurations ──┬─ Build Main (g++) ────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Build Main (g++)           ]  │
│   · Release       │  Kind      [ build                    ▾ ]  │
│ Frontend (Vite)   │  Target    [ cpp-hello/cpp-hello.craidd ]  │
│ Native Lib        │  Method    [ shell                    ▾ ]  │
│ C++ Hello         │  cwd       [ (default: cpp-hello/)      ]  │
│                   │                                            │
│ [+ New ▾]         │  ─ Common ──────────────────────────────  │
│ [⧉ Duplicate]     │  Profile   [ (none)                     ]  │
│ [- Remove]        │  Args      [ -std=c++20                 ]  │
│                   │            [ -O2                        ]  │
│                   │            [ -o main                    ]  │
│                   │            [ src/*.cpp                  ]  │
│                   │  Env       [                            ]  │
│                   │                                            │
│                   │  ─ shell ───────────────────────────────  │
│                   │  Command   [ g++                        ]  │
│                   │  Shell     ○ direct   ● via /bin/sh         │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  /bin/sh -c "g++ -std=c++20 -O2 -o main src/*.cpp" │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- No inference. The user wrote this.
- `direct` runs `Command` + `Args` as a single exec. `via /bin/sh`
  wraps it in a shell so globs and pipes work. Default is `direct`;
  turning on the shell is a deliberate act.
- This is the honest answer to "C++ without CMake." We don't invent
  a build system. We let the user write the compiler invocation.

---

## 5. C++ with CMake

**Method:** `cmake`

### Tier 3 — cmake

+++
─ cmake ───────────────────────────────────
Source dir  [ .                                 ]
Build dir   [ build                             ]
Generator   [ inherit: Ninja              ▾ ]     (preferences)
Build type  [ Release                    ▾ ]
Toolchain   [ (none)                    ▾ ]
Defines     [ CMAKE_BUILD_TYPE=Release         ]
            [ CMAKE_CXX_STANDARD=20           ]
CMake       [ inherit: /usr/bin/cmake   ↻ ]
+++

### Full dialog

+++
┌─ Configurations ──┬─ Native Lib ──────────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Native Lib                 ]  │
│   · Release       │  Kind      [ build                    ▾ ]  │
│ Frontend (Vite)   │  Target    [ native/native.craidd       ]  │
│ Native Lib    ▶   │  Method    [ cmake                    ▾ ]  │
│                   │  cwd       [ (default: native/)         ]  │
│ [+ New ▾]         │                                            │
│ [⧉ Duplicate]     │  ─ Common ──────────────────────────────  │
│ [- Remove]        │  Profile   [ Release                  ▾ ]  │
│                   │  Args      [ -j 8                       ]  │
│                   │  Env       [                            ]  │
│                   │                                            │
│                   │  ─ cmake ───────────────────────────────  │
│                   │  Source dir [ .                         ]  │
│                   │  Build dir  [ build                     ]  │
│                   │  Generator  [ inherit: Ninja       ▾ ]     │
│                   │  Build type [ Release              ▾ ]     │
│                   │  Toolchain  [ (none)               ▾ ]     │
│                   │  Defines    [ CMAKE_CXX_STANDARD=20     ]  │
│                   │  CMake      [ inherit: /usr/bin/...  ↻ ]   │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  cmake -S . -B build -G Ninja            │
│                   │      -DCMAKE_BUILD_TYPE=Release -j 8        │
│                   │                                            │
│                   │  Followed by:                              │
│                   │  $  cmake --build build --config Release    │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- `Generator` is inherited from preferences (2.3.1). The per-project
  override is the same mechanism.
- `Build type` maps to CMake's `CMAKE_BUILD_TYPE`. Debug, Release,
  RelWithDebInfo, MinSizeRel — whatever the user's `CMakeLists.txt`
  supports.
- Two commands are shown in "Will run" because CMake configure and
  CMake build are two steps. The Configure step is skipped if the
  build dir already has a `CMakeCache.txt` — Craidd reads the file
  system to decide.
- If the user has a `CMakePresets.json`, a "Preset" row appears above
  `Generator` and takes precedence. Presets are CMake's own
  named-configuration system, and we surface them rather than
  duplicating them.

---

## 6. C++ with MinGW (cross-compile)

**Method:** `cmake` (with a toolchain file)

### Tier 3 — cmake with toolchain

+++
─ cmake ───────────────────────────────────
Source dir  [ .                                 ]
Build dir   [ build-mingw                       ]
Generator   [ inherit: Ninja              ▾ ]
Build type  [ Release                    ▾ ]
Toolchain   [ cmake/mingw-toolchain.cmake  ▾ ]  ← the key field
Defines     [ CMAKE_BUILD_TYPE=Release         ]
CMake       [ inherit: /usr/bin/cmake   ↻ ]

Detected from toolchain file:
  C   compiler  x86_64-w64-mingw32-gcc
  C++ compiler  x86_64-w64-mingw32-g++
  Sysroot       /usr/x86_64-w64-mingw32
  Target        x86_64-w64-mingw32
+++

**Notes.**
- MinGW is not a "method." It's a **toolchain file** passed to CMake.
  The file is a plain `*.cmake` script that CMake reads before
  configuring, and it declares compiler paths, sysroot, and target
  triple.
- When a toolchain file is set, Craidd reads it (text scan for
  `CMAKE_C_COMPILER`, `CMAKE_CXX_COMPILER`, `CMAKE_FIND_ROOT_PATH`,
  and the standard MinGW variables) and displays what it found below
  the field. The user sees the effect without opening a terminal.
- The `Detected from toolchain file` block is a read-out, not an
  editor. To change the compilers, edit the file. To change the file,
  click the `▾`.
- Cross-compilation is just "a toolchain file that mentions a
  different architecture." No special form needed.

---

## 7. C++ library attached to C#

**Method:** `cmake`, with an install step

### Tier 3 — cmake with install

+++
─ cmake ───────────────────────────────────
Source dir  [ .                                 ]
Build dir   [ build                             ]
Generator   [ inherit: Ninja              ▾ ]
Build type  [ Release                    ▾ ]
Toolchain   [ (none)                    ▾ ]
CMake       [ inherit: /usr/bin/cmake   ↻ ]

After build:
  Install artifacts to  [ ../app/bin/Debug/net8.0/ ]
  ☑ Only install on successful build
  ☑ Install after every build (skip if artifacts unchanged)
+++

**Notes.**
- A C++ library that C# consumes is a `cmake` method with an
  **install step** tacked on. The install step is not a separate
  Configuration — it's a flag on this one.
- `Install artifacts to` is a path relative to the project folder,
  clamped inside the loaded solution's root (Stage A's rule).
- When the C# project's `.csproj` declares a `<NativeLibrary
  Include="libfoo" />`, Craidd can *suggest* the install path. It
  reads the `Include` attribute, matches it to a filename that some
  C++ configuration produces, and proposes "install `libfoo.so` next
  to `App.dll`."
- It's a suggestion, not a rule. The user confirms. If they override,
  their word wins.
- This is a Phase 3 feature — the install step is the seed of the
  full `[[config.step]]` composer we sketched in
  `docs/craidd-cln-model.md`. For Phase 2.3.3 the field is present
  and editable but the runner does not yet execute install steps.

---

## 8. C# ASP.NET

**Method:** `dotnet`

### Tier 3 — dotnet (web)

+++
─ dotnet ──────────────────────────────────
Project     [ Api/Api.csproj                    ]
Configuration [ Debug                    ▾ ]
Framework   [ inherit: net8.0            ▾ ]
Runtime ID  [ inherit: linux-x64         ▾ ]
Launch      [ Properties/launchSettings.json ▾ ]
URL         [ https://localhost:5001            ]
Dotnet      [ inherit: /usr/bin/dotnet  ↻ ]
+++

### Full dialog

+++
┌─ Configurations ──┬─ Api (Debug) ─────────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Api (Debug)                ]  │
│   · Release       │  Kind      [ run                      ▾ ]  │
│ Frontend (Vite)   │  Target    [ Api/Api.craidd             ]  │
│ Native Lib        │  Method    [ dotnet                   ▾ ]  │
│ Api (Debug)   ▶   │  cwd       [ (default: Api/)            ]  │
│                   │                                            │
│ [+ New ▾]         │  ─ Common ──────────────────────────────  │
│ [⧉ Duplicate]     │  Profile   [ Debug                    ▾ ]  │
│ [- Remove]        │  Args      [                            ]  │
│                   │  Env       [ ASPNETCORE_ENVIRONMENT=Development ] │
│                   │                                            │
│                   │  ─ dotnet ──────────────────────────────  │
│                   │  Project   [ Api/Api.csproj             ]  │
│                   │  Framework [ inherit: net8.0       ▾ ]     │
│                   │  Runtime   [ inherit: linux-x64    ▾ ]     │
│                   │  Launch    [ (default)             ▾ ]     │
│                   │  URL       [ https://localhost:5001     ]  │
│                   │  Dotnet    [ inherit: /usr/bin/...  ↻ ]    │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  dotnet run --project Api/Api.csproj     │
│                   │      --configuration Debug                  │
│                   │      --framework net8.0                     │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- `Configuration` is the .NET SDK's `Debug`/`Release`/custom, read
  from `<Configurations>` in the `.csproj`. It's the same concept as
  Cargo's `Profile`, just named differently by the .NET SDK.
- `Launch` reads `Properties/launchSettings.json` and populates the
  dropdown with the profiles it declares.
- The `Sdk="Microsoft.NET.Sdk.Web"` attribute in the `.csproj` is
  what makes Craidd infer an ASP.NET project and pre-fill the URL
  field. For a plain `Microsoft.NET.Sdk`, the URL field is hidden.

---

## 9. C# .NET GUI

**Method:** `dotnet`

On Linux, "GUI" means **Avalonia** or **GTK#**. WPF and WinForms are
not options — this is a Linux-native IDE. The form is identical to
C# ASP.NET with three fields removed (no URL) and one added (GUI
framework hint, read-only from the `.csproj`).

### Tier 3 — dotnet (GUI)

+++
─ dotnet ──────────────────────────────────
Project     [ App/App.csproj                    ]
Framework   [ inherit: net8.0            ▾ ]
Runtime ID  [ inherit: linux-x64         ▾ ]
UI toolkit  Avalonia 0.11  (read from .csproj)
Dotnet      [ inherit: /usr/bin/dotnet  ↻ ]
+++

**Notes.**
- The UI toolkit row is a *read-out*. We don't offer a choice;
  the `.csproj` already declares which one it uses
  (`<PackageReference Include="Avalonia" />`, or `GtkSharp`).
- The rest is identical to C# ASP.NET. The Method dispatch picks the
  same `dotnet` form; only the field-visibility rules differ.
- Linux-native means we never show a "Target framework: net48" or
  a WinForms/WPF hint. Those would be lies.

---

## 10. Python Application

**Method:** `python`

### Tier 3 — python

+++
─ python ──────────────────────────────────
Interpreter [ inherit: /usr/bin/python3  ↻ ]
Entry       [ main.py                          ]
Module      [ (none)                     ]     ← alt to Entry
Package mgr [ inherit: uv               ▾ ]
Venv        [ .venv                      ]     ← detected or set
+++

### Full dialog

+++
┌─ Configurations ──┬─ Tool (Debug) ────────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Tool (Debug)               ]  │
│   · Release       │  Kind      [ run                      ▾ ]  │
│ Frontend (Vite)   │  Target    [ tool/tool.craidd           ]  │
│ Native Lib        │  Method    [ python                   ▾ ]  │
│ Tool (Debug)  ▶   │  cwd       [ (default: tool/)           ]  │
│                   │                                            │
│ [+ New ▾]         │  ─ Common ──────────────────────────────  │
│ [⧉ Duplicate]     │  Profile   [ Debug                    ▾ ]  │
│ [- Remove]        │  Args      [ --verbose                  ]  │
│                   │  Env       [ LOG_LEVEL=DEBUG            ]  │
│                   │                                            │
│                   │  ─ python ──────────────────────────────  │
│                   │  Interpreter [ inherit: /usr/bin/...  ↻ ]  │
│                   │  Entry     [ main.py                     ]  │
│                   │  Module    [ (none)                      ]  │
│                   │  Pkg mgr   [ inherit: uv           ▾ ]     │
│                   │  Venv      [ .venv                       ]  │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  .venv/bin/python main.py --verbose      │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- `Entry` and `Module` are mutually exclusive: you run a script or
  you run a module (`python -m foo`), not both. The UI enforces it
  by clearing one when the other is set.
- `Profile` is `debug`/`release`, mapped to
  `PYTHONASYNCIODEBUG=1` / nothing, plus `-O` / `-OO` when release.
  There's no universal Python convention, so the profile is
  lightweight — mostly env.
- `Venv` is detected by finding `.venv/`, `venv/`, or `env/` in the
  project folder. If found, the interpreter path uses it
  automatically; `Interpreter` then shows the venv's Python, not the
  system one.
- `Package mgr` is inherited from preferences. `uv` is preferred
  over `pip` when present.

---

## 11. Python Server

**Method:** `python`

Functionally identical to Python Application. The fields are the same.
Only the *values* differ — usually the entry point is
`server.py` or `-m uvicorn`, and env vars carry host/port.

### Full dialog — field values, not new fields

+++
┌─ Configurations ──┬─ Server (Cloud) ───────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Server (Cloud)             ]  │
│   · Release       │  Kind      [ run                      ▾ ]  │
│ Frontend (Vite)   │  Target    [ server/server.craidd       ]  │
│ Native Lib        │  Method    [ python                   ▾ ]  │
│ Tool (Debug)      │  cwd       [ (default: server/)         ]  │
│ Server (Cloud) ▶  │                                            │
│                   │  ─ Common ──────────────────────────────  │
│ [+ New ▾]         │  Profile   [ Cloud                    ▾ ]  │
│ [⧉ Duplicate]     │  Args      [ --workers 4                ]  │
│ [- Remove]        │  Env       [ HOST=0.0.0.0               ]  │
│                   │            [ PORT=8080                  ]  │
│                   │            [ LOG_LEVEL=info             ]  │
│                   │                                            │
│                   │  ─ python ──────────────────────────────  │
│                   │  Interpreter [ inherit: /usr/bin/...  ↻ ]  │
│                   │  Entry     [ (none)                      ]  │
│                   │  Module    [ uvicorn app:app --host ...  ]  │
│                   │  Pkg mgr   [ inherit: uv           ▾ ]     │
│                   │  Venv      [ .venv                       ]  │
│                   │                                            │
│                   │  Will run:                                 │
│                   │  $  .venv/bin/python -m uvicorn app:app --host 0.0.0.0 ... │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- Zero new fields compared to Python Application. This sketch exists
  to make that explicit.
- **`Profile` here is doing a different job than in Cargo.** In Cargo,
  `release` is a build flag. Here, `Cloud` is a *deployment target*
  that changes env vars and args, not the build. The `Profile` shape
  (name + args + env) covers both. That's why it's Common, not
  method-specific.
- The user authored three profiles: `Local`, `Cloud`, `Production`.
  Inference produces only `debug` and `release` for Python, and the
  user extends the set. That's the point of Tier 3 editing profiles.

---

## 12. Python ML (training)

**Method:** `python`

Forward-looking. Not Phase 3. Included so the shape is on record.

+++
┌─ Configurations ──┬─ Train (GPU) ──────────────────────────────┐
│ Tauri Dev         │                                            │
│ Rust              │  ─ Universal ───────────────────────────  │
│   · Debug         │  Name      [ Train (GPU)                ]  │
│   · Release       │  Kind      [ train                    ▾ ]  │
│ Frontend (Vite)   │  Target    [ train/train.craidd         ]  │
│ Native Lib        │  Method    [ python                   ▾ ]  │
│ Train (GPU)   ▶   │  cwd       [ (default: train/)          ]  │
│                   │                                            │
│ [+ New ▾]         │  ─ Common ──────────────────────────────  │
│ [⧉ Duplicate]     │  Profile   [ GPU                      ▾ ]  │
│ [- Remove]        │  Args      [ --config configs/base.yaml ]  │
│                   │  Env       [ CUDA_VISIBLE_DEVICES=0     ]  │
│                   │            [ OMP_NUM_THREADS=8          ]  │
│                   │                                            │
│                   │  ─ python ──────────────────────────────  │
│                   │  Interpreter [ inherit: /usr/bin/...  ↻ ]  │
│                   │  Entry     [ train.py                   ]  │
│                   │  Module    [ (none)                     ]  │
│                   │  Pkg mgr   [ inherit: uv           ▾ ]     │
│                   │  Venv      [ .venv                       ]  │
│                   │                                            │
│                   │  ─ training (future) ───────────────────  │
│                   │  Metrics socket [ :9180              ]     │
│                   │  Checkpoint dir [ checkpoints/       ]     │
│                   │  The bottom panel will show live loss       │
│                   │  curves and model state while running.      │
│                   └────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────┘
+++

**Notes.**
- The only new fields versus Python Application are inside a
  future training section (`Metrics socket`, `Checkpoint dir`). The original
  Phase 2.3.3 form doesn't render them — the section is documented here so
  the shape is on record.
- Kind is `train`, a new kind alongside `run`, `build`, `debug`,
  `test`. Future, unassigned work.
- The bottom panel gains a "Training" tab when a `kind = "train"`
  configuration is running. That's the whole ML workflow on the
  record, without committing to build it now.

---

## What the sketches reveal

Reading the twelve side by side, three things become obvious:

### 1. It's seven methods, not twelve

`cargo` (twice), `npm` (twice), `dotnet` (twice), `cmake` (three
times), `shell` (once), `composed` (once), `python` (three times).
The remaining variation is field *values* and per-method
*field-visibility rules*, not new forms.

### 2. Universal and Common really are universal and common

Every sketch above has the same first five fields and the same
next three. Not one of the twelve required a different Tier 1 or
Tier 2 shape. That's the design holding.

### 3. The interesting variations are all in Tier 3

- Cargo's real value-add: `Package`, `Bin`, `Features`, `Target`.
- CMake's real value-add: `Generator`, `Build type`, `Toolchain
  file`, and the install step.
- dotnet's real value-add: `Framework`, `Runtime ID`, `Launch`.
- Python's real value-add: `Interpreter`, `Venv`, `Entry` vs `Module`.

Everything else is shared.

---

## What this document does NOT decide

- **The exact spacing and visual weight** of the three sections.
  That's 2.3.3.3 (the toolbar and dialog restyle), and it's a
  separate sketch.
- **Whether the tree shows profiles as children or as a second
  column.** Still under discussion. The sketches above use child
  rows because that's the current leaning.
- **How per-method inference interacts with user overrides.** The
  inference layer produces `origin = "inferred"` entries; the user
  editing an inferred entry in the dialog flips it to `origin =
  "user"`. The precise interaction (does the field change in place,
  or is a copy created?) is a 2.3.3.4 concern.
- **The composed step editor's visual form.** The sketches show a
  list with `[✎] [✕]` per row. The inline editor that `[✎]` opens
  is a separate design.

---

## What this document DOES decide

- **The three-section form is the shape.** Universal, Common, Method.
  Every Configuration, every method, without exception.
- **Seven method components.** Cargo, npm, dotnet, cmake, shell,
  composed, python. Nothing else in Phase 2.3.3.
- **The `Profile` concept is method-shaped but universally common.**
  Cargo's release, dotnet's Configuration, Python's Cloud/Local —
  they're all the same shape (name + args + env) and belong in
  Common, not Method.
- **Toolchain paths are inherited, shown inline, overridable per
  Configuration.** Same shape everywhere: an italic placeholder
  showing the inherited value, and a `↻` button to override.
- **The "Will run" preview is part of the form, not a separate
  view.** The user always sees the resolved command.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
