# Internal LDI debugger test fixture

This fixture exercises a real C# DllImport and a real C++ shared library on
Linux. It is a test fixture, not the application example or evidence of
usefulness on a real bug. For an ordinary application, use
[LDI GUI Lab](../../../workspaces/ldi-gui-lab/README.md).

The call counter, PID logging, checked arithmetic and `errno` changes exist
only to let tests verify what happened in each process. None is required in
developer code. Python is only the external test runner; Craidd's LDI runtime
is Rust coordinating C# and C++ debuggers and has no Python dependency.
`captures/` contains test evidence, not a project or source-code requirement.

## Optionally inspect the test fixture in Craidd Studio

1. Open `ldi-gate-0.cln`. In window A select **LDI · Host**.
2. Open a second linked window for this solution. Select **LDI · Native**
   (the native library's Build Power slot, not an executable debug config).
3. In B open `native/real.cpp`; put a normal red breakpoint at `// NATIVE_STOP`.
4. In A open `Host/Program.cs`; right-click the gutter at `// BLUE_STOP` and
   choose **Native Debugging Breakpoint → CS…**. The blue marker has an amber
   reminder if its matching native red marker is missing.
5. Press **Gold Linked Debug** and confirm the launch plan. White Debug never
   activates LDI. Gold prepares the real library, builds the host, and launches A.
6. A stops at blue. Its Debug sidebar shows `gate_add(20, 22)` and **A held at
   blue**. B launches a generated C++ driver and stops at the red breakpoint.
7. Step in B. A's Continue/Step buttons are disabled; the backend denies them
   too. Continue B to completion: A resumes automatically and focus returns to A.
   Its output eventually says `HOST result=42 … before=0 after=1`.

There is no copying B's return value or edits into A. A executes its original
call after release. Holding a server may time out client connections. B failure
keeps A stopped; B can explicitly **Abandon B and continue A**, or use Gold Stop
to terminate both. Blue bindings are session-only; recreate them after reopening.
Successful completion requires a confirmed native return, not just exit code zero.
The generated one-call mock does not cover library unloading or static destructors.

## Test without any windows

Prerequisites: .NET 10 SDK, netcoredbg, CMake, a C++ compiler, Python 3,
and lldb-dap (`lldb-dap-19` is detected on this development machine).

```bash
python3 tests/fixtures/ldi-gate-0/tools/ldi_probe.py run --case all
python3 tests/fixtures/ldi-gate-0/tools/ldi_probe.py run --case build-order-lab
python3 -m unittest discover -s tests/fixtures/ldi-gate-0/tools -p 'test_*.py'
cargo test --manifest-path src-tauri/Cargo.toml --lib production_driver_and_cmake_artifact_with_real_tools -- --ignored --nocapture
```

`tools/gui_probe.py` is an external X11 test for LDI GUI Lab's ordinary button
handler and shared library. Build/install the GUI demo's Debug outputs first,
then run `python3 tests/fixtures/ldi-gate-0/tools/gui_probe.py` from the repository
root. It sends Return only to the PID-verified test application window; it does
not inject global keyboard input or add application hooks. It tests real
netcoredbg/LLDB, not Craidd's two-window coordinator. Python/X11 test helpers
remain here, never in the GUI demo or the IDE runtime.

The runner builds the fixture itself. It reads inputs through DAP variables,
not host logs, launches B under LLDB, and audits the managed DAP transcript for
intermediate resumes/evaluations. Each run retains `capture.json`, data inputs,
the generated driver, adapter transcripts and assertions under `captures/`.
Owned debugger process groups are cleaned up on success/failure/deadline.

Current IDE limits: exactly two visible selected project windows; same-file
static DllImport in a named class; one call statement with two materialized
`int` locals/parameters and an `int` return; explicit Cdecl; a CMake
SHARED_LIBRARY named `lib<import>.so`; and a red marker inside that export's
`.c`/`.cpp` definition using `int` or `int32_t`. No buffers, helpers-only pairing,
callbacks, queues, variable edits, proxy or automatic retry. The later discovery
banner is documented but intentionally not implemented yet.

The standalone mechanism has been run with real adapters. The interactive
two-window renderer flow still needs a manual acceptance pass; a successful
frontend build is not a claim that it has been visually tested.
