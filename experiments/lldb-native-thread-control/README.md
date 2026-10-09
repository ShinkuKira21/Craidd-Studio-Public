# Installed LLDB native thread-control experiment

This branch tests one source step on a selected Rust, C++, or C worker while
the installed LLDB-DAP owns the process. It does not include or download a
debugger. The current gate is deliberately limited to LLDB-DAP 23.1.1 with
LLDB Python scripting enabled, on Linux, in an ordinary unlinked session.
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

This experiment excludes managed C#, linked LDI sessions, source-less
frames, and indefinite per-thread Continue. A successful direct probe is
not desktop acceptance. Record any mismatch before changing implementation.
