# Build Order Lab

A small, real C++ → C# → Tauri V2 application. The desktop window asks the ASP.NET
API for `20 + 22`; the API calls a C++ shared library and returns **42**.
There are no shell orchestration scripts.

## Try it in Craidd

Restart Craidd with this branch's backend, then open `build-order-lab.cln`.

1. Open **Configurations → Prepare application** to inspect the numbered steps:
   **Build API → Build Native → Install Native into API output**.
2. Select **API · Local** in one linked IDE window and **Tauri · Development**
   in another. Both windows must have this solution open.
3. Click the gold **Linked Run** or **Linked Debug** action. Review the plan.
   Stage 1 prepares and launches the API, then waits for `/health` to succeed.
   Only then does stage 2 launch Tauri. Its native debug path also starts Vite
   and waits for the frontend listener before launching the debugger.
4. The desktop window should show **42**. In debug mode, set a C# breakpoint
   in `Api/Program.cs`, then use the window's **Try again** button.

For build-only verification, select **API · Local** and click **Build**.
The Output pane shows each build/install step and its result. A failed step
prevents subsequent steps; Stop cancels preparation and its subprocesses.
The first Tauri compilation can take several minutes. You can select
**Tauri · Development → Build** once before trying the linked debug launch.

## Prerequisites

- .NET 10 SDK and runtime (the installed version on this development machine).
- CMake and a C++ compiler.
- Node/npm, Rust, and normal Tauri V2 Linux system dependencies.
- `netcoredbg` for C# debugging; `lldb-dap` for the Tauri Rust process.
- Run `npm install` in `Client/` once. Cargo restores its own dependencies.

Ports: API **5187**, frontend **1545**. Stop other listeners on these ports
before trying the demo. Existing API/frontend processes are not proof that
the new linked sessions own those listeners.

## What is actually controlled

`Prepare application` is a saved build-order configuration, not a process.
Run and Debug both reference it through `order.before`, avoiding duplicated
steps. The API is built first deliberately, as requested, although this
particular P/Invoke example could build its native library first instead.

The native project declares CMake's standard `install(TARGETS ...)` rule.
Craidd asks MSBuild for the API's actual `TargetPath`, then supplies that
directory to `cmake --install`. It does not hard-code `net10.0`, guess a
library filename, or move away the original library. The API launches that
prepared DLL without rebuilding after installation.

Tauri's `linked.after` names the API project. The API's `ready_url` describes
when it is usable. **Build success and server readiness are separate gates.**
The native library has no extra running or debugging window: it is loaded by
the API. Native debugging inside the C# process is not implemented by this demo.

This is a focused prototype: ordered builds support .NET, CMake, and Cargo;
artifact installation supports CMake → .NET. Preparation is serialized across
sessions, and linked launches use dependency stages. Python/Electron adapters,
general artifact destinations, and a Create Project Wizard are future work.

Backend acceptance test (from the repository root):

```console
cargo test --manifest-path src-tauri/Cargo.toml build_order_lab_real_tools -- --ignored --nocapture
```

It runs the same coordinator used by Run/Debug, installs the library, starts the
API on a temporary port, and checks that `/health` really calls C++ and returns 42.
