# Multi-Thread Lab

Open [mt-lab.cln](mt-lab.cln) in Craidd. This solution collects small, repeatable programs for exercising thread discovery, selection, stop scope, stepping, and completion in C#, Rust, and C++. It extends the earlier [C# debugging lab](../mt-debugging-lab/README.md); it does not replace that lab's focused regression scenario.

## Scenarios

| Target | Variant 1: basic | Variant 2: burst | Variant 3: handoff or boundary |
| --- | --- | --- | --- |
| C# console | Two named workers run for about 12 seconds | Ten short named workers overlap and exit | Named producer and consumer exchange twelve jobs |
| Rust console | Same shape with named Rust threads | Same shape with ten short threads | Producer and consumer through a channel |
| C++ console | Same shape with named `std::thread`s | Same shape with ten short threads | Producer and consumer through a guarded queue |
| C# Avalonia GUI | Start two waiting workers, then release them | Click to launch six short workers | A named C# worker calls the single-threaded C++ `mt_native` library |
| Rust Tauri GUI | Start two waiting workers, then release them | Click to launch six short workers | Named Rust producer and consumer exchange jobs |
| C++ GTK4 GUI | Start two waiting workers, then release them | Click to launch six short workers | Named C++ producer and consumer exchange jobs |

The C# GUI also has variant 4 (one C# caller with seven C++ workers) and variant 5 (seven C# callers, each invoking a native export that creates two C++ workers). Variant 5 deliberately orders the calls so each LDI reproduction has one unambiguous C# origin.

The GUI main thread stays responsive while workers run. Every button can be used again to create another cohort. Source comments beginning with `BREAK_` identify useful breakpoint lines. The names are intentionally short enough to remain legible in a debugger. C++ sets Linux thread names through `pthread_setname_np`; other platforms may display generic names.

## Run the console programs

Select **C# Console · Basic**, **Rust Console · Basic**, or **C++ Console · Basic** in Craidd and use the Build, Run, or Debug toolbar controls. The solution also contains separate Debug Burst and Debug Handoff configurations for each language. For direct command-line runs:

```sh
(cd CSharpConsole && dotnet run -- basic)    # also: burst, handoff
(cd RustConsole && cargo run -- basic)       # also: burst, handoff
(cd CppConsole && cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build)
(cd CppConsole && ./build/mt_cpp_console basic)
```

Run each command from the solution directory. Place a breakpoint on `BREAK_CS_BASIC`, `BREAK_RS_BASIC`, or `BREAK_CPP_BASIC`, respectively. A source stop should show the worker's own local `marker` and its distinct thread identity. Burst tests recently completed rows; handoff tests producer and consumer wait/work stacks. While one worker is stopped, expect the adapter's reported stop scope to decide whether the other workers run. A selected thread does not guarantee isolated stepping.

### C# thread names and step scope

The C# basic variant constructs each worker with `new Thread(() => { ... }) { Name = $"cs worker {number}" }`. `Name` is the .NET [`System.Threading.Thread.Name` property](https://learn.microsoft.com/en-us/dotnet/api/system.threading.thread.name?view=net-10.0), set by the application through a C# object initializer. `number` comes from `Enumerable.Range(1, 2)`, and `$"...{number}"` makes the distinct display string. `.ToArray()` materializes the sequence of threads. Craidd has no special `Name` variable or naming API: it displays the name supplied by the debugger adapter. Naming workers is optional, but it makes them easier to distinguish; the numeric debugger thread ID can change between runs. Craidd remembers the last descriptive name reported for a thread until that thread completes, even if a later adapter refresh says `<No name>`.

Selecting a thread chooses the stack and locals to inspect and sends its ID with Step. It does **not** promise that the other threads stay frozen. In a direct probe of `netcoredbg` 3.2.0-1 with this basic variant, Step Over on `cs worker 1` emitted `continued { allThreadsContinued: true }`, then `cs worker 2` hit the shared breakpoint and emitted `stopped { allThreadsStopped: true }`. The adapter did not advertise `supportsSingleThreadExecutionRequests`; adding `singleThread: true` to the probe produced the same all-thread continuation. This means another worker can reach a breakpoint before the selected worker completes its step and become the new stop focus. To inspect worker 2, select it while paused; its source marker appears only if its current top frame has a source line. A thread stopped in `Thread.Join`, `Thread.Sleep`, or another runtime wait can have a stack without a usable source marker or source-level Step. Put a breakpoint on worker 2's code path and Continue to reach a source stop.

### Rust and C++ thread names

Rust has a standard-library naming API: `thread::Builder::new().name(format!("rs worker {number}")).spawn(move || { ... })`. The builder assigns the name when it creates the thread; `thread::spawn` alone uses the default configuration. See [Rust's `std::thread::Builder`](https://doc.rust-lang.org/std/thread/struct.Builder.html). The Rust console and GUI variants in this lab already use `Builder::name`.

The C++17 `std::thread` API used by this lab has no `Name` property. On Linux, this lab names each worker inside its thread function with `pthread_setname_np(pthread_self(), name.c_str())`. Linux limits that name to 15 bytes plus the terminating null byte, so the lab shortens names before passing them; the function is nonportable and should have its return value checked in production code. See the [Linux `pthread_setname_np` manual](https://man7.org/linux/man-pages/man3/pthread_setname_np.3.html). On Windows, the analogous OS API is [`SetThreadDescription`](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setthreaddescription). Craidd displays the thread name reported by LLDB-DAP; these are application/runtime APIs, not Craidd APIs.

In a direct probe with LLDB-DAP 23.1.1, the Rust and C++ basic variants both reported the named workers and their source stacks. An immediate first `threads` reply after the breakpoint sometimes listed only the main thread; the next reply included both workers. Craidd retries once before removing the stopped worker from its list. LLDB-DAP did not advertise single-thread execution in this probe, and Step Over reported `allThreadsContinued: true`, so the same stepping caveat applies.

## Run the GUI programs

- **C# GUI · MT:** Build or Debug the Avalonia app. Click variant 1, inspect the waiting workers, release them, and stop at `BREAK_GUI_BASIC`. Variant 2 creates six short workers at `BREAK_GUI_BURST`.
- **C# GUI · MT + LDI:** This separate configuration builds and installs `libmt_native.so` into the C# output. Variant 3 keeps the native call single threaded: the managed worker reaches `BREAK_GUI_LDI` and calls `mt_add` at `BREAK_CPP_LDI`. Variant 4 reaches `BREAK_GUI_LDI_WORKERS` and calls `mt_add_workers`, which creates seven named native workers. Variant 5 starts seven named C# callers together, then passes a gate from one caller to the next after each native call returns. Each `BREAK_GUI_LDI_PAIR` call runs `mt_pair_workers`; its two named C++ workers stop at `BREAK_CPP_LDI_PAIR` when red is set there. `BREAK_GUI_PAIR_MANAGED` is a separate managed red breakpoint location before blue.
- **Rust GUI · MT:** The Tauri frontend is in `RustGui/` and the Rust app is in `RustGui/src-tauri/`. Install frontend packages with `npm install` in `RustGui/`, then use the solution's Run/Debug configuration or `npm run tauri dev`. Breakpoint markers are `BREAK_RS_GUI_BASIC`, `BREAK_RS_GUI_BURST`, and `BREAK_RS_GUI_HANDOFF`.
- **C++ GUI · MT:** Requires GTK4 development files discoverable by `pkg-config`. Build or Debug the GTK4 app; breakpoint markers are `BREAK_CPP_GUI_BASIC`, `BREAK_CPP_GUI_BURST`, and `BREAK_CPP_GUI_HANDOFF`. The choice of GTK4 keeps the thread experiment independent of graphics rendering; OpenGL is not required for the requested thread scenarios.

The C# GUI catches a missing native library and reports it in its window. Build **C# GUI · MT + LDI** before exercising variants 3–5. The ordinary **C# GUI · MT** configuration intentionally concentrates on variants 1 and 2.

### Linked LDI thread preview

1. Open this solution with the C# GUI in A and **Native · LDI** in B. Add a blue breakpoint on `BREAK_GUI_LDI_WORKERS`, targeting B, and a red breakpoint on `BREAK_CPP_LDI_WORKER`.
2. Start Gold Debug, then click variant 4 in the C# GUI. A's named C# worker reaches blue. The native driver in B reproduces that call and starts seven named workers.
3. Open **Threads** beside Continue in A. Its own C# threads remain in the list, with the held origin marked. The **LDI · native reproduction** section shows B's process status and reported threads. It updates while the dropdown is open.
4. Click a paused B worker in that section. Craidd selects its stack in B and focuses or views B; A's held origin remains fixed. Continue B until the driver returns, then check that A's own native call returns `322`.

The first worker to reach red can stop the whole B process. Other B workers may therefore show `paused` without each having hit red; the row's stop reason distinguishes the triggering worker where the adapter reports it. A `threads` list alone cannot establish stop scope. This preview is linked to the active LDI reproduction token, and only one reproduction is active per C# origin process. It does not inspect native threads in A's original process.

The real-adapter probe checks both the two-worker and seven-worker B stops and their native red lines without opening the IDE: `python3 tests/fixtures/mt-debugging/ldi_worker_probe.py` from the repository root. The dropdown and cross-window selection still need a manual Craidd pass.

### Seven C# callers → two C++ workers per call

1. Keep the C# GUI in A and **Native · LDI** in B. Put blue on `BREAK_GUI_LDI_PAIR`, targeting B. Put native red on `BREAK_CPP_LDI_PAIR`. Optionally put managed red on `BREAK_GUI_PAIR_MANAGED` to inspect each C# caller before it reaches blue.
2. Start Gold Debug and click **5 · Seven C# callers, two C++ workers per call**. Seven named `cs pair` threads are created before caller 1 is released from its gate. A may show all seven paused when `netcoredbg` reports an all-thread stop, but only the caller that hit blue is the **LDI origin**. The other six have not entered their native calls.
3. B's Threads control identifies the A caller by name/ID and handoff token. B's thread list contains two named `ldi pair` workers **and the driver's call thread**. A's linked section shows the same current B threads. A selected B row changes B's inspection focus; it does not change the captured C# caller.
4. Finish B's reproduction. A executes its own call; that C# worker then opens the next worker's gate. The next blue hit gets a new handoff token and A origin. Repeat through callers 1–7. Expected results are `207, 211, 215, 219, 223, 227, 231`.

This is a **sequential handoff workaround**, not seven independently held native calls. Current managed LDI runs one reproduction per C# process at a time. Reusing the native names `ldi pair 1` and `ldi pair 2` is safe because the handoff token and A origin identify which invocation B is showing. The debugger may resume all managed threads on Step even when a thread ID is supplied; the gates keep the six waiting callers from reaching blue during the current handoff. A true simultaneous seven-call view, with 14 native workers across seven driver sessions, needs a separate multi-invocation coordinator and explicit session-qualified grouping.

To leave native inspection during the seven-call run, press **Continue in A** while A is held. Craidd stops the current B reproduction before resuming the original C# call; the next caller can still hit blue. Remove blue from `BREAK_GUI_LDI_PAIR` to skip the current B reproduction **and** disarm later calls at this site. An ordinary red breakpoint on that line remains. Restoring that prepared blue location during the same Gold run rearms it for later callers. A condition edit on the prepared location also applies to later hits. A new blue call site added after Gold started shows **Gold Restart** because its native binding was not prepared for this run. Check A's Output and B's terminated/waiting state before assuming cancellation finished; the live linked-window sequence still needs interactive verification.

## Acceptance checklist

1. In each target, select a stopped named worker and verify that its stack and local `marker` belong to that worker. Switch to another stopped worker and verify that frames and locals change together.
2. With an all-thread stop, inspect the main/UI thread and a worker. If a thread has no source line, keep its stack available and continue safely; stepping may be unavailable there. Check the adapter's actual `allThreadsStopped` and `allThreadsContinued` values before claiming isolated behavior.
3. Run burst repeatedly. Active thread count should follow the adapter's current list. At most the latest three completed workers should appear in the collapsed **Recently completed** section. A **ran for** duration totals debugger-observed running intervals and excludes reported pauses; it is not CPU time.
4. Restart and verify that old thread IDs, elapsed timers, selections, and completed rows disappear. Repeat with a source breakpoint in the new run.
5. After single-language checks pass, run the C# GUI native-call variant. Verify the managed worker remains the origin for its native call and that selecting another C# thread does not change the LDI hold/release target.

Current Craidd implementation has ordinary C#, Rust, and C++ thread dropdowns and a linked LDI thread preview for one active managed origin. The seven-caller lab checks the invocation handoff model; successful compilation or a direct adapter probe is a setup check, not proof of live Craidd UI behavior. Request debugging is a separate feature.

## Prerequisites

.NET 10 SDK; Rust/Cargo; CMake and a C++17 compiler; GTK4 development package for the C++ GUI; Node.js/npm and Tauri v2's Linux prerequisites for the Rust GUI; `netcoredbg` for C# and `lldb-dap` for Rust/C++. Avalonia packages and Rust crates require a first download unless already cached. The repo's root `node_modules` can satisfy the Rust GUI frontend during local development, but a standalone checkout should run `npm install` inside `RustGui/`.
