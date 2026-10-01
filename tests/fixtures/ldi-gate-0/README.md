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

## Experimental typed interposer

The production proxy, driver and startup-hook sources under `src-tauri/` are
used both by the IDE and by this no-window, real-debugger probe. The proxy is
built in Craidd's cache, not added to the developer's CMake project or copied
over its real library. Run from the repository root:

```bash
python3 tests/fixtures/ldi-gate-0/tools/interposer_probe.py
```

It verifies that .NET's actual UTF-8 string and byte-buffer arguments are
captured after a selected netcoredbg blue stop, A waits before its original C++
entry, B hits a C++ breakpoint with B-owned buffers, and A only calls the real
function after release. A 4097-byte string produces an explicit unsupported
record; B is not started and A waits for an explicit release. Re-arming a
conditional blue stop at `i=7,8,9` produces three separate captures while
unselected calls forward normally.

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

### Try the typed interposer in the IDE

1. Keep two linked windows open for `ldi-gate-0.cln`. Select **LDI · Host Buffer**
   in A and **LDI · Native Buffer** in B.
2. Put a red breakpoint at `// NATIVE_MEASURE_STOP` in `native/measure.cpp`.
   Put a blue Native Debugging Breakpoint at `// BUFFER_BLUE` in
   `Host/Program.cs`.
3. Press **Gold Linked Debug**. A pauses at blue, arms its exact Linux thread,
   then waits inside the generated proxy *before* the original C++ export.
   B opens on the real C++ breakpoint. Finish B; A makes its original call and
   prints `HOST interposer result=284`.
4. For repeated calls, select **LDI · Host Buffer Repeat**, move blue to
   `// BUFFER_CONDITIONAL`, and set its
   condition to `i > 6 && i < 10`. Only 7, 8 and 9 should open B.

This IDE interaction still needs a manual renderer acceptance pass. The typed
path deliberately accepts only one direct `DllImport` of the selected library
in the entry assembly: `int` return, explicit Cdecl, UTF-8-marshalled `string`,
`byte[]`, and `nuint` passed as `(nuint)bytes.Length`. The matching native export
must be `int`/`int32_t (const char*, const uint8_t*, size_t)` with a red marker
in its `.c/.cpp` body. Other imports, opaque pointers, callback state and
arbitrary object graphs are rejected or outside this mockup. A startup hook
checks the compiled entry assembly before Main; unsupported proxy inputs are
reported before B starts, with A held for explicit release.

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
python3 tests/fixtures/ldi-gate-0/tools/auto_entry_probe.py
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

Scalar IDE limits remain: exactly two visible selected project windows;
same-file static DllImport in a named class; one call statement with two
materialized `int` locals/parameters and an `int` return; explicit Cdecl;
a CMake SHARED_LIBRARY named `lib<import>.so`; and one uniquely resolved
`.c`/`.cpp` export definition. An explicit red inside that body is optional:
otherwise B receives a private automatic entry stop. The typed interposer has the additional narrow
signature rules above. Neither path supports callbacks, queues, variable edits,
or automatic retry. The later discovery banner is intentionally not implemented.

The standalone mechanism has been run with real adapters. The interactive
two-window renderer flow still needs a manual acceptance pass; a successful
frontend build is not a claim that it has been visually tested.
