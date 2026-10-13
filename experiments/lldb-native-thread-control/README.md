# Installed LLDB native thread-control experiment

This experiment tests one source step on a selected Rust, C++, or C worker while
the installed LLDB-DAP owns the process. It does not include or download a
debugger. The current gate is deliberately limited to LLDB-DAP 23.1.1 with
LLDB Python scripting enabled, on Linux. It also tests the same
owner session when Rust is linked to a C or C++ library view.
Craidd's normal Step remains available on other debugger builds, with its
existing session-wide behavior.

The [Step by Thread overview](../README.md) compares this native route with
the optional, tracked Linux x64 C# debugger route.

`thread step-over -m this-thread` alone did **not** keep another worker at
the same instruction. The experiment uses the same LLDB-DAP session's REPL
to suspend every other currently known native thread, select the requested
thread, execute one step, and resume only threads it suspended. The direct
probe checks both file counters and the unselected worker's instruction
address. It is an experiment, not a shipped capability.

## Build and direct probe

From this directory:

+++
cargo build --manifest-path RustExclusiveStep/Cargo.toml
cmake -S CppExclusiveStep -B CppExclusiveStep/build -DCMAKE_BUILD_TYPE=Debug
cmake --build CppExclusiveStep/build
cmake -S CExclusiveStep -B CExclusiveStep/build -DCMAKE_BUILD_TYPE=Debug
cmake --build CExclusiveStep/build
python3 probe.py rust
python3 probe.py rust-c
python3 probe.py rust-cpp
python3 probe.py rust-c-threads
python3 probe.py rust-cpp-threads
python3 probe_native_child.py c
python3 probe_native_child.py cpp
python3 probe.py cpp
python3 probe.py c
python3 blocked_probe.py
+++

The probes require the operating system to permit LLDB to trace its child.
They write their evidence under ignored `.runs/probes/`. The C source fixture
uses the current CMake/C++ project route because Craidd does not yet have a
separate C project language or debug method. The compiled program is C.

## Try the Craidd desktop control

1. Launch Craidd Studio from a build containing this experiment and open
   `thread-control.cln`.
2. Choose **Rust Exclusive Step** (then repeat with **C++ Exclusive Step**
   and **C Exclusive Step**). If required, select the system `lldb-dap` in
   Preferences → Toolchain. The debugger path must point to the executable,
   not to this experiment directory.
3. Open that project's `main.rs`, `main.cpp`, or `main.c` and put a red
   breakpoint on the `BREAK_NATIVE` line. Start Debug.
4. When both worker rows have appeared and are paused, select worker 1.
   Inspect its source and locals. Use **⇥ Step this thread only** twice.
   Check `runs/rust`, `runs/cpp`, or `runs/c` under the selected project:
   worker 1's text file should reach `1001`; worker 2 should remain `0`.
5. Select worker 2 and use ⇥ twice. Worker 2 should reach `2001` while
   worker 1 remains `1001`. Ordinary Continue should then let both finish.
6. Repeat with the other language configurations. Report the selected
   thread, line, both file values, and any Output-panel error. The first
   step can move to the write line without changing the file yet.

The ⇥ control is a bounded experiment on this feature branch. It holds
threads for **one step**, not indefinitely. A thread created after the hold
snapshot is outside this proof. A selected thread may wait for a lock owned by
a held thread. The blocked probe demonstrates that Pause can report an
`exception` stop, then release the holds; the interrupted step can still
finish at a later stop after Continue. Craidd provides a recovery release
action at a verified all-thread stop and Stop if release cannot be verified.
Do not use the control as a guarantee for arbitrary programs yet.

The original worker probe excludes managed C#, source-less frames, and
indefinite per-thread Continue. A successful direct probe is not desktop
acceptance. Record any mismatch before changing implementation.

## Rust calling a C or C++ library

The **Rust + C Lib** and **Rust + C++ Lib** Power Configs in the same
`thread-control.cln` build a selected shared library before Rust and then
debug the original Rust process with installed LLDB-DAP. Both worker threads
call the library. The C and C++ variants use separate exports so a Blue call
resolves to one source definition. The Native Libraries Power Config belongs
to a second Craidd window when testing the linked Native view. There is one
process and one LLDB session, so thread IDs and ⇥ belong to the **Rust owner
window**, including when the current instruction is in the library.

1. Open this solution in two windows. In A choose **Rust + C Lib**; in B
   choose **Native Libraries · Rust**. Open `RustLinkedStep/src/main.rs` in A
   and `Native/step.c` in B. Link the windows with Gold, and put Blue on
   `BLUE_RUST_C` in A. Put a red breakpoint on `BREAK_RUST` to collect both
   workers. Start Debug in A. For the C++ repeat, select **Rust + C++ Lib**,
   open `Native/step.cpp`, and put Blue on `BLUE_RUST_CPP` instead. Keep only
   the Blue for the chosen variant.
2. Select `rust linked 1` in A's thread dropdown and use ⇥. At the next
   verified all-thread stop, compare `RustLinkedStep/runs/c/worker-1.txt`
   and `worker-2.txt` (or `runs/cpp/`). Step until the selected worker's
   counter changes; the other counter should not change during those steps.
   Select worker 2 at a source frame and repeat. A source-less paused worker
   cannot be stepped with ⇥.
3. To inspect the library, put red on `BREAK_C_LIBRARY` or
   `BREAK_CPP_LIBRARY` and restart. B shows the native call under Blue;
   choose the current native thread and ⇥ in A. Verify that the other
   worker's file stays unchanged. Continue to release both threads.

Without Blue, ordinary Rust Step Into and red library breakpoints still test
the real FFI call in A. The direct DAP probes `rust-c` and `rust-cpp` each
switched from worker 1 to worker 2 and kept the other counter and instruction
address fixed during selected-thread steps. The
[desktop checklist](../../docs/feats/mt-debugging/tests/checklist.md) records
focused linked-window and native-child checks; full lifecycle and owner/worker
reversal remain open. Record source line, selected thread, both counters, and
any hold or release error.

### Rust workers that create native child workers

Select **Rust + C Threads** or **Rust + C++ Threads** to run the same Rust
caller with the `native_threads` Cargo feature. Each Rust worker calls a C or
C++ export that runs one native worker on the calling thread and creates one
native child. The Rust worker results are under
`RustLinkedStep/runs/c-threads/` or `runs/cpp-threads/`. The native worker
results are under `RustLinkedStep/runs/native-c/` or `runs/native-cpp/`:
`owner-1-worker-1.txt`, `owner-1-worker-2.txt`, and the owner-2 equivalents.

In two Craidd windows, keep **Native Libraries · Rust** selected in B. Put
Blue on `BLUE_RUST_C_THREADS` or `BLUE_RUST_CPP_THREADS` in A. Put red on
`BREAK_C_PAIR_WORKER` or `BREAK_CPP_PAIR_WORKER` in B. Start **White Debug in
A**. At a native stop, B lists the threads in A's **same LLDB session**.
Select a native worker with a source frame in B and use ⇥ to step that worker
only. Selecting in B also changes A's inspection and step target; the thread
ID distinguishes native children that inherit their Rust caller's name.
Compare the selected and sibling counters under `RustLinkedStep/runs/native-c/`
or `runs/native-cpp/` after each step. The native child can be shown in B when
its source and loaded library match the selected Native pairing, even if its
stack has no Rust caller frame. Continue and ordinary Step can resume other
threads in this shared process.
Blue markers saved under another Rust Power Config remain visible as muted
Blue markers when you switch configurations. Their tooltip names the owning
config; they do not participate in the current launch. Set Blue on the call
for the current feature selection. Click a muted marker to inspect or remove
it, or switch back to its config to reactivate it.
The [window-control friction note](../../docs/feats/ldi-debugging/linked-thread-ux-friction.md)
records this boundary.

The direct `rust-c-threads` and `rust-cpp-threads` probes passed selected
**Rust-worker** steps while native calls created and joined child threads.
The `probe_native_child.py` cases selected a real native child in the original
Rust process. A focused two-window Craidd desktop run on 12 October 2026 also
selected and stepped one native child from B for each C and C++ pairing;
the selected counter advanced while the sibling counter stayed fixed. See the
[MT checklist evidence](../../docs/feats/mt-debugging/tests/checklist.md).
