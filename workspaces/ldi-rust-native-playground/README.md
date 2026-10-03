# Rust + C++ Native Playground

Open [ldi-rust-native-playground.cln](ldi-rust-native-playground.cln) in Craidd.
The two Power Configs are **Rust · Local** (application) and **Native · Scalar**
(C++ shared library). This is a Linux/ChromeOS Linux fixture using Rust 2024
(rustc >= 1.85), Cargo, CMake, a C++17 compiler and LLDB-DAP. It has no Cargo
dependencies and builds offline.

It proves that Rust can call C++ in its original process and LLDB can debug
both sides. There is no managed LDI capture, generated driver, interposer or
separate reproduction process. The native library exposes `demo_add` and
`demo_accumulate`; the latter mutates Rust's original borrowed buffer. This
pointer case works precisely because debugging stays in the caller's process.

## Implemented workflow

Rust Native Breakpoints now pair the caller with a visible Native window.
A verified native stop reveals/focuses B and publishes source, stack and locals
there. B's Step/Continue/Stop controls operate A's existing LLDB session, not a
second debugger. Each window retains its own Power Config and project tree;
A's Rust editor is not replaced by the C++ stop. There is no held-A reproduction
phase, though the original process is naturally paused while stopped in C++.

Ordinary red debugging without a Native pairing still reveals native stops in
the session-owning Rust window. A library has no standalone debug executable.
Rust pairing does not invoke the C# capture provider. See
[the design and current limits](../../docs/feats/ldi-debugging/design-ldi-debugging-rust.md).

## Manual two-window acceptance

The backend, frontend routing tests and real LLDB probe pass. The following
desktop focus/reveal checklist still needs a manual run on your compositor.

1. Open the solution in A and select **Rust · Local**. Duplicate the window
   into B, selecting **Native · Scalar** there. A owns Cargo/Run/Debug; B owns
   CMake and the native source. Keep both windows visible.
2. In A, open `Rust/src/main.rs`. At `// RUST_CALL_ADD`, choose the blue
   **Native Debugging Breakpoint** and pair with B. Start with no C++ reds.
   If B is not open, selecting its Power Config from the breakpoint menu
   opens a visible Native window.
3. Press **White Debug in A**. The saved preparation configures/builds CMake;
   Craidd then builds Cargo and launches the original Rust program under LLDB.
4. Expect the first visible stop inside `demo_add`, with B focused on
   `Native/scalar.cpp`, `left = 20`, `right = 22`, and a Rust `call_add` frame
   below it. A remains on its Rust editor and reports paused in native code.
   Check that A still selects **Rust · Local**, B **Native · Scalar**.
5. Step Over in B, then Step Out: return to Rust and focus A. Continue to see
   `scalar: 20 + 22 = 42`, followed
   by `borrowed buffer: [6, 7, 8], sum = 21`. There must be no driver capture.
6. Restart with a blue at `// RUST_CALL_BUFFER` to inspect the real buffer
   pointer, `count = 3`, `delta = 5`, and Step Out to see the changed Rust storage.
7. With a blue still present, set a red inside its C++ export and restart.
   The red owns the landing, including its condition; there is no additional
   unconditional automatic entry for that export. Bookmark/landing changes
   during a run require a restart. Blue conditions are not supported for Rust.
8. At a native pause, close B: A stays alive and can continue local debugging.
   Private entries detach, solution reds survive. Native rebuilds remain
   blocked until the Rust adapter ends, even after B closes.
9. Reopen B, re-pair and restart. **Stop in B** must terminate the original Rust
   session. Build/Run in B while bound must be refused, not rebuild a loaded `.so`.
10. Remove the blues and restart with a Rust red at `// RUST_CALL_ADD`, then
    Step Into, or a C++ red at `// NATIVE_ADD_ENTRY`. Without pairing, the source
    and stack are shown in A as ordinary mixed debugging.

Gold Build can coordinate projects; this library does not gain a standalone
process through Gold Debug. Use White Debug in A for this acceptance test.
Stopping the Rust session stops its original program, not a disposable replay.

## Build and test without the IDE

From this workspace directory:

```bash
cmake -S Native -B Native/build -DCMAKE_BUILD_TYPE=Debug
cmake --build Native/build --target demo_scalar --config Debug
cargo run --offline --manifest-path Rust/Cargo.toml -- 20 22
cargo test --offline --manifest-path Rust/Cargo.toml
python3 tools/native_debug_probe.py
```

The probe builds both projects, runs the three ABI tests, then checks five cases:

- A Rust call-site stop, Step Into to C++, and Step Out back to Rust.
- A direct native-only stop, with a Rust caller in the same native stack.
- A stop on the borrowed-buffer call, native argument values, and real mutation.
- Private C++ entry stops for scalar and buffer calls, without a Rust call-site stop.

Each case uses one adapter and the original Rust executable. It records DAP
transcripts and `summary.json` beneath a unique `.validation/` directory.
The probe reuses the repository's DAP client and requires this checkout.
Choose another adapter with `--lldb-dap /absolute/path/to/lldb-dap`.
See [VALIDATION.md](VALIDATION.md) for the recorded outcome and its limits.

`Rust/build.rs` configures native linking and a development-only absolute
rpath; it does not invoke CMake or generate a driver. Rebuild after moving the
checkout. Native must be built before standalone Cargo commands; the Power
Configs express this dependency without shell wrappers. The debug config
prepares Native only because Craidd itself builds the Rust debug executable.
Native's direct CMake Build slot declares **Prepare Native** as its prerequisite,
so White Build also works from a clean tree. Do not replace that slot with a
plan-only slot: pairing needs the concrete selected target and build directory.

The initial recognizer supports saved direct calls to same-file `extern "C"`
declarations (including simple `link_name` aliases), one FFI call per line, and
one explicit C++ `extern "C"` definition in the selected CMake shared-library
target. Indirect calls, macros, static libraries, copied/installed artifacts,
callbacks, optimized code and multithreaded call arbitration are not qualified.
Native Breakpoints are app/window-scoped and must be re-paired after reopening.

The current shared-library design question—Rust and C# both using Native
Scalar in three IDE windows—is recorded separately in
[Shared native consumers](../../docs/feats/ldi-debugging/design-native-shared-consumers.md).
