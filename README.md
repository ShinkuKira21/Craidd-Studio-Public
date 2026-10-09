# Craidd Studio

**Alpha preview · Linux-targeted polyglot IDE**

Craidd Studio brings the projects in a solution into one place while letting
each running program have its own IDE window. Edit source, choose a project
configuration, build or debug it, then link windows when the work crosses
process or language boundaries. The interesting case is a client, an API and a
native library that you want to see *together*, without losing track of which
process owns which debugger.

This is an early alpha. The debugger and window workflows are useful to try,
but [acceptance work is still in progress](docs/roadmaps/Roadmap-v0.0.4A.md).
Expect to install the language toolchains and debugger adapters used by the
projects you open; Craidd discovers external tools rather than bundling them.

## Platform and prerequisites

- **Target:** Linux. Windows may be considered later; it is not a supported
  alpha platform.
- **Reported test environments:** Arch Linux with **GNOME 51.0 on Wayland**,
  and **ChromeOS** (version not recorded). Other distributions, desktops and
  display servers have not been confirmed by this project.
- **To run Craidd Studio from source:** Rust and Cargo, Node.js and npm, and
  the Linux development libraries needed to build a Tauri 2 application.
  Both `cargo` and `npm` need to be available on your `PATH`.
- **To try the included debug labs:** install their own toolchains and
  adapters. The C# examples use the .NET 10 SDK and `netcoredbg`; Rust and
  C++ debugging use `lldb-dap`. Native examples also need CMake and a C++17
  compiler. The C++ GUI in the MT lab needs GTK4 development files.

From the repository root:

```sh
npm install
npm run tauri dev
```

`npm run build` checks and builds the frontend; `cargo test --lib` from
`src-tauri/` runs the Rust library tests. The labs can require their own first
package restore, such as NuGet packages for the Avalonia GUI or npm packages
for the Rust Tauri GUI. See each lab's README before starting it.

## How to make a project

Craidd is solution-first: everything — trees, configs, builds, debuggers —
hangs off a `.cln` solution that declares its projects. So the first thing
you do is open a folder and declare a project inside it.

**From an empty folder:**

1. **File → Open Folder…** and pick a folder (create one first if you like).
2. The Solution Explorer shows **"No solution in this folder."** Click
   **New project**.
3. Fill in the New Project dialog:
   - **Project name** — the folder name under the solution root, and the
     base name of the `.craidd` marker written inside it.
   - **Language** — Rust, TypeScript, JavaScript, Python, C++, C#, or Config.
     This is what the project's filtered tree is built from. Pick the
     language you're actually working in, not the file extension you happen
     to have on disk.
   - *(Optional)* **Create a Config project too?** — attaches a `[config]`
     facet to the same marker so JSON/TOML/YAML/INI files in the project (or
     a directory you point at) show up as a separate config tree. Useful for
     app settings, save data, toolchain configs.
   - *(Optional)* **Fine Tune after creation?** — opens the membership editor
     so you can decide, file by file, which files belong to the language tree
     and which belong to the config tree.
4. Click **Create**. Craidd writes the folder, drops a `.craidd` marker
   inside it, creates or updates the solution's `.cln`, and populates the
   project tree. The Configurations chip in the toolbar will light up with
   inferred Power Configs derived from any manifests it finds (`Cargo.toml`,
   `package.json`, `*.csproj`, `CMakeLists.txt`).

**From a folder that already has code:**

1. **File → Open Folder…** to the folder that contains the code. If Craidd
   doesn't find a `.cln`, the Solution Explorer again shows the "No solution"
   banner — but you don't need the dialog this time.
2. In **File Discovery** (the lower sidebar), right-click the folder you want
   to declare and choose **Make This a Project…**.
3. `MakeProjectDialog` opens with language detection already filled in from
   the folder contents (e.g. *"Suggested Rust: 3 .rs files"*). Confirm or
   change it, optionally attach a Config facet or Fine Tune after creation,
   and click **Create Project**. A `.craidd` is written into that folder and
   the solution is created or updated to reference it.

**After the project exists:**

- The Solution Explorer shows it with a language-filtered tree. Files that
  don't match the declared language won't appear there — use File Discovery
  if you need to see everything on disk.
- The Configurations dialog (**Configurations chip → Add / Edit
  Configurations…**) lists anything inferred from the project's manifests and
  lets you add your own named Build / Run / Debug entries.
- To add more projects to the same solution, repeat either path — the "No
  solution" banner is gone once a `.cln` exists, so use File Discovery's
  right-click menu, or **Project → Add → New Blank Project…** from the
  menu bar if you want the dialog again.

A `.craidd` marker is small on purpose — name, language, root, optional
config facet, optional membership overrides. Everything else about the
project (what it builds, how it builds, what dependencies it has) is read
from the ecosystem's own manifest at build time, never duplicated into the
marker. See [the `.craidd` and `.cln` model](docs/craidd-cln-model.md) for
the reasoning.

## Why Linked Windows?

A `.cln` solution can contain several projects. Open it with **File → Open
Solution…**, then use **File → Duplicate Window** to give another project or
another instance its own Craidd IDE window. Windows on the same solution form
a linked group, while each keeps its selected project, configuration, output
and debugger session.

The **white** Build, Run, Debug and Stop controls address one session at a
time. The **gold** controls coordinate eligible windows in the group: for
example, start an API, wait for its health endpoint, then start a client.
The [linked startup guide](docs/feats/linked-windows/linked-startup-guide.md)
shows how to set the order and readiness check.

The window tray at the upper right shows the group's IDE windows. You can
see which instance is running or paused, inspect another window's debug
context, or **Hide** an IDE window while its backend session keeps running.
**Show** brings it back; **Close** ends that instance. A program's own GUI
window is separate from these IDE windows. Shared writable editing across
window views is still being developed, so treat the window tray primarily as
a way to navigate and inspect live sessions. Read more in the
[Linked Windows design](docs/feats/linked-windows/design-linked-window-manager.md).

## Try Live Driver Injection (LDI)

LDI makes a managed-to-native call visible across linked IDE windows. A
**blue Native Debugging Breakpoint** marks the C# call site in window A. When
you start **Gold Linked Debug** and that call is reached, A holds while a
native driver reproduces the call under the debugger in window B. A **red**
breakpoint in C++ can choose where B lands. After B finishes, A makes its own
original call; B's result is not substituted into A's process.

| Start with | Open this solution | Windows and first action |
| --- | --- | --- |
| [LDI GUI Lab](workspaces/ldi-gui-lab/README.md) | [`workspaces/ldi-gui-lab/ldi-gui-lab.cln`](workspaces/ldi-gui-lab/ldi-gui-lab.cln) | A: **GUI · Local**. Duplicate the IDE window for B: **Native · LDI**. Set blue at the `NativeMath.Add` call, then use **Gold Linked Debug** and click **Call C++** in the app. The lab README gives the exact source line and optional red stop. |
| [LDI Interop Playground](workspaces/ldi-interop-playground/README.md) | [`workspaces/ldi-interop-playground/ldi-interop-playground.cln`](workspaces/ldi-interop-playground/ldi-interop-playground.cln) | A: **GUI · Local**; B: **Native · Scalar LDI**; C: **Native · Packet LDI**. Try scalar and UTF-8 packet calls, with automatic native entry or a matching red breakpoint. |
| [Rust + C++ native playground](workspaces/ldi-rust-native-playground/README.md) | [`workspaces/ldi-rust-native-playground/ldi-rust-native-playground.cln`](workspaces/ldi-rust-native-playground/ldi-rust-native-playground.cln) | A: **Rust · Local**; B: **Native · Scalar**. Use **White Debug** in A. This pairing inspects Rust's original process under one LLDB session; it does not create a second driver process. |

The playgrounds explain their own prerequisites and supported call shapes.
LDI does not replay arbitrary pointer ownership or every native call. Begin
with the GUI lab if this is your first linked debug session.

## Try multi-thread (MT) debugging

Open [`workspaces/mt-lab/mt-lab.cln`](workspaces/mt-lab/mt-lab.cln) and follow
the [Multi-Thread Lab guide](workspaces/mt-lab/README.md). It contains C#,
Rust and C++ console and GUI programs with basic, burst, handoff and native
call scenarios. Choose a console **Debug Basic** configuration, place a breakpoint
at a `BREAK_` comment, and use **Threads** beside Continue to inspect each
worker's stack, locals and source.

For MT together with managed LDI, use **C# GUI · MT + LDI** in window A and
**Native · LDI** in a linked window B. The lab guide walks through the native
worker variant and the ordered seven-caller scenario. Those seven callers
take turns; the example does not run seven independent LDI reproductions at
once. Selecting a thread chooses what to inspect and where to send Step, but
the debugger adapter may resume other threads too.

## What to expect from this alpha

Craidd currently concentrates on project and solution workflows, external
tool discovery, builds, linked windows, and C#/Rust/C++ debugging. Language
server integration, an integrated terminal, wider release validation and some
debugger lifecycle cases remain on the [roadmap](docs/roadmaps/Roadmap-v0.0.4A.md).
Use the included labs to explore the supported paths and report the exact
solution, configuration, adapter and steps when something fails.

Start with the [documentation index](docs/README.md) for the project model,
feature designs and current plans.
