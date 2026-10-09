# Installed LLDB native thread-control experiment

This branch tests one source step on a selected Rust, C++, or C worker while
the installed LLDB-DAP owns the process. It does not include or download a
debugger. The current gate is deliberately limited to LLDB-DAP 23.1.1 with
LLDB Python scripting enabled, on Linux. This branch also tests the same
owner session when Rust is linked to a C or C++ library view.
Craidd's normal Step remains available on other debugger builds, with its
existing session-wide behavior.

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
python3 probe.py cpp
python3 probe.py c
python3 blocked_probe.py
+++

The probes require the operating system to permit LLDB to trace its child.
They write their evidence under ignored `.runs/probes/`. The C source fixture
uses the current CMake/C++ project route because Craidd does not yet have a
separate C project language or debug method. The compiled program is C.

## Try the Craidd desktop control

1. Launch this branch of Craidd Studio and open `thread-control.cln`.
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
address fixed during selected-thread steps. The linked Native view and ⇥
together are new on this branch and need a Craidd desktop run. Record source
line, selected thread, both counters, and any hold or release error.
