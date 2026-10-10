# MT debugging desktop test checklist

Use this checklist on `feat/mt-debugging-cross-language-labs` before describing thread control as ready for release. A checked item means it was observed in **Craidd Studio**, with the selected configuration and debugger recorded. A passing build or direct DAP probe is useful supporting evidence, but does not check a desktop item.

## Test record

Copy this line for each run: `ID | date | commit | OS | Craidd window(s)/Power Config(s) | debugger path + version | selected session/thread ID | before → after counter files or source frames | Output error | PASS/FAIL/OPEN/BLOCKED | screenshot/log`. Use **OPEN** for a known missing capability or a test needing a new fixture. Use **FAIL** when a claimed or expected behavior was actually contradicted by the desktop run.

- [ ] **SET-01** Record the branch, commit, .NET SDK, Cargo, C/C++ compiler, `netcoredbg`, and `lldb-dap` paths and versions. Record whether C# uses the installed debugger or the optional experiment build. A selected directory is not a debugger executable.
- [ ] **SET-02** Build the selected project/configuration before judging a breakpoint. Check the current source line and generated binary correspond to the selected Cargo feature or C# conditional build. Clear or label old `runs/` output so counter comparisons refer to this run; do not delete unrelated data.
- [ ] **SET-03** For a two-window case, record which window is A (caller), which is B (native), both Power Configs, whether they are linked, and which window owns the process. Avoid treating a B reproduction thread ID as an A thread ID.

Start with [Multi-Thread Lab](../../../../workspaces/mt-lab/README.md), then the [installed LLDB experiment](../../../../experiments/lldb-native-thread-control/README.md). Use the [optional C# experiment](../../../../experiments/netcoredbg-thread-control/README.md) only when testing its user-supplied debugger. The focused [ordinary C# lab](../../../../workspaces/mt-debugging-lab/README.md) is useful for thread lifecycle checks.

**First desktop pass:** run MT-01–04 once in each language, NX-01–04 in Rust/C/C++, BP-01–02 with all four saved Blue markers, then RL-01–02 and CL-01–04 for both native languages. Capture failures before moving to the deeper lifecycle and stress cases. Items labelled **fixture needed** or **open** are explicit coverage gaps; they are not prerequisites for trying the existing labs.

## UX friction watchlist: what to look for

These are the specific symptoms already raised during testing. A check elsewhere in this document can pass mechanically while the UI still makes the result hard to understand. For each row, note **what you clicked, what changed in each window, what the tooltip/status said, and whether you could tell what to do next**. Attach a before/after screenshot when a marker or thread focus changes.

| Prior friction or question | What to try and what should be visible | Related checks |
| --- | --- | --- |
| **Gold Debug is ghosted with a Rust caller and Native library window.** | With exactly one Rust caller and one Native library view, hover Gold Debug: it should explain that the library has no runnable process and point to **White Debug in A**. After starting, Gold Stop should identify the linked session. Add a second executable caller window and inspect the Gold launch plan so the number of windows/processes is understandable. If the user must guess which button starts the pair, report UX friction even when Debug succeeds. | RL-01, EDGE-07 |
| **⇥ is ghosted or its purpose is unclear.** | At a paused source line on a qualified adapter, ⇥ should be available and describe one selected-thread Step Over. Switch to a source-less frame or stock C# debugger; the disabled control/tooltip should say why. Record any case where the button is disabled with no usable explanation or appears available but targets a different thread. | NX-01, CS-01, CS-05 |
| **Selecting worker 2 then ⇥ used to jump back to worker 1.** | Write down selected name/ID, highlighted line, and both files before clicking. After the stop, verify the requested worker stepped; the other file and instruction location stayed fixed. If focus changes because a real breakpoint/exception won the stop, the UI should identify that reason. A silent jump is a failure. | NX-02–04, RL-02, CL-03 |
| **The `runs/` folder seemed absent and timers looked like proof of stepping.** | Find the output path under the selected project, refresh File Discovery after Debug creates it, and read both files after each step. The first step may only reach the write line. A paused timer or constantly updating Output panel does not prove the other worker stayed still; a missing path should be reported with the current working directory/config. | SET-02, NX-02–03, CS-04 |
| **Four Blue markers became “Native pairing changed” after a Rust Power Config switch.** | Keep all four Blues, switch C Threads → C++ Threads → C Threads, and inspect marker borders, tooltips, and launch preview. The eligible compiled call should work without deleting or re-setting the other three. A stale warning that blocks it is the reported regression. | BP-01–03 |
| **A Blue call may be shared by two Power Configs.** | Test a fixture where both configs compile the *same* call/export. The one saved Blue should remain normal and stop in each config. A marker must not become Gold-bordered merely because the config name changed. This needs the BP-06 fixture; do not claim it passed from the existing four distinct `#[cfg]` arms. | BP-06 |
| **Blue marker meaning is hard to read.** | Normal Blue means the call is eligible; Blue with Gold border means the selected build is *proven* unable to reach it; missing/ambiguous/stale evidence needs a separate pending explanation. Click/hover the marker and check that the reason names the actual source/build/partner issue, without erasing the marker or blocking another valid one. | BP-02–04, BP-08 |
| **⇥ Step Over kept entering C/C++ from Rust.** | Repeat with Blue/native red enabled, then disabled. A requested native breakpoint can stop the step in the library; the UI should reveal why it stopped there. There is no current one-shot “stay in Rust through this call” action. Record how often this interrupts the workflow as UX friction, even if the debugger is behaving correctly. | RL-03 |
| **Where is the native child thread picker?** | In Rust→C/C++ live Native, A owns the one LLDB session and its dropdown includes native child IDs; B is a source/stack view and currently has no separate child picker. In C#→C/C++ LDI, B owns a separate reproduction session and should have its own picker. Record whether the current window labels make that difference apparent. | RL-05–07, CL-01–03 |
| **Window state seemed lost or a Welcome window appeared.** | Launch, stop, close or refocus B, then restart the pair. Check whether the correct session remains controllable, whether Gold/White Stop targets the owner, and whether a stale window shows old frames. Capture exact window count and launch plan; the earlier transient Welcome report was not reproduced. | RL-04, CL-04, EDGE-05 |
| **C# ⇥ appears to require a custom debugger.** | Compare installed stock netcoredbg with the optional user-supplied experiment executable. Preferences should show the actual executable, and the control should only appear for an advertised, qualified capability. A must never imply that Craidd ships or requires the patched debugger for ordinary C# debugging or C# LDI. | CS-01–04, CL-01 |

If a row feels confusing but the technical check passes, record it as **UX friction** in the result instead of silently marking the experience complete. The [linked-window friction record](../../ldi-debugging/linked-thread-ux-friction.md) keeps the earlier observations and current ownership model.

## 1. Ordinary MT inspection: installed debuggers

Repeat **MT-01–08** with **C# Console · Basic**, **Rust Console · Basic**, and **C++ Console · Basic** from `workspaces/mt-lab/mt-lab.cln`. Put red on `BREAK_CS_BASIC`, `BREAK_RS_BASIC`, or `BREAK_CPP_BASIC` in the selected project. This section tests inspection and the adapter's actual stop scope; ordinary Step does not promise isolation.

- [ ] **MT-01** At red, the dropdown lists both named workers and the main thread when the adapter reports them. The triggering worker is identifiable. A briefly incomplete first LLDB `threads` reply does not permanently remove a stopped worker.
- [ ] **MT-02** Select worker 1, then worker 2 without executing. Stack, source line, locals (`marker`), and toolbar focus change together. Selection alone does not resume the program or produce new worker output.
- [ ] **MT-03** Inspect a worker paused in `Join`, `Sleep`, a channel, or native/runtime code with no source line. Its stack remains inspectable; source stepping is unavailable or honestly disabled. Continue can reach a later source breakpoint.
- [ ] **MT-04** Try ordinary Step Over, Into, and Out. Record the requested thread, the `continued`/`stopped` scope, and which thread actually stops next. If the adapter resumes all threads, another worker hitting red first is reported as such rather than claimed as an isolated step.
- [ ] **MT-05** Run **Debug Burst** for each language twice. Active rows follow the adapter's current membership; the latest three completed workers appear newest first under **Recently completed**; older completed rows leave that list.
- [ ] **MT-06** Run **Debug Handoff** for each language. Inspect producer, consumer, and main while one waits. Switching inspection does not release the wait; normal Continue lets the handoff complete.
- [ ] **MT-07** Stop and restart. Old thread IDs, selected frames, locals, paused/running badges, completed rows, and timers disappear; new IDs are session-specific even if a numeric ID is reused.
- [ ] **MT-08** With a long pause, verify **ran for** excludes debugger-reported paused time. Treat it as observed wall time, never CPU usage or proof that a worker advanced.

For the GUI variants in `mt-lab`, use **C# GUI · MT**, **Rust GUI · MT**, and **C++ GUI · MT** where their prerequisites are installed:

- [ ] **GUI-01** Start waiting workers, inspect the UI thread and workers, release them, and confirm the app stays responsive and the cohort finishes. Repeat the button to catch stale rows/IDs.
- [ ] **GUI-02** Launch the short-worker burst repeatedly. Rows appear/exit without retaining an old stopped stack or applying a late response to a newly selected worker.
- [ ] **GUI-03** Run producer/consumer or native-call variants available to that GUI. A wait is shown as a wait; selecting the UI thread does not silently resume the worker. Note missing GTK4, Avalonia, or Tauri prerequisites as **BLOCKED**, not failed MT behavior.

## 2. ⇥ selected-thread Step Over: native LLDB

Use `experiments/lldb-native-thread-control/thread-control.cln` with the installed LLDB-DAP supported by this branch (currently qualified on Linux LLDB-DAP 23.1.1 with scripting). Repeat **NX-01–06** for **Rust Exclusive Step**, **C++ Exclusive Step**, and **C Exclusive Step**. The C fixture is compiled C code through Craidd's current CMake/C++ route.

- [ ] **NX-01** Put red on `BREAK_NATIVE`. When both workers have paused source frames, ⇥ appears. On an unqualified debugger build, source-less frame, or stop not verified to cover all threads, it is unavailable with an accurate reason; ordinary Step remains usable.
- [ ] **NX-02** Record `worker-1.txt` and `worker-2.txt` under that project's `runs/rust`, `runs/cpp`, or `runs/c`. Select worker 1 and use ⇥ until the file write executes (often two steps): expect `1001` and `0`. Record both values **after each stop**.
- [ ] **NX-03** Switch to worker 2 at a source frame and step until its write executes: expect `1001` and `2001`. Check the unselected worker's source/instruction location as well as its file. Switching focus alone must not advance worker 1.
- [ ] **NX-04** Ordinary Continue releases the one-step holds and both workers finish. Repeat after Stop/restart, then reverse the worker order. No previous lease, thread ID, or selected frame survives.
- [ ] **NX-05** Step a thread into a lock/wait whose owner is held. Observe the stall rather than a false successful step. Pause, use the recovery release action at a verified all-thread stop if offered, then Continue or Stop; record any Output hold/release error and confirm no worker is left suspended.
- [ ] **NX-06** Try Stop during an outstanding ⇥ and a breakpoint/exception arriving during it. Check that the session terminates or stops cleanly and that no leaked hold affects the next Debug run.
- [ ] **NX-07 — open stress case** Spawn/exit a thread while ⇥ is in flight; compare membership and work before/after. The current one-step snapshot only covers known threads, so record this as a limitation or failure of a stronger isolation claim, not as a pass inferred from NX-02.

## 3. C# capability boundary and optional experiment

Use `experiments/netcoredbg-thread-control/thread-control.cln`. The patched Samsung netcoredbg binary is **user-supplied, ignored by Git, and not distributed by Craidd**. Record its actual executable path. Repeat the stock-debugger checks first.

- [ ] **CS-01** With installed stock `netcoredbg`, **C# Exclusive Step** still exposes ordinary inspection and Step. ⇥ is absent/disabled unless the adapter truly advertises a qualified one-thread capability; Craidd must not imply isolation from a thread ID alone.
- [ ] **CS-02** If testing a standard-DAP adapter that advertises `supportsSingleThreadExecutionRequests`, verify Craidd sends `next` with `singleThread: true` and qualify behavior with both counters. Capability advertisement alone is not a passing isolation test.
- [ ] **CS-03** Choose the locally built patched executable in **File → User Preferences → Toolchain → C# → Debugger**. Confirm Craidd recognizes it and ⇥ is enabled only at an all-thread stop with a selected source line. Restore **Automatic** after the optional run.
- [ ] **CS-04** Put red on `BREAK_EXCLUSIVE`. In `CSharpExclusiveStep/runs/basic/`, record both worker files. Step worker 1 to a write while worker 2 stays fixed, then switch at a source frame and step worker 2 while worker 1 stays fixed. Use the files, not dropdown timers, as execution evidence. Refresh File Discovery if `runs/basic/` has just been created.
- [ ] **CS-05** Select a worker paused without a source line. ⇥ is unavailable or gives a clear adapter error; it must not silently step the previously selected worker. Continue to a source breakpoint, then retry.
- [ ] **CS-06** Block the selected worker behind another managed worker, Pause, retry managed hold release at a verified all-thread stop if needed, and Continue or Stop. Record any `CRAIDD_HOLDS`/`CRAIDD_RELEASE` failure and verify the next run starts cleanly.
- [ ] **CS-07 — open recovery matrix** Exercise new/exiting threads, exception stops, detach from an attached process, debugger crash, GC/lock pressure, and deliberate release failure. Keep each case unpassed until an actual desktop result exists.

## 4. Blue native breakpoints across Power Configs

In two windows of the LLDB experiment, choose a Rust caller config in A and **Native Libraries · Rust** in B. Put Blue on all four source sites in `RustLinkedStep/src/main.rs`: `BLUE_RUST_C`, `BLUE_RUST_CPP`, `BLUE_RUST_C_THREADS`, and `BLUE_RUST_CPP_THREADS`. A Blue is a **source-site intent**. Its current eligibility must be recalculated from the selected build and native pairing, without discarding it.

- [ ] **BP-01** Under **Rust + C Threads**, the compiled `BLUE_RUST_C_THREADS` site is normal Blue; `#[cfg]`-excluded sites remain visible with a Gold border and are skipped at launch. Switch to **Rust + C++ Threads**: the corresponding C++ site becomes normal, prior C site gains Gold border, and no stale “Native pairing changed” warning blocks the eligible site. Switch back and confirm the same saved markers recover.
- [ ] **BP-02** Repeat the round trip through **Rust + C Lib** and **Rust + C++ Lib**. Inspect every marker tooltip and launch preview. A Gold-bordered, proven unreachable marker is not armed and does not prevent other eligible Blues from working.
- [ ] **BP-03** Click a Gold-bordered Blue to inspect/remove exactly that source-site intent; create it again and switch config. Removing one does not delete another. A red breakpoint on the same line retains ordinary red behavior.
- [ ] **BP-04** Change the Native window's build Power Config or make its expected export unavailable. Distinguish **proven unreachable** (Gold border with reason) from **unresolved/missing/stale/ambiguous evidence** (needs attention or pending). Do not silently arm the wrong export or call every uncertain state unreachable. Restore the correct partner and verify eligibility returns.
- [ ] **BP-05** Switch Power Config while a debug session is active. The running binding and captured LDI origin stay fixed; the new selection requires a new build/debug preparation before another binding can arm. Stop/restart and verify the new config binds the intended source and native entry.
- [ ] **BP-06 — fixture needed** Add a temporary test config that compiles the **same** Rust FFI source call and compatible native export as another config. One Blue must remain normal under both and actually stop at the same call. The current four `#[cfg]` arms alone cannot prove this case.
- [ ] **BP-07 — fixture needed** Create two distinct source call sites for the same export. They retain separate Blue intents and eligibility; neither is coalesced away by a config change.
- [ ] **BP-08 — open C# parity** Repeat same-call/conditional-build/export-missing/pending cases for C#→C/C++ Power Configs. The Rust resolver has targeted code tests; full C# Gold-border reachability is still a design target, so record unsupported behavior as **OPEN**, not as already supported.

For every BP case, record selected A/B configs, source site, marker color/border/tooltip, build artifact/export evidence, launch preview, actual stop, and thread/session identity. See [Blue breakpoint reachability](../../ldi-debugging/design-blue-breakpoint-reachability.md).

## 5. Rust → C/C++: one live process and one LLDB session

Use A = **Rust + C Lib** or **Rust + C++ Lib**, B = **Native Libraries · Rust**. Link the windows; set Blue on the matching Rust call and red on `BREAK_RUST` and optionally `BREAK_C_LIBRARY`/`BREAK_CPP_LIBRARY`. Repeat for both languages.

- [ ] **RL-01** Gold Debug explains why it is disabled for a library-only pair. White Debug in A starts the one Rust process; Gold Stop appears while linked. B is an inspector/Stop view, not a second debuggee.
- [ ] **RL-02** Step Rust worker 1, then 2 with ⇥. Compare `RustLinkedStep/runs/c/` or `runs/cpp/` worker counters and unselected instruction locations. A native source stop routes to B when qualified; A retains the owning LLDB thread identity.
- [ ] **RL-03** Step Into/Out and ⇥ around the Blue call. Red or Blue inside the library can still stop there. Record repeated native entry as expected current behavior; a separate “skip this native call” action has not been implemented.
- [ ] **RL-04** Stop from A or Gold Stop in B. Confirm the original process stops once, both views clear, and neither window displays stale frames. Closing B as a view must not invent another process or thread namespace.

For native child workers, use **Rust + C Threads** and **Rust + C++ Threads**, Blue on `BLUE_RUST_C_THREADS`/`BLUE_RUST_CPP_THREADS`, and red on `BREAK_C_PAIR_WORKER`/`BREAK_CPP_PAIR_WORKER` in B:

- [ ] **RL-05** At a native stop, A's LLDB thread dropdown lists the caller and any live native child. B shows the native source/stack when routing has a qualified origin. Record when a child lacks that Rust caller frame and remains displayed in A.
- [ ] **RL-06** Select one native worker **in A**, ⇥ until its `RustLinkedStep/runs/native-c/` or `native-cpp/` `owner-N-worker-M.txt` changes; the sibling's file and instruction address stay fixed. Switch siblings at source frames. Repeat for owner 1 and owner 2.
- [ ] **RL-07** Verify B currently has **no separate native-child dropdown** for this shared LLDB session. Record this as an open UI limit, not a failed two-session feature. Confirm no B selection silently changes A's thread target.
- [ ] **RL-08** Try a child spawning/exiting during ⇥, Continue from A, and Stop from B. Check which thread resumes and that all temporary holds release; record any unmatched source, stale B view, or Output error.

## 6. C# → C/C++: managed origin and separate native reproduction

Use `experiments/netcoredbg-thread-control/thread-control.cln` in two windows: A = **C# Threads + C Threads** or **C# Threads + C++ Threads**, B = **Native Libraries · C# LDI**. Blue is `BLUE_C_CALL`/`BLUE_CPP_CALL`; managed red is `BREAK_MANAGED`; native red is `BREAK_C_ENTRY`/`BREAK_CPP_ENTRY` and `BREAK_C_WORKER`/`BREAK_CPP_WORKER`. Repeat both pairings. Installed stock netcoredbg is sufficient for the **LDI** checks; optional patched netcoredbg affects only A's ⇥ before Blue. B uses installed LLDB-DAP.

- [ ] **CL-01** Gold Debug starts the linked reproduction. At Blue, record the exact A managed origin thread and handoff token. B's LLDB session/process starts separately. The B thread dropdown must not reuse A's IDs as though they share a process.
- [ ] **CL-02** Select another paused C# thread in A while B is active. A inspection changes; the captured origin and native-call argument do not. A stays held until B completes or the handoff is deliberately abandoned.
- [ ] **CL-03** At the B native worker stop, ⇥ one worker and compare `Native/runs/native-c/` or `native-cpp/` `worker-1.txt`/`worker-2.txt`; switch B workers and repeat. Check source/instruction location too. A's `LinkedCSharpStep/runs/c/` or `cpp/` files are **original-process results**, not evidence that B threads were isolated.
- [ ] **CL-04** Finish B, then confirm A releases **once** and executes its own call. Continue, cancel, Stop, exception, and closing either window each leave a truthful state; no old B completion releases a newer A handoff.
- [ ] **CL-05** Remove/restore a prepared Blue during a run, edit its condition, and add a new Blue site after Gold launch. The prepared site follows its documented current-run rules; an unprepared site asks for Gold Restart rather than silently binding. Red on the same line remains independent.
- [ ] **CL-06** With a missing native library, wrong export, or failed B launch, capture the warning and verify A is not left held forever. Repeat with corrected configuration and a fresh token.

Also use the broader `workspaces/mt-lab/mt-lab.cln` **C# GUI · MT + LDI** and **Native · LDI** pair:

- [ ] **CL-07** Variant 4: A's one C# origin remains held while B reports seven native workers; selecting a B worker changes B's stack/locals only. After B completes, A's call returns `322`.
- [ ] **CL-08** Variant 5: seven named C# callers reach Blue **sequentially**. For each, record its own origin and token, two B workers, and release before the next handoff. Expected final results are `207, 211, 215, 219, 223, 227, 231`. This does not test seven simultaneous reproductions.

## 7. Cross-session, lifecycle, and failure checks

- [ ] **EDGE-01** With two solution windows and independent debug sessions, select threads with the same numeric DAP ID if one occurs. Stack, locals, commands, and events stay with their owning window/session generation.
- [ ] **EDGE-02** Rapidly switch thread selection during a delayed `stackTrace`/`scopes`/`variables` response, then Continue or restart. An old response must not overwrite the new selection or display stale locals/source.
- [ ] **EDGE-03** Exit a selected worker and create another. A reused adapter ID does not inherit the exited worker's name, frame, timer, or held state. Recently completed rows remain read-only.
- [ ] **EDGE-04** A partial stop (or a stop whose scope cannot be verified) never enables ⇥ just because a thread is listed as paused. Thread membership alone does not prove all-thread suspension.
- [ ] **EDGE-05** Stop, debugger exit/crash, detached window, or failed launch while a hold/LDI handoff is active. Confirm cleanup, honest status in both windows, and a clean second launch. Record process PID, Output, and whether manual recovery was needed.
- [ ] **EDGE-06** Repeat an all-thread stop under load with a short-lived burst, a lock wait, and a native child created after the first thread snapshot. Record any limits of the known-thread suspension model explicitly.
- [ ] **EDGE-07** Verify toolbar explanations: ⇥ describes one selected-thread step and its qualification; ordinary arrows state their debugger-dependent scope; Gold Debug/White Debug/Gold Stop name the right owner; Blue Gold border explains reachability rather than suggesting a breakpoint was deleted.

## Sign-off

- [ ] **Gate A — ordinary MT:** MT-01–08 pass per language; GUI checks pass on each installed GUI stack, or prerequisites are listed as blocked. No claim of isolated ordinary Step.
- [ ] **Gate B — native ⇥:** NX-01–06 pass in Craidd for Rust, C, and C++ on a recorded qualified LLDB build. Document NX-07 and other limitations with actual evidence.
- [ ] **Gate C — Blue reachability:** BP-01–05 pass through both Rust+native pairings with four saved Blues and a real two-window launch. BP-06/07 require new fixtures; BP-08 remains open until C# parity is built and tested.
- [ ] **Gate D — linked MT:** RL-01–08 and CL-01–08 have separate desktop results. Mark current Rust B native-child UI limitation and any C# recovery gaps openly.
- [ ] **Gate E — release decision:** Re-run failures after fixes, attach evidence to each result, and state which debugger versions/platforms are qualified. An unchecked or blocked case is not a pass.

---

*Last updated: Phase 3.x, 10 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
