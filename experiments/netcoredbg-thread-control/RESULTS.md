# C# thread-control experiment results

This record separates the direct adapter probe from the Craidd desktop test.
The experimental binary is local and ignored by Git. Record its path and
version for each desktop run so results can be reproduced.

| Date | Surface | Scenario | Result | Evidence |
| --- | --- | --- | --- | --- |
| 8 October 2026 | Direct patched netcoredbg DAP | Step worker A twice, switch to B, then Continue | Passed; unselected worker's file counter stayed unchanged during each Step | [`evidence/step-switch.dap.jsonl`](evidence/step-switch.dap.jsonl) |
| 8 October 2026 | Direct patched netcoredbg DAP | Pause from blocked managed lock wait; release and Continue | Passed | [`evidence/blocked-pause.dap.jsonl`](evidence/blocked-pause.dap.jsonl) |
| 8 October 2026 | Direct patched netcoredbg DAP | Stop during active lease | Passed | [`evidence/blocked-stop.dap.jsonl`](evidence/blocked-stop.dap.jsonl) |
| 8 October 2026 | Relocated experiment project and local adapter | A/B Step, blocked Pause/release, active-lease Stop | Passed from experiment paths | Fresh traces under ignored `.runs/probes/` |
| 8 October 2026 | Restored local adapter on `dep/mt-debugging-thread-control` | Direct DAP Step worker 2 twice, switch to worker 1, Continue | Passed; worker 1 stayed at 0 during worker 2's steps, and worker 2 stayed at 1 during worker 1's step | Ignored `.runs/probes/craidd-exclusive-step-6t3m5z_u/`; output recorded in this session |
| 8 October 2026 | Solution TOML and ordinary .NET run | Checked original `thread-control.cln` structure; both worker counters reached 200 | Passed outside Craidd | Earlier `CSharpExclusiveStep/.runs/basic/` (hidden and ignored); later lab config writes visible `runs/basic/` |
| 8 October 2026 | Craidd desktop, user report | Step one worker while watching the other worker's dropdown timer | UI observation only: the other timer stopped during **Step This Thread Only**; switching to another worker for stepping remained unavailable when it had no source line | User screenshot and report in this chat; counter files and Debug Output were not supplied |
| 8 October 2026 | Direct patched netcoredbg DAP | Select a worker paused in `System.IO.PathInternal.RemoveRelativeSegments()` with no source line; request one-thread Step | `craiddExclusiveNext` rejected with `0x80004005`; arbitrary source-less switching is unproved | [`evidence/source-less-switch.dap.jsonl`](evidence/source-less-switch.dap.jsonl) |
| Pending | Craidd desktop on `feat/mt-debugging-control` | Step A, switch to B at a source breakpoint, then Step B | Fresh combined-branch A/B counter evidence not yet recorded | Record requested and stopped thread IDs, both worker counters, adapter path, and Debug Output here |

The user's later screenshots show Craidd selecting and stepping each worker at
source lines. That establishes the desktop control path for both threads. The
old `.runs/basic/` counters existed on disk but were hidden from Craidd File
Discovery; both were `1` when inspected after the screenshots. Without values
captured before and after each Step, this does not establish that the
unselected worker remained still during the other worker's Step.

The direct probe does not establish product acceptance. The dropdown timer
tracks debugger-observed running time, not actual worker execution. The user's
timer observation does not prove desktop isolation; compare both worker counter
files across each Step. A desktop result should also say whether the
selected worker had a source line, whether the special control appeared, and
what happened after Pause or Continue.

The isolated `dep/` branch passed `npm run build`, `cargo check`, and the
direct patched-adapter probe. The combined branch has passed frontend and
Rust checks, but has no fresh Craidd desktop C# run. The standard DAP
`singleThread` route also has no qualified adapter or live result yet.

# Cross-language extension — 9 October 2026

The new `LinkedCSharpStep` program and both C/C++ shared libraries build.
Direct uninstrumented execution completed both native variants with managed
worker counters `1040/2040`. Source-recognition checks identify both Blue
call sites, the C export without C++ linkage syntax, and the C++ export.
The two-process LDI reproduction and ⇥ in its native partner remain to be
checked in Craidd desktop. The local patched netcoredbg binary was absent,
but that binary is not needed for ⇥ in B's LLDB process.

The C# fixtures already create two managed caller threads and two native
workers per reproduced call. On this branch, B's native workers also write
per-thread counters under its `Native/runs/` directory. The new files make
the requested C# Threads→C/C++ Threads test observable, but no desktop
before/after counter or thread-switch report exists yet.

Standalone LLDB-DAP partner probes passed for C and C++: one native worker's
counter advanced while the other stayed fixed, then both reached 20 after
release. Traces are in ignored `.runs/probes/native-c-p2gr197m/` and
`.runs/probes/native-cpp-2eu61bbs/`. This validates the native mechanism
outside LDI; Gold Debug, A's managed ⇥ and B's paired ⇥ still need desktop
acceptance. The C# experiment program itself completed both variants with
each native counter at 20.
