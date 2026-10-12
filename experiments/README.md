# Step by Thread experiments

Craidd's ordinary thread selector lets you inspect a reported thread and aim
Step at it. The experimental **⇥ Step selected thread only** control tries to
advance one selected thread by one source-level Step Over while other known
threads remain held. Use it only at an all-thread stop with a source line for
the selected thread. Ordinary Step and Continue retain the debugger's normal
execution scope.

These experiments test two different debugger routes:

| Route | Open in Craidd | Debugger | What ⇥ can control |
| --- | --- | --- | --- |
| [Rust, C and C++](lldb-native-thread-control/README.md) | [`lldb-native-thread-control/thread-control.cln`](lldb-native-thread-control/thread-control.cln), then **Rust Exclusive Step**, **C++ Exclusive Step** or **C Exclusive Step** | Installed `lldb-dap` with LLDB scripting; tested on Linux with 23.1.1 | One native thread in the LLDB-owned process. The C fixture uses Craidd's current CMake/C++ project route. |
| [C#](netcoredbg-thread-control/README.md) | [`netcoredbg-thread-control/thread-control.cln`](netcoredbg-thread-control/thread-control.cln), then **C# Exclusive Step** | Tracked patched Linux x64 `netcoredbg` experiment build | One managed thread in the C# process. The installed stock `netcoredbg` used in these tests keeps ordinary Step and does not offer this experimental control. |

The C# patch is tracked as
[`netcoredbg-exclusive-step.patch`](netcoredbg-thread-control/netcoredbg-exclusive-step.patch)
against the [current Samsung release used for this build](https://github.com/Samsung/netcoredbg/releases/tag/3.2.0-1092).
The [patched Linux x64 executable and companion files](netcoredbg-thread-control/debugger/linux-x64/BUILD.md)
are also tracked in this experiment. They are not placed in the app bundle or
selected automatically. Choose that executable in **File → User Preferences →
Toolchain → C# → Debugger** for C# ⇥. Use the
[C# rebuild instructions](netcoredbg-thread-control/README.md#build-the-optional-adapter-locally)
for another build; scratch source and output under `.local-tools/` remain
ignored. Choose **Automatic** again to return to your installed debugger. An
adapter advertising standard
DAP `supportsSingleThreadExecutionRequests` has a separate experimental
path, but no adapter has been qualified here merely by advertising it.

## First desktop check

1. Install the language toolchains and adapters described in the linked
   experiment guide. From the repository root run `npm install`, then
   `npm run tauri dev`.
2. Open one of the `.cln` solutions above, choose its **Exclusive Step** Power
   Config, and set a red breakpoint at the guide's `BREAK_` source comment.
   Start **White Debug**. Check the selected debugger executable in
   Preferences if ⇥ is absent.
3. At a stop where both workers are reported, select worker 1. Note both
   worker counter files, use ⇥ until worker 1's write executes, and check
   that worker 2's counter and source position did not advance. Repeat with
   worker 2 selected. The first Step may reach a write line before its file
   changes. Ordinary Continue should let both workers finish.
4. Record the selected thread ID, source line, both counter values before and
   after each Step, debugger executable/version, and any Debug Output error.
   A paused dropdown timer alone does not establish isolation. If a selected
   thread has no source line, ⇥ may be unavailable. If a step blocks on a held
   worker, use Pause and the guide's recovery action or Stop.

The [native guide](lldb-native-thread-control/README.md) gives the Rust/C/C++
counter paths and direct LLDB probes. The [C# guide](netcoredbg-thread-control/README.md)
gives the local adapter build, C# counter paths, direct DAP probes and recovery
steps. Direct probes are supporting evidence; the live Craidd UI and counters
must be checked separately. Results and open release gates are recorded in the
[MT desktop checklist](../docs/feats/mt-debugging/tests/checklist.md).

## Linked native windows

Both solutions also have linked Rust→C/C++ or C#→C/C++ Power Configs. In the
Rust case, window A owns one LLDB process and B is a view of its native
threads; use **White Debug in A**. In the C# LDI case, A's managed process and
B's native reproduction are separate debugger sessions; start their pairing
with **Gold Linked Debug**. ⇥ in B targets a native thread in B's process, not
the held managed caller in A. The optional patched `netcoredbg` affects only
managed ⇥ in A. Follow each guide's Blue breakpoint and counter instructions
before comparing the two windows.

This is bounded experimental behavior, not a guarantee of independent
stepping for every program, adapter version, newly created thread, or blocking
wait. Keep the debugger route, owning process and observed counters explicit
in a test report.
