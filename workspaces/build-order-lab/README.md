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
For the original API + Tauri run/debug arrangement, the native library is loaded
by the API; it has no separate running window. The optional LDI arrangement below
instead gives the library its own native reproduction in a partner window.
Neither arrangement implements native debugging inside the C# process.

## Try held LDI debugging

For the first GUI-driven LDI test, open
[LDI GUI Lab](../ldi-gui-lab/README.md) instead: it has only C# GUI + C++ library,
and its button triggers the call directly. The full three-window Tauri + API +
library LDI arrangement is **not supported yet**; a Gold count of two there
reflects the library being excluded, not a working three-project session.

Use this same solution and its ordinary C# API / C++ shared library. No test
hooks, hand-written driver, Python or capture files are needed in these projects.

1. Restart Craidd with this branch's backend. Open `build-order-lab.cln`.
2. Use **two linked IDE windows** for this solution: select **API · Local** in A
   and **Native · LDI** in B. B's Power configuration has a Build slot targeting
   the CMake shared library; it does not pretend the library is an executable.
   For this first slice, don't select Tauri in a third linked window: pairing
   currently requires exactly two selected project windows.
3. In B expand **C++ Math Library** and open `math.cpp`. Put a normal red
   breakpoint on `return left + right;` inside `order_add`.
4. In A open `Api/Program.cs`. Right-click the gutter on
   `int result = NativeMath.Add(left, right);` and choose
   **Native Debugging Breakpoint → CS…** for B. This is the call site, not the
   `DllImport` declaration. Arguments here are ordinary `int` endpoint parameters.
5. Press **Gold Linked Debug** and confirm the plan. The IDE prepares the
   shared library and API; B waits for the blue call. `/health` does not hit blue.
6. Once A is listening, open `http://127.0.0.1:5187/sum/20/22` in a browser.
   A stops at blue and holds the pending request. The IDE generates a small
   native driver, and B stops in the real `math.cpp` with `left=20`, `right=22`.
7. Debug in B. Continue B to completion to release A and return focus to A.
   A then executes its own original call; the browser receives `{"value":42}`.
   Reload that URL to exercise another call.

White Debug does not activate LDI. A's Continue/Step controls are held until B
releases the call. B's debugger changes/return value are not copied into A.
On B failure A stays stopped; use B's explicit **Abandon B and continue A** or
Gold Stop. Long pauses can time out the browser request. Blue bindings are
session-only and must be recreated after reopening.

The debugger-level API/library path has an automated acceptance test, but the
two-window renderer flow still needs a manual visual check. Internal tests and
their reports live under `tests/fixtures/ldi-gate-0`, outside this workspace.

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
