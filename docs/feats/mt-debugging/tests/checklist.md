# MT debugging desktop test checklist

Use this checklist on `feat/mt-debugging-cross-language-labs` before describing thread control as ready for release. A marked result means the action was observed in **Craidd Studio**, with the selected configuration and debugger recorded. A passing build or direct DAP probe is useful supporting evidence, but does not establish a desktop result.

**Screenshot evidence is local-only.** Historical filenames below identify captures in the ignored `docs/feats/mt-debugging/tests/evidence/` directory; the images are not included in a public checkout. The written observations and verdicts remain here, but verifying a screenshot-dependent claim requires access to the local capture or a fresh desktop run. Keep new captures outside Git and record their local path with the result.

## How an agent or contributor fills this checklist

Keep the original test text and IDs. Replace each box only after attempting that exact case on the recorded revision:

- `[Y]` = observed in the live Craidd UI and the stated expectation passed. Include the visible result and evidence. Source inspection, a direct DAP probe, or a previous screenshot alone cannot earn `Y`.
- `[N]` = attempted in the live UI and the expectation failed, including a feature that the UI plainly lacks. Record the actual behavior, reproducible steps, and whether this is a functional failure or UX friction. Do not use `N` merely because a fixture or tool was unavailable.
- `[ ]` = not run, blocked, inconclusive, or a design question still open. Add `-- Status: NOT RUN | BLOCKED | INCONCLUSIVE | OPEN` and the specific reason. Do not force a binary answer from missing evidence.

Under **every** checkbox, use the requested `--` write-up style. Indent it under its checkbox and give at least these three short lines (add more when useful):

```text
- [Y] **BP-01** Original test instruction stays here.

  -- Observed: Rust + C Threads armed the C call; three excluded calls retained Gold borders.
  -- Evidence: screenshot/path, debugger Output, selected A/B configs, source site, before/after values if applicable.
  -- Reasoning and UX: Why this supports Y; whether the state and next action were clear to a new user.
```

For `[N]`, name the first mismatch and exact reproduction. For `[ ]`, explain what prevented a verdict and what would make it testable. Record a local screenshot, video, Output log, or counter-file path rather than writing “worked” alone. If one checkbox covers C, C++, Rust, and C#, add a separate `-- Variant:` result for each; a successful language cannot stand in for another. Record an issue/PR link only if one actually exists. Leave the A/B/C decision worksheet pending until the relevant UI results are recorded.

### UI-Test Harness preflight

The repository does not document the external UI-Test Harness. Before marking any `Y` or `N`, record its name/version, Linux desktop session, Craidd commit/build, available debugger executable paths/versions, and whether it can: click/hover Monaco gutter markers, control and identify **multiple real windows**, inspect tooltips/menus, read Output and worker counter files, capture screenshots/video, stop a live debugger, and fully quit/relaunch Craidd. Mark cases **BLOCKED** when the harness cannot perform or observe their required action. Do not quietly substitute source review, synthetic DOM state, or a direct adapter probe for a paired desktop run.

The harness can gather objective UI and file evidence. Contrast, discoverability, wording, and “would a newcomer know what to do?” also need human UX judgment from the captured screen and click path. Mark those items `[ ]` with `INCONCLUSIVE` when only machine evidence exists. New-fixture cases such as BP-06/07 stay `[ ]` until the fixture and its exact build are available.

## Test record

Copy this line for each run: `ID | date | commit | OS/harness | Craidd window(s)/Power Config(s) | debugger path + version | selected session/thread ID | before → after counter files or source frames | Output error | Y/N/blank + status | UX: clear/confusing/blocked | screenshot/log`. Use **OPEN** for a known missing capability or a test needing a new fixture. Use **N** when a claimed or expected behavior was actually contradicted by the desktop run. A technically passing case can still have a confusing UX result.

### Run log — 10 October 2026 (agent harness pass)

**Harness preflight.** UI-Test Harness = the `tests/ui/lib` WebDriver client from branch `uiux/ui-harness` (280b1d8), copied outside the repo and run from a small interactive driver. It used `tauri-driver` (`~/.cargo/bin/tauri-driver`) in front of `/usr/bin/WebKitWebDriver`. Session: Arch Linux, kernel 7.2.9-arch1-1, GNOME Shell 51.0 on Wayland. Craidd: embedded debug build (`tauri build --debug --no-bundle`) of 856859e. Each launch used a scratch `HOME`, so the user's `~/.craidd-studio` was untouched. Capabilities as used:

- **Monaco gutter:** click and hover worked by real pointer after scrolling with wheel actions. Ctrl+G was unreliable when the window lacked OS focus.
- **Multiple windows:** worked through WebDriver handles. A window that starts hidden has no handle until it is shown.
- **Tooltips and menus:** read from Monaco hover and `title`/`aria-label` attributes.
- **Output and counter files:** read directly.
- **Screenshots:** web content only. No video.
- **Stopping a live debugger:** through the UI.
- **Full quit/relaunch with the same state:** not possible, because each launch gets a new `HOME`. BP-17/18 are therefore BLOCKED.

Local screenshots from this run were saved under `evidence/2026-10-10/` (`r1-` = first app launch, `r2-` = second). The harness checks objective state; the UX judgements flagged INCONCLUSIVE still need a human pass.

Record lines (`ID | date | commit | OS/harness | windows/configs | debugger | session/thread | before → after | Output error | result | UX | evidence`):

- `MT-01–04 | 2026-10-10 | 856859e | Arch GNOME Wayland / tauri-driver | mt-lab single window: C#/Rust/C++ Console · Basic | netcoredbg 3.2.0-1, lldb-dap 23.1.1 | e.g. cs worker 1 #240445, rs worker 1 #246921, cpp worker 1 #247295 | see entries | none | Y,Y,N,Y | MT-03 confusing | r1-001…r2-011`
- `NX-01–05 | 2026-10-10 | 856859e | same | thread-control.cln (LLDB) Rust/C++/C Exclusive Step | lldb-dap 23.1.1 | rust step 1 #248867 … | 0/0 → 1001/0 → 1001/2001 → 1012/2012 | none (leak: no error) | N,Y,Y,Y,N | leak not visible | r2-012…r2-031`
- `BP-01/02/09–13/16, RL-01–07 | 2026-10-10 | 856859e | same | A workspace-2 CS1 Rust + C Threads/C Lib; B CS2→CS3→CS4 Native Libraries · Rust | lldb-dap 23.1.1 (one session, owner A) | rust linked 1 #257619, children #258691/#258692 | runs/c 1001/2001; runs/native-c owner files 1 | none | see entries | stale CS3, inherited names | r2-034…r2-064`
- `CL-01–04, CS-01 | 2026-10-10 | 856859e | same | A workspace-6 CS1 C# Threads + C/C++ Threads; B workspace-7 CS2 Native Libraries · C# LDI | stock netcoredbg 3.2.0-1 (A), lldb-dap 23.1.1 (B) | LDI #2/#3/#4 (C), #6/#7 (C++); A #267955/#267956, B driver #268071/#268200 | Native/runs/native-c 1/1 → 20/20; A runs/c 0/0 → 1001/2001 | none | Y,Y,Y,blank,Y | clear | r2-065…r2-082`

Counts from this historical pass, with the partial BP-02/BP-13 checks left open: `[Y]` 18, `[N]` 4 (MT-03, NX-01, NX-05, BP-16), `[ ]` 55 (including the five gates). The `[N]` entries describe the 856859e build. The repair checkpoints below do not turn a multi-language or full-lifecycle test into a pass.

### Repair checkpoints — 10–12 October 2026 (working tree based on 25bb593)

These checks used an embedded Craidd debug build with the uncommitted MT repair, Arch GNOME Wayland, `tauri-driver`/WebKitWebDriver, `/usr/bin/lldb-dap` 23.1.1, and stock `/usr/bin/netcoredbg` 3.2.0-1. Each app launch had a scratch `HOME`. The driver called Craidd's own breakpoint, window, and Blue IPC commands; the debugger controls and Power Config picker were operated in the live desktop UI. Local screenshots were saved under `evidence/2026-10-12/`. These are focused retests, not a new full checklist pass.

- `MT-03 / NX-01 | 10 Oct | thread-control.cln, Rust Exclusive Step | red main.rs:21, worker stop, select rust-exclusive- main in libc join | ⇥ and ordinary source Step disabled; stack remains visible, source-less notice shown | partial Rust repair | evidence/2026-10-12/main-source-less.png`. The Debug panel no longer presents the libc symbol as an available source location. C/C++ source-less frames and later source-breakpoint recovery remain to test.
- `NX-05 | 10 Oct | thread-control.cln, Rust Exclusive Step | red main.rs:27, then remove red; ⇥ on main join | counters 0/0 after 2.5 s blocked → Pause → Continue → terminated at 1012/2012 | partial Rust repair | evidence/2026-10-12/blocked-step.png, evidence/2026-10-12/pause-released.png`. The direct LLDB-DAP reproduction identified a still-active single-thread step plan after Pause; discarding it before releasing holds let Continue run both workers. The lock fixture, C/C++, and deliberate failure paths remain to test.
- `NX-02 focused regression | 12 Oct | thread-control.cln, Rust Exclusive Step | red main.rs:21, remove red, ⇥ worker 1 | same thread stayed selected, stop main.rs:22, counters 0/0 → Continue → 1012/2012 | pass for this Rust run | evidence/2026-10-12/one-thread-step.png`. This does not replace the existing C/C++ NX-02–04 results or the unrun stress checks.
- `BP-16 state repair | 10 Oct | thread-control.cln, A Rust + C Threads, B Native Libraries · Rust | set four Blues at main.rs:16/21/26/31, close B through Craidd, open new B, re-pair line 26 | all four saved Blues changed from CS2 to CS3; no old partner ID in the Debug panel | partial repair | evidence/2026-10-12/blue-repaired.png`. The test used direct `set_ldi_blue`/`close_linked_window` IPC in real Craidd windows. Reopening through the marker menu and hitting each native entry after the re-pair still need the human desktop pass.
- `C# ordinary Step regression | 12 Oct | mt-lab.cln, C# Console · Basic, stock netcoredbg | red Program.cs:21, remove red, ordinary Step Over | source controls available; stopped at Program.cs:22 | pass for this run | evidence/2026-10-12/csharp-ordinary.png`. This checks that source-frame filtering does not disable ordinary C# stepping; it does not qualify C# ⇥.

### Retest on b7d173f — 12 October 2026 (agent harness)

Embedded debug build of b7d173f, Arch GNOME Wayland, `tauri-driver` + `/usr/bin/WebKitWebDriver`, `/usr/bin/lldb-dap` 23.1.1, stock `/usr/bin/netcoredbg` 3.2.0-1. One scratch `HOME` was kept across launches so BP-17/18 could check persistence. All actions went through the live UI (gutter, menus, toolbar, window list, keyboard shortcuts); no Blue or window IPC was called directly. Local screenshots are `p2a-*`/`p2b-*` under `evidence/2026-10-12/`. One C# close-B attempt was discarded because the windows were touched by hand during it; the clean re-run is recorded. Verdicts changed only where the run covered every required variant.

- `MT-03 | Rust/C++/C# Console · Basic | main thread in join | steps disabled with source-less reason; Continue → later red | Y`
- `NX-01, NX-05 | Rust/C++/C Exclusive Step | source-less frames disabled; ⇥ main into held join → Pause → Continue → 1012/2012 | Y,Y`
- `NX-06 | C Exclusive Step | Stop during ⇥ clean; breakpoint during ⇥ reported and released | blank (C only)`
- `BP-02/03/13–20 | A Rust + C/C++ Lib/Threads, B Native Libraries · Rust (CS2→CS3); C# pair for BP-15 | see entries | BP-03/14/15/16/19/20 Y, BP-13 N, BP-17/18 OPEN`


- [Y] **SET-01** Record the branch, commit, .NET SDK, Cargo, C/C++ compiler, `netcoredbg`, and `lldb-dap` paths and versions. Record whether C# uses the installed debugger or the optional experiment build. A selected directory is not a debugger executable.

  -- Observed: Branch `claude/mt-debugging-test-checklist-590c8d` at 2abe400 (code identical to 856859e on `feat/mt-debugging-cross-language-labs`; 2abe400 only changed this checklist). Craidd built with `tauri build --debug --no-bundle`.
  -- Evidence: .NET SDK 10.0.112 (`/usr/bin/dotnet`); cargo/rustc 1.99.0 (Arch); gcc/g++ 16.2.1; cmake 4.4.4; `/usr/bin/lldb-dap` LLVM 23.1.1; `/usr/bin/netcoredbg` 3.2.0-1 (Samsung, stock). C# used the **installed stock** netcoredbg (Preferences left on Automatic in a scratch HOME). The optional patched experiment build was not used.
  -- Reasoning and UX: The versions come from the executables Craidd launched. No directory was selected as a debugger.

- [Y] **SET-02** Build the selected project/configuration before judging a breakpoint. Check the current source line and generated binary correspond to the selected Cargo feature or C# conditional build. Clear or label old `runs/` output so counter comparisons refer to this run; do not delete unrelated data.

  -- Observed: Each Debug ran Craidd's own build first (Output shows `cargo build`, `cmake --build`, `[Order 1/1] Build Native Libraries · Rust Build`, and `--features native_threads` for the Threads configs). No `runs/` folders existed in either experiment before the pass. The fixtures rewrite their counters to `0` at start, so every comparison below belongs to its own run.
  -- Evidence: Output panel in evidence/2026-10-10/r2-059-bp12-white-debug-without-B.png; counter reads recorded under NX/RL/CL.
  -- Reasoning and UX: The source line and binary matched for every stop: the paused line equals the marker line in each case.

- [Y] **SET-03** For a two-window case, record which window is A (caller), which is B (native), both Power Configs, whether they are linked, and which window owns the process. Avoid treating a B reproduction thread ID as an A thread ID.

  -- Observed: Rust pair (`lldb-native-thread-control/thread-control.cln` in both windows): A = `workspace-2`/CS1 **Rust + C Threads** (role live-native, owns the one LLDB process); B = **Native Libraries · Rust**, first `workspace-3`/CS2, then `workspace-4`/CS3, then `workspace-5`/CS4 after the BP-12/16 close and re-pair. C# pair (`netcoredbg-thread-control/thread-control.cln` in both windows): A = `workspace-6`/CS1 **C# Threads + C Threads / C++ Threads**; B = `workspace-7`/CS2 **Native Libraries · C# LDI**, with its own process.
  -- Evidence: `get_application_windows` snapshots in the run log below.
  -- Reasoning and UX: B thread IDs (`driver #268071`) are recorded separately from A's (`managed linked 1 #267955`). File → Duplicate Window opened the C# B **hidden** because of the duplicate-window limit, and A switched to remote-viewing it. A newcomer would need to find **Show** in the window list.

Start with [Multi-Thread Lab](../../../../workspaces/mt-lab/README.md), then the [installed LLDB experiment](../../../../experiments/lldb-native-thread-control/README.md). Use the [optional C# experiment](../../../../experiments/netcoredbg-thread-control/README.md) only when testing its user-supplied debugger. The focused [ordinary C# lab](../../../../workspaces/mt-debugging-lab/README.md) is useful for thread lifecycle checks.

### Solution file for each test batch

Open the `.cln` named here; the Power Config names in each test belong to that solution. For paired tests, open the **same `.cln` in two Craidd windows** and choose the stated A/B configs. Do not assemble A and B from different lab solutions.

| Test IDs | Open this solution | Configurations/windows |
| --- | --- | --- |
| SET-01–03 | Each `.cln` used below | Record toolchain and A/B setup afresh for every batch; setup from one solution does not establish another. |
| MT-01–08, GUI-01–03, CL-07–08 | [workspaces/mt-lab/mt-lab.cln](../../../../workspaces/mt-lab/mt-lab.cln) | MT: each C#/Rust/C++ Console Basic, Debug Burst, Debug Handoff config; GUI: matching language MT config. CL-07/08: A **C# GUI · MT + LDI**, B **Native · LDI**. |
| NX-01–07 | [experiments/lldb-native-thread-control/thread-control.cln](../../../../experiments/lldb-native-thread-control/thread-control.cln) | **Rust Exclusive Step**, **C++ Exclusive Step**, then **C Exclusive Step**; one window each. |
| CS-01–07 | [experiments/netcoredbg-thread-control/thread-control.cln](../../../../experiments/netcoredbg-thread-control/thread-control.cln) | **C# Exclusive Step**, one window. Test installed stock netcoredbg separately from the optional patched build. |
| BP-01–07, BP-09–14, BP-16–20; RL-01–08 | [experiments/lldb-native-thread-control/thread-control.cln](../../../../experiments/lldb-native-thread-control/thread-control.cln) | A **Rust + C Lib**, **Rust + C++ Lib**, **Rust + C Threads**, or **Rust + C++ Threads** as specified; B **Native Libraries · Rust**. BP-06/07 need an added temporary fixture/config. |
| BP-08 and C# half of BP-15; CL-01–06 | [experiments/netcoredbg-thread-control/thread-control.cln](../../../../experiments/netcoredbg-thread-control/thread-control.cln) | A **C# Threads + C Threads** or **C# Threads + C++ Threads**; B **Native Libraries · C# LDI**. BP-08 is an open parity/design case. |
| Rust half of BP-15; EDGE-06 | [experiments/lldb-native-thread-control/thread-control.cln](../../../../experiments/lldb-native-thread-control/thread-control.cln) | Rust A and Native B as above; use the **Threads** variants for EDGE-06. |
| EDGE-01 | [experiments/netcoredbg-thread-control/thread-control.cln](../../../../experiments/netcoredbg-thread-control/thread-control.cln) | A C# caller and B native reproduction have **independent** debugger sessions. Rust live Native shares one session, so it cannot establish this case. |
| EDGE-05, EDGE-07 | Run **both paired solutions above**, in separate runs | Compare Rust live Native with C# LDI; record which A/B sessions and IDs each result belongs to. |
| EDGE-02–04 | [workspaces/mt-lab/mt-lab.cln](../../../../workspaces/mt-lab/mt-lab.cln) | Basic/Burst/Handoff as the individual case requires; repeat in C#, Rust, and C++ where applicable. |

Optional focused C# selector regression: [workspaces/mt-debugging-lab/mt-debugging-lab.cln](../../../../workspaces/mt-debugging-lab/mt-debugging-lab.cln), **Threads · C#**. It supplements MT-01–08; it does not replace the three-language `mt-lab` run.

**First desktop pass:** run MT-01–04 once in each language, NX-01–04 in Rust/C/C++, BP-01–02, BP-09–12, and BP-16 with all four saved Blue markers, then RL-01–02 and CL-01–04 for both native languages. Capture failures before moving to the deeper lifecycle and stress cases. Items labelled **fixture needed** or **open** are explicit coverage gaps; they are not prerequisites for trying the existing labs.

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
| **The Blue marker setup tooltip feels heavy.** | Screenshot: “Select a Rust Debug Power Config and a CMake Library Build Power Config.” Test it with neither config selected, only one selected, and both selected. It should name only the missing choice and tell you where to make it; it should disappear once the pair is valid. Candidate shorter copy: “Choose a Rust Debug config and a Native Library Build config.” If one is already chosen, ask only for the other. | BP-09 |
| **The Debug panel repeats long “Unreachable under this Power Config” messages.** | Screenshot: three C calls each repeat “Rust + C++ Threads excludes this ... call.” Switch C Threads ↔ C++ Threads with four Blues saved. The active call should be easy to spot and the inactive ones should remain understandable without dominating the panel. Candidate per-marker copy: “Not built in Rust + C++ Threads.” Candidate panel summary: “3 Blue breakpoints inactive for this build,” with individual call details available on demand. Record whether the shorter text still explains *which call* and *which config* are involved. | BP-01–02, BP-10 |
| **Solid Blue and Gold-bordered Blue look too similar or too bright.** | The four screenshots cycle through Rust+C/C++ Lib and Threads: one solid Blue is armed while three Gold-ringed Blues remain at saved call sites. At normal editor size, decide whether you can identify the armed one without hover. Compare a Gold ring touching a filled Red/Blue marker with one separated by a dark gap. Check selected/paused line, hover, and any available editor theme. Keep a screenshot of each state; changing color alone must not erase the inactive meaning. | BP-11 |
| **B closes while its Blue is still set in A.** | Close only the Native window, leaving Rust A and its source open. Does the Blue remain, turn pending/ghosted, or vanish? Can you discover a one-click or clear menu path to reopen/re-pair B, or does the old marker feel stuck? Compare this with a *ghost* Blue call site whose Gold border already offers to open B. Capture the exact hover/menu text and clicks needed. | BP-12–13, BP-16 |
| **All windows close and the solution is reopened.** | Test closing all solution windows while Craidd stays running, then a full app quit/relaunch, as separate cases. Record whether the Blue intent, partner choice, red breakpoints, and window arrangement survive each. A remembered Blue that cannot recover its partner is friction; a Blue that disappears raises a persistence decision. Do not assume the two close paths behave the same. | BP-17–18 |
| **⇥ Step Over kept entering C/C++ from Rust.** | Repeat with Blue/native red enabled, then disabled. A requested native breakpoint can stop the step in the library; the UI should reveal why it stopped there. There is no current one-shot “stay in Rust through this call” action. Record how often this interrupts the workflow as UX friction, even if the debugger is behaving correctly. | RL-03 |
| **Where is the native child thread picker?** | In Rust→C/C++ live Native, A owns the one LLDB session and B now exposes the same native child IDs and a selected-thread ⇥. Selecting in B also changes A's inspection target. In C#→C/C++ LDI, B owns a separate reproduction session. Record whether the window labels make that difference apparent. | RL-05–09, CL-01–03 |
| **A shows “ran for” but B omits it.** | Open both Rust/native thread dropdowns at the same paused stop. B should show the same debugger-observed running duration for each matching ID, or the same “running time unavailable” state. The duration excludes reported pauses and is not CPU time or proof that a worker advanced. | RL-09, MT-08 |
| **Window state seemed lost or a Welcome window appeared.** | Launch, stop, close or refocus B, then restart the pair. Check whether the correct session remains controllable, whether Gold/White Stop targets the owner, and whether a stale window shows old frames. Capture exact window count and launch plan; the earlier transient Welcome report was not reproduced. | RL-04, CL-04, EDGE-05 |
| **C# ⇥ appears to require a custom debugger.** | Compare installed stock netcoredbg with the optional user-supplied experiment executable. Preferences should show the actual executable, and the control should only appear for an advertised, qualified capability. A must never imply that Craidd ships or requires the patched debugger for ordinary C# debugging or C# LDI. | CS-01–04, CL-01 |

If a row feels confusing but the technical check passes, record it as **UX friction** in the result instead of silently marking the experience complete. The [linked-window friction record](../../ldi-debugging/linked-thread-ux-friction.md) keeps the earlier observations and current ownership model.

The suggested phrase “Power Config is not applicable for Native Breakpoints” is useful feedback on the wording's weight. In this case the selected Rust build excludes particular **Blue call sites**; other Blues and ordinary native red breakpoints may still work. Test shorter copy that names the affected call or build so users do not infer that all native breakpoints are disabled. These are copy candidates for your UX pass, not implemented UI changes.

## 1. Ordinary MT inspection: installed debuggers

Repeat **MT-01–08** with **C# Console · Basic**, **Rust Console · Basic**, and **C++ Console · Basic** from `workspaces/mt-lab/mt-lab.cln`. Put red on `BREAK_CS_BASIC`, `BREAK_RS_BASIC`, or `BREAK_CPP_BASIC` in the selected project. This section tests inspection and the adapter's actual stop scope; ordinary Step does not promise isolation.

- [Y] **MT-01** At red, the dropdown lists both named workers and the main thread when the adapter reports them. The triggering worker is identifiable. A briefly incomplete first LLDB `threads` reply does not permanently remove a stopped worker.

  -- Variant C#: Basic stop at Program.cs:21 listed `cs worker 1 #240445`, `cs worker 2 #240446` and `Main Thread #240423`. The focus was the worker that triggered, with Session reason `breakpoint`. evidence/2026-10-10/r1-001-mt01-cs-paused.png
  -- Variant Rust: main.rs:25 listed `rs worker 1`, `rs worker 2` and `mt-rust-console`. The second `threads` read 2.5 s later was identical (no incomplete first reply seen). evidence/2026-10-10/r2-001-mt01-rs-paused.png
  -- Variant C++: main.cpp:37 listed `cpp worker 1`, `cpp worker 2` and `mt_cpp_console`. evidence/2026-10-10/r2-008-mt01-cpp-paused.png
  -- Evidence: Threads dropdown text captured per language (run log).
  -- Reasoning and UX: Pass. The triggering worker shows only as the default inspection focus. No row says “hit breakpoint”, so with two workers on one line a user cannot tell which one triggered.

- [Y] **MT-02** Select worker 1, then worker 2 without executing. Stack, source line, locals (`marker`), and toolbar focus change together. Selection alone does not resume the program or produce new worker output.

  -- Variant C#: worker 1 → `number 1, marker 0`; worker 2 → `number 2`. Stack, line and toolbar focus changed together; the session stayed paused and no new output appeared. evidence/2026-10-10/r1-002-mt02-cs-w1.png, evidence/2026-10-10/r1-003-mt02-cs-w2.png
  -- Variant Rust: worker 1/2 locals `number 1`/`number 2`. `marker` is not yet in scope at the `let marker` line. evidence/2026-10-10/r2-002-mt02-rs-w2.png
  -- Variant C++: at line 37 both workers show `marker 0` (the captured `number` is not listed), so the locals cannot distinguish them. At line 39, worker 2 showed `marker 20, beat 1, sample 20` and worker 1 switched to its libc sleep frame. evidence/2026-10-10/r2-011-mt02-cpp-w1-line39.png
  -- Evidence: Debug panel text before/after each selection (run log).
  -- Reasoning and UX: Selection did not resume anything. In C++ at the first stop the panel looks identical for both workers; only the dropdown label changes.

- [Y] **MT-03** Inspect a worker paused in `Join`, `Sleep`, a channel, or native/runtime code with no source line. Its stack remains inspectable; source stepping is unavailable or honestly disabled. Continue can reach a later source breakpoint.

  -- Variant C#: `Main Thread` in `Thread.Join():0` → stack inspectable; ↷↓↑ disabled with “This thread has no source line…”; dropdown shows the runtime-code notice. Pass. Minor defect: the Session block renders a bare `0` as the location (React prints `pausedLine` 0). evidence/2026-10-10/r1-004-mt03-cs-main.png, evidence/2026-10-10/r1-005-mt03-cs-main-menu.png
  -- Variant Rust: `mt-rust-console` top frame is `` libc.so.6`___lldb_unnamed_symbol_a08c0:15 `` (LLDB disassembly). Craidd treats it as a source line, so **↷ and ⇥ stay enabled**. Continue from there reached the later red at main.rs:27 (pass for that part). evidence/2026-10-10/r2-003-mt03-rs-main.png, evidence/2026-10-10/r2-004-mt03-rs-continue-later-bp.png
  -- Variant C++: same as Rust: `mt_cpp_console` at `` libc.so.6`…:15 `` has ↷ and ⇥ enabled. Continue reached the later red at main.cpp:39. evidence/2026-10-10/r2-009-mt03-cpp-main.png
  -- Reasoning and UX: **Functional failure (LLDB variants).** A frame without real source is offered source stepping. Repro: mt-lab, Rust Console · Basic, red on BREAK_RS_BASIC, Debug, select the main thread. See NX-01/NX-05 for the consequence.
  -- Repair checkpoint: On the later working-tree build, the Rust main thread's libc frame kept its stack visible and disabled ⇥ and ordinary source Step with an explanation. Repeat this exact `mt-lab` case and the C++ source-less variant before changing the historical verdict.
  -- Retest (b7d173f, 12 Oct): exact `mt-lab` cases. Rust main (`mt-rust-console`, top frame libc `___lldb_unnamed_symbol_a08c0:15` under `JoinHandle::join`) and C++ main (`std::thread::join`) keep their stacks; ↷ ↓ ↑ ⇥ are all disabled with “This thread has no source line…”, and the dropdown shows the runtime-code notice. Continue then reached the later red (main.rs:27 / main.cpp:39). C# main in `Thread.Join():0`: same controls disabled, and the bare `0` location is gone. evidence/2026-10-12/p2a-017-mt03-rs-main.png, evidence/2026-10-12/p2a-018-mt03-rs-later-bp.png, evidence/2026-10-12/p2a-019-mt03-cpp-main.png, evidence/2026-10-12/p2a-020-mt03-cpp-later-bp.png, evidence/2026-10-12/p2a-021-mt03-cs-main.png, evidence/2026-10-12/p2a-022-mt03-cs-later-bp.png
  -- Verdict: Y on b7d173f for C#, Rust and C++. The N above records 856859e.

- [Y] **MT-04** Try ordinary Step Over, Into, and Out. Record the requested thread, the `continued`/`stopped` scope, and which thread actually stops next. If the adapter resumes all threads, another worker hitting red first is reported as such rather than claimed as an isolated step.

  -- Variant C#: requested worker 1 Step Over → next stop `Program.cs:21`, reason `breakpoint`, focus **worker 2** (it hit the shared red first). Step Into → `step` at :22 on worker 2; Step Out → running → terminated.
  -- Variant Rust: with red at main.rs:27, Step Over/Into/Out on worker 1 stayed on worker 1 (`step` at :28, `rt.rs:47`, back to :28). evidence/2026-10-10/r2-005-mt04-rs-after-steps.png
  -- Variant C++: Step Over/Into on worker 1 → :40, :41; Step Out → reason `breakpoint` at :39 with focus **worker 2**. evidence/2026-10-10/r2-010-mt04-cpp-after-steps.png
  -- Evidence: traced status/where/reason/focus after every click (run log). Output shows no `continued`/`stopped` scope lines; the arrows' tooltips say “may resume all threads”.
  -- Reasoning and UX: Pass. Another worker winning is reported as a `breakpoint` stop with changed focus, not as a completed step. The focus change is silent apart from the label, so the watchlist's “silent jump” concern remains UX friction.

- [ ] **MT-05** Run **Debug Burst** for each language twice. Active rows follow the adapter's current membership; the latest three completed workers appear newest first under **Recently completed**; older completed rows leave that list.

  -- Status: NOT RUN
  -- Observed: Burst configurations were not run.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **MT-06** Run **Debug Handoff** for each language. Inspect producer, consumer, and main while one waits. Switching inspection does not release the wait; normal Continue lets the handoff complete.

  -- Status: NOT RUN
  -- Observed: Handoff configurations were not run.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **MT-07** Stop and restart. Old thread IDs, selected frames, locals, paused/running badges, completed rows, and timers disappear; new IDs are session-specific even if a numeric ID is reused.

  -- Status: INCONCLUSIVE
  -- Variant Rust: Stop cleared frames, threads, Variables and the dropdown (Session `terminated`). Restart gave new IDs `#247112/#247113` versus `#246921/#246922`, with no stale rows. evidence/2026-10-10/r2-006-mt07-rs-stopped.png, evidence/2026-10-10/r2-007-mt07-rs-restarted.png
  -- Variant C#/C++: NOT RUN as a deliberate Stop/restart check (a C# restart happened between MT runs, with new IDs, but was not inspected).
  -- Reasoning and UX: The Rust variant passes; the other languages need their own run.

- [ ] **MT-08** With a long pause, verify **ran for** excludes debugger-reported paused time. Treat it as observed wall time, never CPU usage or proof that a worker advanced.

  -- Status: INCONCLUSIVE
  -- Observed: After multi-minute pauses, C# showed `ran for 3ms` and Rust `ran for 1–2ms`, so debugger-reported pauses are excluded. In the NX-05 leaked-hold state, workers that LLDB held suspended (kernel `t (tracing stop)`) showed **`running · ran for 54.6s`**.
  -- Evidence: evidence/2026-10-10/r1-005-mt03-cs-main-menu.png, evidence/2026-10-10/r2-019-nx05-rust-leaked-hold.png
  -- Reasoning and UX: Consistent with “observed wall time, not proof of progress”, but the timer can show minutes of “running” for threads that never ran. No deliberate long-pause measurement was made per language.

For the GUI variants in `mt-lab`, use **C# GUI · MT**, **Rust GUI · MT**, and **C++ GUI · MT** where their prerequisites are installed:

- [ ] **GUI-01** Start waiting workers, inspect the UI thread and workers, release them, and confirm the app stays responsive and the cohort finishes. Repeat the button to catch stale rows/IDs.

  -- Status: NOT RUN
  -- Observed: GUI variants were not run in this pass, and their prerequisites (Avalonia, Tauri frontend npm install, GTK4) were not checked.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **GUI-02** Launch the short-worker burst repeatedly. Rows appear/exit without retaining an old stopped stack or applying a late response to a newly selected worker.

  -- Status: NOT RUN
  -- Observed: GUI variants were not run in this pass, and their prerequisites (Avalonia, Tauri frontend npm install, GTK4) were not checked.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **GUI-03** Run producer/consumer or native-call variants available to that GUI. A wait is shown as a wait; selecting the UI thread does not silently resume the worker. Note missing GTK4, Avalonia, or Tauri prerequisites as **BLOCKED**, not failed MT behavior.

  -- Status: NOT RUN
  -- Observed: GUI variants were not run in this pass, and their prerequisites (Avalonia, Tauri frontend npm install, GTK4) were not checked.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

## 2. ⇥ selected-thread Step Over: native LLDB

Use `experiments/lldb-native-thread-control/thread-control.cln` with the installed LLDB-DAP supported by this branch (currently qualified on Linux LLDB-DAP 23.1.1 with scripting). Repeat **NX-01–06** for **Rust Exclusive Step**, **C++ Exclusive Step**, and **C Exclusive Step**. The C fixture is compiled C code through Craidd's current CMake/C++ route.

- [Y] **NX-01** Put red on `BREAK_NATIVE`. When both workers have paused source frames, ⇥ appears. On an unqualified debugger build, source-less frame, or stop not verified to cover all threads, it is unavailable with an accurate reason; ordinary Step remains usable.

  -- Variant Rust/C++/C: at `BREAK_NATIVE` with both workers paused, ⇥ appears with the title “Experimental: Step selected thread only” (LLDB-DAP 23.1.1). evidence/2026-10-10/r2-012-nx01-rust-paused.png, evidence/2026-10-10/r2-020-nx01-cpp-paused.png, evidence/2026-10-10/r2-028-nx01-c-paused.png
  -- Variant Rust (source-less): selecting `rust-exclusive-` (main, top frame `` libc.so.6`___lldb_unnamed_symbol_a08c0:15 ``) leaves **⇥ and ↷ enabled**. evidence/2026-10-10/r2-016-nx01-rust-main-sourceless.png C++/C source-less frames were not selected in the experiment; the mt-lab C++ main frame showed the same enabled ⇥.
  -- Reasoning and UX: **Functional failure.** The disassembly `source` returned by LLDB counts as a source line, so the “source-less → unavailable with reason” rule never fires. Clicking it led to the NX-05 stall and leak.
  -- Repair checkpoint: The later Rust Exclusive Step desktop run disabled ⇥ on the libc main frame; see the repair log. C/C++ source-less selections still need a run on the repair.
  -- Retest (b7d173f, 12 Oct): ⇥ appears at source worker stops in Rust, C++ and C. Source-less frames disable ⇥ and ordinary Step with the source-less reason: Rust main in libc `join`; C++ worker in `__mmap` under `operator new`; C workers in `__mmap`/`__munmap`. evidence/2026-10-12/p2b-070-nx01-rust-main-b7d173f.png, evidence/2026-10-12/p2a-003-nx01-cpp-worker-sourceless.png, evidence/2026-10-12/p2a-009-nx01-c-worker-sourceless.png
  -- Verdict: Y on b7d173f for all three. The N above records 856859e.

- [Y] **NX-02** Record `worker-1.txt` and `worker-2.txt` under that project's `runs/rust`, `runs/cpp`, or `runs/c`. Select worker 1 and use ⇥ until the file write executes (often two steps): expect `1001` and `0`. Record both values **after each stop**.

  -- Variant Rust: worker 1 ⇥: step 1 → :22 (`0/0`), step 2 → :23 (`1001/0`); worker 2 stayed at main.rs:21 after each stop. evidence/2026-10-10/r2-013-nx02-rust-w1.png
  -- Variant C++: step 1 → :37 (`0/0`), step 2 → :38 (`1001/0`); worker 2 fixed at :36. evidence/2026-10-10/r2-021-nx02-cpp-w1.png
  -- Variant C: step 1 → :36 (`0/0`), step 2 → :37 (`1001/0`); worker 2 fixed at :35. evidence/2026-10-10/r2-029-nx02-c-w1.png
  -- Evidence: `RustExclusiveStep/runs/rust`, `CppExclusiveStep/runs/cpp`, `CExclusiveStep/runs/c` read after every stop.
  -- Reasoning and UX: Matches expectation exactly (two steps to the write).

- [Y] **NX-03** Switch to worker 2 at a source frame and step until its write executes: expect `1001` and `2001`. Check the unselected worker's source/instruction location as well as its file. Switching focus alone must not advance worker 1.

  -- Variant Rust: worker 2 ⇥ → `1001/0` then `1001/2001`; worker 1 stayed at :23. Switching focus alone did not move worker 1. evidence/2026-10-10/r2-014-nx03-rust-w2.png
  -- Variant C++: `1001/2001`; worker 1 fixed at :38. evidence/2026-10-10/r2-022-nx03-cpp-w2.png
  -- Variant C: `1001/2001`; worker 1 fixed at :37. evidence/2026-10-10/r2-030-nx03-c-w2.png
  -- Reasoning and UX: Pass. The unselected worker's source line was checked after every stop, as well as its file. Instruction addresses were not read; source lines were used instead.

- [Y] **NX-04** Ordinary Continue releases the one-step holds and both workers finish. Repeat after Stop/restart, then reverse the worker order. No previous lease, thread ID, or selected frame survives.

  -- Variant Rust/C++/C: after removing red, Continue → terminated with `1012/2012`. Restart gave new IDs (e.g. Rust `#249156/#249157`, C++ `#250098/#250099`, C `#250709/#250710`). Reversed order (worker 2 first) → `0/2001` then `1001/2001`, with the other worker fixed; final `1012/2012`. evidence/2026-10-10/r2-015-nx04-rust-finished.png, evidence/2026-10-10/r2-023-nx04-cpp-finished.png, evidence/2026-10-10/r2-031-nx04-c-finished.png
  -- Evidence: counters and IDs in the run log.
  -- Reasoning and UX: No lease, ID or selected frame survived a restart.

- [Y] **NX-05** Step a thread into a lock/wait whose owner is held. Observe the stall rather than a false successful step. Pause, use the recovery release action at a verified all-thread stop if offered, then Continue or Stop; record any Output hold/release error and confirm no worker is left suspended.

  -- Observed (Rust): the selected thread was the main thread blocked in `join` (reached through the NX-01 defect, not the `blocked.cpp` lock fixture). ⇥ → status `running` for 12 s; workers held at `1001/2001`; the dropdown said “Stepping rust-exclusive- #249153… use Pause or Stop to recover” and offered **Release native holds**. Pause → verified all-thread stop (reason `step`); the release button disappeared. After removing red and Continue, the UI showed all three threads `running`, but the counters stayed at `1001/2001` for 45 s+. `/proc/<pid>/task/*/status` showed both workers in **`t (tracing stop)`**. Output had no hold/release error (only `threads: notStopped`), and no release action was offered.
  -- Evidence: evidence/2026-10-10/r2-017-nx05-rust-main-step-blocked.png, evidence/2026-10-10/r2-018-nx05-rust-paused-recovery.png, evidence/2026-10-10/r2-019-nx05-rust-leaked-hold.png; PID 249153.
  -- Reasoning and UX: **Functional failure: workers left suspended after Pause → Continue, while the UI claims they are running.** Stop killed the process, and the next Debug run started clean (`0/0` → `1001/0` → `1012/2012`). Repro: Rust Exclusive Step, red BREAK_NATIVE, Debug, select `rust-exclusive-`, ⇥, Pause, remove red, Continue.
  -- Repair checkpoint: The later Rust desktop run stepped from main.rs:27 into a blocked join, paused, continued, and terminated with `1012/2012`. This confirms that recovery path; the original breakpoint path, C/C++, and lock fixture still need retest.
  -- Retest (b7d173f, 12 Oct): each fixture with red only on main's join line (Rust main.rs:27, C++ main.cpp:42, C main.c:63), then red removed and ⇥ on main. In every language: status `running`, counters held at `0/0` for 3–4 s, and the dropdown offered “Release native holds”. Pause → “One-thread Step requested <main>, but stopped on <main> (exception)” with step controls disabled at the source-less frame. Continue → terminated at `1012/2012`. Output had no hold/release lines. The wait is a join on held workers; `blocked.cpp` has no Craidd config, so the mutex fixture was not used. evidence/2026-10-12/p2b-074-nx05-rust-blocked.png, evidence/2026-10-12/p2b-075-nx05-rust-paused.png, evidence/2026-10-12/p2b-076-nx05-rust-after-continue.png, evidence/2026-10-12/p2a-004-nx05-cpp-blocked.png, evidence/2026-10-12/p2a-005-nx05-cpp-paused.png, evidence/2026-10-12/p2a-006-nx05-cpp-after-continue.png, evidence/2026-10-12/p2a-010-nx05-c-blocked.png, evidence/2026-10-12/p2a-011-nx05-c-paused.png, evidence/2026-10-12/p2a-012-nx05-c-after-continue.png
  -- Verdict: Y on b7d173f for all three. The N above records 856859e. Adding a Craidd config for `blocked.cpp` would cover the literal mutex case.

- [ ] **NX-06** Try Stop during an outstanding ⇥ and a breakpoint/exception arriving during it. Check that the session terminates or stops cleanly and that no leaked hold affects the next Debug run.

  -- Status: INCONCLUSIVE
  -- Observed: Stop after the NX-05 leaked hold terminated the process (no remaining PID), and the next run was clean. Stop *during* an outstanding ⇥, and a breakpoint arriving during ⇥, were not attempted.
  -- Evidence: NX-05 run log.
  -- Reasoning and UX: Only the “next run is clean” part is covered.
  -- Retest (b7d173f, 12 Oct): Variant C, Stop during outstanding ⇥: ⇥ main into the held join, then Stop after 3.5 s → `terminated`, PID 119838 gone, no thread menu left. The next C runs were clean. evidence/2026-10-12/p2a-013-nx06-c-stop-during-step-before.png, evidence/2026-10-12/p2a-014-nx06-c-stop-during-step-after.png
  -- Variant C, breakpoint during ⇥: worker 1 at main.c:36, red added inside `write_count` (:19), ⇥ → stopped `breakpoint` at :19 on the same thread, with “One-thread Step requested c step 1 #120233, but stopped on #120233 (breakpoint)”. Worker 2 stayed at :35. Removing red and Continue → `1012/2012`. evidence/2026-10-12/p2a-016-nx06-c-breakpoint-during-step.png
  -- Status: INCONCLUSIVE. Rust/C++ variants and an exception arriving during ⇥ not run.

- [ ] **NX-07 — open stress case** Spawn/exit a thread while ⇥ is in flight; compare membership and work before/after. The current one-step snapshot only covers known threads, so record this as a limitation or failure of a stronger isolation claim, not as a pass inferred from NX-02.

  -- Status: NOT RUN
  -- Observed: Open stress case; no spawn/exit-during-⇥ fixture was driven.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

## 3. C# capability boundary and optional experiment

Use `experiments/netcoredbg-thread-control/thread-control.cln`. The patched Samsung netcoredbg binary is **user-supplied, ignored by Git, and not distributed by Craidd**. Record its actual executable path. Repeat the stock-debugger checks first.

- [Y] **CS-01** With installed stock `netcoredbg`, **C# Exclusive Step** still exposes ordinary inspection and Step. ⇥ is absent/disabled unless the adapter truly advertises a qualified one-thread capability; Craidd must not imply isolation from a thread ID alone.

  -- Observed: C# Exclusive Step with installed stock netcoredbg 3.2.0-1: ↷↓↑ shown (“may resume all threads”); **no ⇥**. The dropdown explains that Step may let another worker win. Step Over on `exclusive worker 1` → stop `breakpoint` at Program.cs:21 with focus `exclusive worker 1 #275338` after the other worker's hit.
  -- Evidence: evidence/2026-10-10/r2-082-cs01-stock-netcoredbg.png
  -- Reasoning and UX: Pass. Nothing implies isolation.

- [ ] **CS-02** If testing a standard-DAP adapter that advertises `supportsSingleThreadExecutionRequests`, verify Craidd sends `next` with `singleThread: true` and qualify behavior with both counters. Capability advertisement alone is not a passing isolation test.

  -- Status: NOT RUN
  -- Observed: No standard-DAP adapter that advertises `supportsSingleThreadExecutionRequests` was available.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CS-03** Choose the locally built patched executable in **File → User Preferences → Toolchain → C# → Debugger**. Confirm Craidd recognizes it and ⇥ is enabled only at an all-thread stop with a selected source line. Restore **Automatic** after the optional run.

  -- Status: NOT RUN
  -- Observed: The optional patched netcoredbg was not built or selected; this pass used stock netcoredbg only.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CS-04** Put red on `BREAK_EXCLUSIVE`. In `CSharpExclusiveStep/runs/basic/`, record both worker files. Step worker 1 to a write while worker 2 stays fixed, then switch at a source frame and step worker 2 while worker 1 stays fixed. Use the files, not dropdown timers, as execution evidence. Refresh File Discovery if `runs/basic/` has just been created.

  -- Status: NOT RUN
  -- Observed: Needs the patched netcoredbg build (CS-03).
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CS-05** Select a worker paused without a source line. ⇥ is unavailable or gives a clear adapter error; it must not silently step the previously selected worker. Continue to a source breakpoint, then retry.

  -- Status: NOT RUN
  -- Observed: Needs the patched netcoredbg build (CS-03).
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CS-06** Block the selected worker behind another managed worker, Pause, retry managed hold release at a verified all-thread stop if needed, and Continue or Stop. Record any `CRAIDD_HOLDS`/`CRAIDD_RELEASE` failure and verify the next run starts cleanly.

  -- Status: NOT RUN
  -- Observed: Needs the patched netcoredbg build (CS-03).
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CS-07 — open recovery matrix** Exercise new/exiting threads, exception stops, detach from an attached process, debugger crash, GC/lock pressure, and deliberate release failure. Keep each case unpassed until an actual desktop result exists.

  -- Status: NOT RUN
  -- Observed: Open recovery matrix.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

## 4. Blue native breakpoints across Power Configs

Open `experiments/lldb-native-thread-control/thread-control.cln` in two windows. Choose a Rust caller config in A and **Native Libraries · Rust** in B. Put Blue on all four source sites in `RustLinkedStep/src/main.rs`: `BLUE_RUST_C`, `BLUE_RUST_CPP`, `BLUE_RUST_C_THREADS`, and `BLUE_RUST_CPP_THREADS`. A Blue is a **source-site intent**. Its current eligibility must be recalculated from the selected build and native pairing, without discarding it. BP-08 and the C# half of BP-15 instead use the C# experiment `.cln` shown in the solution map.

- [Y] **BP-01** Under **Rust + C Threads**, the compiled `BLUE_RUST_C_THREADS` site is normal Blue; `#[cfg]`-excluded sites remain visible with a Gold border and are skipped at launch. Switch to **Rust + C++ Threads**: the corresponding C++ site becomes normal, prior C site gains Gold border, and no stale “Native pairing changed” warning blocks the eligible site. Switch back and confirm the same saved markers recover.

  -- Observed: **Rust + C Threads**: 26 (`step_pair_c`) solid Blue “→ CS3 … Rust White Debug”; 16/21/31 `blue unreachable` (Gold border), each “Unreachable under the selected Power Config: Rust + C Threads excludes this … call. The breakpoint stays here…”. **→ C++ Threads**: 31 normal, 16/21/26 Gold. **→ C Threads**: same four markers recovered; no “Native pairing changed” warning at any point. Launch: White Debug stopped at `step_pair_c` (step.c:20) called from main.rs:26; no excluded site armed.
  -- Evidence: evidence/2026-10-10/r2-038-bp01-c-threads-four-blues.png, evidence/2026-10-10/r2-039-bp01-cpp-threads.png, evidence/2026-10-10/r2-040-bp01-c-threads-back.png, evidence/2026-10-10/r2-044-rl01-bp01-A-at-blue.png, evidence/2026-10-10/r2-045-rl01-bp01-B-native-entry.png
  -- Reasoning and UX: The reported regression did not reproduce. The C++ Threads launch itself was not run.

- [ ] **BP-02** Repeat the round trip through **Rust + C Lib** and **Rust + C++ Lib**. Inspect every marker tooltip and launch preview. A Gold-bordered, proven unreachable marker is not armed and does not prevent other eligible Blues from working.

  -- Status: INCONCLUSIVE
  -- Observed: **Rust + C Lib**: 16 normal, others Gold. **Rust + C++ Lib**: 21 normal, others Gold. **→ C Threads**: back to 26 normal. Every tooltip names the excluding config and call. In a C Lib run, the armed `step_add_c` Blue stopped in `step.c:7` while the Gold ones did not interfere. Rust White Debug shows **no launch-preview dialog**; the Debug panel list is the only preview.
  -- Evidence: evidence/2026-10-10/r2-041-bp02-c-lib.png, evidence/2026-10-10/r2-042-bp02-cpp-lib.png, evidence/2026-10-10/r2-043-bp02-c-threads-final.png, evidence/2026-10-10/r2-055-rl02-A-w1.png
  -- Reasoning and UX: C Lib launch passed. The C++ Lib launch was not run, and the requested launch preview does not exist for Rust live Native. Judge whether the Debug panel is a clear enough preview before signing off.
  -- Retest (b7d173f, 12 Oct): **Rust + C++ Lib** launch with Blue on 21 and red on the same line: first stop red main.rs:21, Continue → Blue native entry `step.cpp:7` (B “Rust-owned native inspection · paused”), then the next red. Gold-bordered 16/26/31 never stopped. evidence/2026-10-12/p2a-026-bp03-cpp-lib-red-and-blue-21.png, evidence/2026-10-12/p2a-027-bp02-cpp-lib-stop-1.png, evidence/2026-10-12/p2a-028-bp02-cpp-lib-stop-2.png
  -- Status: still INCONCLUSIVE only for the human call on whether the Debug panel is an adequate launch preview; both launches pass.

- [Y] **BP-03** Click a Gold-bordered Blue to inspect/remove exactly that source-site intent; create it again and switch config. Removing one does not delete another. A red breakpoint on the same line retains ordinary red behavior.

  -- Observed (b7d173f, A Rust + C Threads, B Native Libraries · Rust CS2): left-click on Gold-bordered 21 → menu “Set Red Breakpoint / Unreachable… Blue remains at this call site. / Remove Blue Breakpoint”. Set Red, then right-click → **Remove Blue Breakpoint** removed only Blue 21. 16/26/31 and the red at main.rs:21 remained. Right-click → “Set Native Debugging Breakpoint → CS2: Native Libraries · Rust” recreated it. Under Rust + C++ Lib, 21 became normal and the red still stopped first (see BP-02 retest).
  -- Evidence: evidence/2026-10-12/p2a-024-bp03-gold-menu.png, evidence/2026-10-12/p2a-025-bp03-after-remove-blue-21.png, evidence/2026-10-12/p2a-026-bp03-cpp-lib-red-and-blue-21.png
  -- Reasoning and UX: Pass. Friction: while red and Blue share a line, the gutter shows only the Blue marker; the red is visible only in the Breakpoints list and the hover (“Breakpoint · line 21 | Native Debugging Breakpoint…”).
  -- Human UX review (12 Oct, after 3717e0d): red and Blue should both be visible at one source line. The menu already exposes both actions, but the marker does not. red/Blue gutter (local: evidence/2026-10-12/human-bp03-red-blue-gutter.png), combined menu (local: evidence/2026-10-12/human-bp03-red-blue-menu.png), options (local: evidence/2026-10-12/human-bp03-red-blue-options.png). A working-tree composite marker is pending a live two-window retest; keep this Y for the historical breakpoint-behavior test, not as UI approval.
  -- Focused desktop retest (12 Oct, working tree): red and Blue on main.rs:26 share one red/Blue split glyph; red and unreachable Blue on main.rs:31 share a split glyph with the muted Gold border. Both red breakpoints stayed in the Breakpoints list. dual marker in the live editor (local: evidence/2026-10-12/red-blue-dual-after.png). The menu's behavior under this exact composite glyph still needs a human click pass.
  -- Human follow-up (12 Oct): the plain split red/Blue glyph (local: evidence/2026-10-12/human-dual-active-good.png) looks good, while Gold touching that split glyph (local: evidence/2026-10-12/human-dual-unreachable-muddy.png) looks muddy. Preserve the two-color centre; judge the separated warning ring under BP-11.

- [ ] **BP-04** Change the Native window's build Power Config or make its expected export unavailable. Distinguish **proven unreachable** (Gold border with reason) from **unresolved/missing/stale/ambiguous evidence** (needs attention or pending). Do not silently arm the wrong export or call every uncertain state unreachable. Restore the correct partner and verify eligibility returns.

  -- Status: NOT RUN
  -- Observed: The Native build config / export was not changed.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **BP-05** Switch Power Config while a debug session is active. The running binding and captured LDI origin stay fixed; the new selection requires a new build/debug preparation before another binding can arm. Stop/restart and verify the new config binds the intended source and native entry.

  -- Status: NOT RUN
  -- Observed: Power Config was not switched during an active session.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **BP-06 — fixture needed** Add a temporary test config that compiles the **same** Rust FFI source call and compatible native export as another config. One Blue must remain normal under both and actually stop at the same call. The current four `#[cfg]` arms alone cannot prove this case.

  -- Status: OPEN
  -- Observed: No same-call fixture exists.
  -- Evidence: None.
  -- Reasoning and UX: Needs the temporary config/fixture first.

- [ ] **BP-07 — fixture needed** Create two distinct source call sites for the same export. They retain separate Blue intents and eligibility; neither is coalesced away by a config change.

  -- Status: OPEN
  -- Observed: No two-call-site fixture exists.
  -- Evidence: None.
  -- Reasoning and UX: Needs a fixture.

- [ ] **BP-08 — open C# parity** Repeat same-call/conditional-build/export-missing/pending cases for C#→C/C++ Power Configs. The Rust resolver has targeted code tests; full C# Gold-border reachability is still a design target, so record unsupported behavior as **OPEN**, not as already supported.

  -- Status: OPEN
  -- Observed: Under **C# Threads + C++ Threads**, the `BLUE_C_CALL` Blue (line 23) stayed solid Blue “→ CS2 · step_add_c”. The C path is a runtime `if`, so no Gold border is expected.
  -- Evidence: CL-01 C++ run log; evidence/2026-10-10/r2-078-cl01-cpp-A-held.png
  -- Reasoning and UX: C# Gold-border reachability is still a design target.

- [Y] **BP-09 — setup copy** Trigger the Blue setup tooltip with zero, one, and both required Power Configs selected. Record the exact text and whether it identifies the missing action. A generic two-config instruction after one is already chosen is UX friction; an instruction after both are valid is a state bug.

  -- Observed both selected (A Rust + C Threads, B Native Libraries · Rust): no setup copy; ghost hover “Set Native Debugging Breakpoint → CS2: Native Libraries · Rust (step_pair_c). Left-click to set it; right-click for other breakpoint options. Rust White Debug · live process.”
  -- Observed only A selected (B switched to Rust Exclusive Step): ghosts gained `ghost-needs-window`; hover “⚠ You need to duplicate this window and open Power Config: Native Libraries · Rust, where step_pair_c exists. If you left-click, the IDE will try to do this for you. Right-click for other breakpoint options.” Left-click opened a **new** window (CS3, Native Libraries · Rust) and set a normal Blue.
  -- Observed neither (window on C++ Exclusive Step, RustLinkedStep/main.rs open): no ghost markers and no hover at all.
  -- Evidence: evidence/2026-10-10/r2-034-bp09-ghost-hover-both-selected.png, evidence/2026-10-10/r2-035-bp09-one-selected-hover.png, evidence/2026-10-10/r2-036-bp09-one-selected-click.png, evidence/2026-10-10/r2-037-bp09-zero-selected-hover.png
  -- Reasoning and UX: The “Select a Rust Debug Power Config and a CMake Library Build Power Config” copy never appeared, and the one-selected copy names only the missing choice. UX friction for human review: the zero state gives no hint that Blue exists; “duplicate this window” wording; the old B was left with role live-native after picking a Rust config.

- [ ] **BP-10 — warning density** With four saved Blues, switch among all Rust+C/C++ Power Configs. Count repeated inactive-call lines in the Debug panel, compare them with the active call, and note whether you can find the next action at a glance. Keep the marker's detailed reason accessible even if the panel becomes a compact summary.

  -- Status: INCONCLUSIVE
  -- Observed: With four Blues, the LDI panel always shows four entries: one active line pair (“B inspects the real Rust process at native entry. / Rust White Debug activates this pair…”) and **three** “Unreachable under this Power Config: Rust + … excludes this … call” lines. Entries keep insertion order (`step_pair_c` first), so under C++ Threads the active `step_pair_cpp` is **last**.
  -- Evidence: evidence/2026-10-10/r2-039-bp01-cpp-threads.png, evidence/2026-10-10/r2-041-bp02-c-lib.png
  -- Reasoning and UX: Needs a human judgement on density. Objective note: the active call is not sorted first.

- [ ] **BP-11 — marker contrast** Capture solid Blue, Gold-bordered Blue, pending Blue, ghost Blue with Gold border, and red in the same editor theme at normal size; repeat in other supported themes. Can you pick the currently armed Blue within five seconds without hover? Is the Gold border too bright or visually close to white? Check hover/focus/paused-line overlap and color-independent cues. Record which pair of states you confused and a screenshot; do not choose a new color before seeing the failure.

  -- Status: INCONCLUSIVE
  -- Observed: Captured solid Blue (16) beside Gold-bordered Blue (21/26/31) at normal size and 3×, pending Blue (BP-12), ghost Blue and red, all in the default dark theme only. The Gold ring renders as an orange-yellow outline around the same blue fill.
  -- Evidence: evidence/2026-10-10/bp11-gutter-solid-vs-gold-3x.png, evidence/2026-10-10/r2-058-bp12-after-close-B.png, evidence/2026-10-10/r2-034-bp09-ghost-hover-both-selected.png
  -- Reasoning and UX: The five-second recognition judgement and the theme comparison are human UX calls.
  -- Human UX review (12 Oct, after 3717e0d): the separated ghost Gold ring is good, and solid/pending Blue are good. The Gold border touching a filled Blue is too bright against Blue at normal size. good separated ring (local: evidence/2026-10-12/human-bp11-ghost-gold-good.png), high-contrast filled marker (local: evidence/2026-10-12/human-bp11-unreachable-high-contrast.png), solid Blue (local: evidence/2026-10-12/human-bp11-solid-blue-good.png), pending Blue (local: evidence/2026-10-12/human-bp11-pending-blue-good.png). A darker filled-Blue border is a working-tree proposal; retest it at normal size and in supported themes before marking BP-11.
  -- Focused desktop retest (12 Oct, working tree): the filled Gold-bordered Blue uses a muted brown border; the separated ghost Gold ring keeps its brighter border. normal-size editor capture (local: evidence/2026-10-12/red-blue-dual-after.png). Human comfort and theme checks remain open.
  -- Human follow-up (12 Oct): the muted touching border still looks muddy on a split Red/Blue marker. The ghost warning ring with a dark gap (local: evidence/2026-10-12/human-ghost-warning-gap-good.png) looks clearer; the filled warning tooltip (local: evidence/2026-10-12/human-active-unreachable-tooltip.png) confirms the inactive meaning. The current proposal uses the same separated Gold ring around a filled Blue or split Red/Blue centre. Retest the rendering and five-second recognition before BP-11 passes.
  -- Focused desktop retest (12 Oct, working tree): the filled or split marker now keeps its full-size centre and uses the same Gold outline and 2px gap as the ghost warning state. Normal-size separated-ring capture (local: evidence/2026-10-12/red-blue-separated-warning-ring.png). The rendering is confirmed; human visual approval and other-theme checks remain open.
  -- Human review (12 Oct): after seeing the separated-ring capture, ShinkuKira21 said “yeah looks good!” for this default dark-theme appearance. The contrast concern is accepted for that view; the five-second recognition and other-theme checks remain open, so BP-11 stays unchecked.

- [Y] **BP-12 — close B while idle** With A open, four Blues saved, and no active Debug, close only B. Record each marker's appearance and tooltip, the Debug panel state, and whether the active Blue is silently left pointing at a dead window. Attempt White Debug and record the actual feedback; it must not arm a stale B binding or invent a native stop.

  -- Observed: Closed only B (CS3) from A's window list; no confirmation. Blue 26 became `blue pending`: “⚠ Debugging window is no longer open”. 16/21/31 kept Gold with only their unreachable reason. The panel still lists all four as “→ CS3”. White Debug in A built Native and ran; it did **not** stop at the Blue entry. The only stop was the ordinary shared red at step.c:25, and no B binding was armed.
  -- Evidence: evidence/2026-10-10/r2-058-bp12-after-close-B.png, evidence/2026-10-10/r2-059-bp12-white-debug-without-B.png
  -- Reasoning and UX: Pass, with the marker visibly flagged rather than silently pointing at a dead window. Friction: “→ CS3” still names the dead window.

- [N] **BP-13 — recovery from A** After BP-12, left-click the saved Blue and inspect its menu, then inspect the ghost Blue at an unset call site. Can either open or show B, select a compatible Native Power Config, and set/rebind the Blue without deleting it first? Record the exact labels, number of clicks, whether a new B window duplicates an existing hidden one, and whether the same source-site intent survives.

  -- Status: INCONCLUSIVE
  -- Observed: Left-click on pending Blue 26 opened a menu: “Set Red Breakpoint / Needs recheck: Debugging window is no longer open. Blue remains at this call site. / Remove Blue Breakpoint / Use Native Power Config → Open Native Libraries · Rust”. Gold-bordered 21 showed the same actions with only the unreachable reason. Choosing **Use Native Power Config** (2 clicks total) opened a new B (CS4); the same Blue intent survived, without deleting it first. The ghost-site variant was not available because all four sites held Blues.
  -- Evidence: evidence/2026-10-10/r2-060-bp13-pending-blue-menu.png, evidence/2026-10-10/r2-061-bp13-gold-blue-menu.png, evidence/2026-10-10/r2-062-bp16-after-repair.png
  -- Reasoning and UX: Saved-Blue recovery works for a closed B; the ghost-site path and already hidden B were not compared. Wording friction: “Needs recheck” for a closed window.
  -- Retest (b7d173f, 12 Oct): saved pending Blue (B closed): left-click → “Use Native Power Config → Open Native Libraries · Rust” (2 clicks) opened a new B (CS3) and re-armed. Ghost site (Blue 31 just removed by a left-click on a healthy Blue, compatible B CS3 open and visible): hover says “⚠ You need to duplicate this window and open Power Config: Native Libraries · Rust, where step_pair_cpp exists…”, and the right-click menu offers only “Set Blue Breakpoint → Open Native Libraries · Rust”, not CS3. Choosing it **reused CS3** (no new window) and set Blue → CS3. evidence/2026-10-12/p2a-042-bp-ghost31-needs-window-with-B-open.png, evidence/2026-10-12/p2a-043-bp-ghost31-rightclick-menu.png, evidence/2026-10-12/p2a-044-bp13-ghost-open-native-result.png
  -- Verdict: N (state/UX defect). The ghost-site eligibility ignored an open compatible B, so the copy tells the user to duplicate a window that already exists. Repro: A Rust + C++ Threads, B Native Libraries · Rust opened via the Blue menu, left-click Blue 31 to remove it, hover 31. The action itself recovers correctly. Also note that left-clicking a healthy Blue deletes it with no confirmation, while left-click on a pending or Gold Blue opens a menu.

- [Y] **BP-14 — hidden versus closed** Hide/minimize B, then repeat BP-13. The UI should distinguish **show existing B** from **open a new B** and from **B was closed**. Try B with unsaved edits and an incompatible Power Config; report whether recovery protects edits and gives an actionable error.

  -- Observed (b7d173f): **Hidden B** (window list → Hide CS3): eligible Blue 31 → pending “⚠ Show the Native window before starting Rust Native Debugging”; its menu still offers “Use Native Power Config → Open Native Libraries · Rust”, which refuses with “Error: Show the existing Native window from the Window Manager before pairing Rust Native Debugging” and creates no duplicate. Show CS3 re-armed 31 automatically. **Closed B** reads “Debugging window is no longer open” (BP-12/16). **Unsaved edit in B** (step.cpp): 31 → pending “⚠ Save or discard the Native window's edits before pairing or stepping Rust Native Debugging”; B's edit untouched. **Incompatible B** (Rust Exclusive Step): “⚠ Select a Rust Debug Power Config and a CMake Library Build Power Config”. Switching B back re-armed 31.
  -- Evidence: evidence/2026-10-12/p2a-045-bp14-B-hidden.png, evidence/2026-10-12/p2a-046-bp14-B-hidden-menu31.png, evidence/2026-10-12/p2a-047-bp14-after-use-native-from-hidden.png, evidence/2026-10-12/p2a-048-bp14-B-dirty.png, evidence/2026-10-12/p2a-049-bp14-A-with-dirty-B.png, evidence/2026-10-12/p2a-050-bp14-B-incompatible-menu.png
  -- Reasoning and UX: The states are distinguished, edits are protected, and errors are actionable. Friction for the UX pass: the hidden-B menu says “Open…” but answers with an error instead of offering “Show CS3”; the incompatible-B copy is the generic two-config sentence although A is already valid; the panel keeps “→ CS3” in every state.

- [Y] **BP-15 — close B at a stop** In Rust live Native, close B while paused in native source; A must retain control of its original LLDB process, with no stale B frame or leaked private breakpoint. In C# LDI, close B during an active reproduction; A's held origin must be released or stopped once, with no stale handoff. Record which window remains usable and whether re-pairing requires a fresh launch.

  -- Variant Rust (b7d173f, A Rust + C++ Lib): paused at Blue entry `step.cpp:7`, B (CS2) closed from A's window list without a prompt. A stayed paused at step.cpp:7 with reason “Native view detached; continue debugging in the Rust window”, stack intact, and all controls available. ↷ → step.cpp:8; Continue → next red main.rs:21; counters advanced to `1002/2002`. The Blues stayed saved (“Bindings are frozen until Rust Debug restarts”; 26 “Debugging window is no longer open”). evidence/2026-10-12/p2a-030-bp15-rust-after-close-B-at-native-stop.png, evidence/2026-10-12/p2a-031-bp15-rust-after-continue.png
  -- Variant C# (b7d173f, A C# Threads + C Threads CS1, B Native Libraries · C# LDI CS3; clean re-run after an interrupted first attempt): A held `managed linked 2 #152251` (`step_add_c(2001, 0)`), B `driver` paused at step.c:15. Closing B (no prompt) → A `running` once → terminated with A's own results `1040/2040`; no B driver process remained. **Both C# Blue intents were discarded**: sites 23 and 28 became `ghost-needs-window` with “⚠ You need to duplicate this window…”, and the LDI panel emptied. evidence/2026-10-12/p2b-068-bp15-cs-rerun-before-close.png, evidence/2026-10-12/p2b-069-bp15-cs-rerun-after-close.png
  -- Reasoning and UX: Both variants are truthful with no stale handoff. Re-pairing needs a fresh launch in both. Rust keeps Blue intent on close but C# discards it; that difference feeds the worksheet.

- [Y] **BP-16 — re-pair and switch** Reopen B from A's existing Blue, choose the compatible C or C++ library build, and restart Debug if required. Verify the original Blue arms and reaches the intended native entry. Repeat with a different B instance/config and check that the old window ID, export, and warning are not reused.

  -- Observed: After BP-13, Blue 26 became normal “→ CS4”. White Debug stopped at `step_pair_c` entry step.c:20 (with native red removed; with red at step.c:25 it landed on that red, matching the documented landing rule). The B panel showed “Native Libraries · Rust · CS4 · Rust link · paused”. However, the other three Blues still read **“→ CS3”** (the closed window) in A's panel after the re-pair.
  -- Evidence: evidence/2026-10-10/r2-062-bp16-after-repair.png, evidence/2026-10-10/r2-063-bp16-B-native-entry.png, evidence/2026-10-10/r2-064-bp16-blue-only-run.png
  -- Reasoning and UX: The primary re-pair passes. It fails the “old window ID is not reused” clause for the other saved Blues (state/UX defect). The repeat with a second B instance or config was not run.
  -- Repair checkpoint: In the later working-tree desktop run, closing B through Craidd and re-pairing line 26 moved all four saved Blues to new CS3. The marker-menu click path and a post-repair native-entry launch remain to test.
  -- Retest (b7d173f, 12 Oct): marker-menu path: B closed, left-click pending Blue 26 → “Use Native Power Config → Open Native Libraries · Rust” → new B CS3, and **all four** saved Blues read “→ CS3”. White Debug under Rust + C Threads stopped at `step.c:20`; switching A to Rust + C++ Threads and launching stopped at `step.cpp:12`, with B showing “Native Libraries · Rust · CS3 · Rust link · paused”. evidence/2026-10-12/p2a-035-bp16-marker-menu-repair.png, evidence/2026-10-12/p2a-036-bp16-c-threads-native-entry-B.png, evidence/2026-10-12/p2a-039-bp16-cpp-threads-native-entry-A.png
  -- Verdict: Y on b7d173f. The N above records 856859e.

- [ ] **BP-17 — close every solution window** With Blue and red markers set, close A and B but leave the Craidd process running if the app permits it; reopen the same `.cln`. Record exact Blue/red presence, partner identity, window layout, and whether a single clear action can restore B. If closing the final window quits the process, record that fact and use BP-18 instead.

  -- Status: OPEN (persistence decision)
  -- Observed (b7d173f, fixed scratch HOME): with saved Blues (21/26/31) and red main.rs:47, **File → Exit → This Solution** (Ctrl+Shift+Q) showed “Closing… Closing all windows in this solution. Cancel / Close”, with no mention of Blue intent. Craidd stayed running (mt-lab window). Reopening `thread-control.cln` gave one new window (CS5) on the default config **Rust Exclusive Step**, no tabs, no B. The red main.rs:47 survived; **no Blue intent, ghost or partner survived**. Restoring B needs the full manual setup again. Closing the last window from the window list was not offered for a single-window solution.
  -- Evidence: evidence/2026-10-12/p2a-054-bp17-exit-solution.png, evidence/2026-10-12/p2a-055-bp17-reopened.png, evidence/2026-10-12/p2a-057-bp17-reopened-main-rs.png
  -- Reasoning and UX: Blues are window-scoped and discarded silently on all-window close, while reds persist. Decide in the worksheet.

- [ ] **BP-18 — full IDE restart** Quit Craidd entirely, relaunch, and reopen the same `.cln`. Record whether Blue intent, its source site, partner Power Config, and red breakpoints return; do not confuse restored windows with restored Blue state. The current design describes Blue pairings as app/window-scoped rather than persisted, so treat this as a **public-release persistence decision** until a requirement and implementation are agreed, not as a passing restore test.

  -- Status: OPEN (persistence decision)
  -- Observed (b7d173f, same HOME across launches): A CS5 Rust + C++ Threads with Blue 31 → B CS6. **Exit → This Application** (Ctrl+Alt+Q) → “Closing… Exiting the IDE.” → Close; process gone. Relaunch → Get Started lists “Previously opened windows” (three thread-control rows plus mt-lab). **Open 3** on the first row reopened **three** windows, **all on Native Libraries · Rust**; A's Rust + C++ Threads window was not restored. Red main.rs:47 returned; **no Blue intent returned**.
  -- Evidence: evidence/2026-10-12/p2a-058-bp18-before-quit.png, evidence/2026-10-12/p2a-059-bp18-quit-dialog.png, evidence/2026-10-12/p2b-061-bp18-get-started.png, evidence/2026-10-12/p2b-062-bp18-restored-workspace-1.png
  -- Reasoning and UX: The Blue result matches the documented app/window-scoped design. Separate finding for review: the restored window group does not reproduce the A/B arrangement (three identical Native windows).

- [Y] **BP-19 — explicit removal** Remove one Blue by its menu, then close B. Confirm only that site disappears; other Blues and reds remain. Compare deliberate removal with merely closing B. If both actions discard the same user intent, record the recovery cost and whether the UI warned before doing so.

  -- Observed (b7d173f): with 16/21/26/31 saved and red main.rs:47, closing B (CS3) removed no Blue (31 pending “Debugging window is no longer open”, the others Gold). Then Gold-bordered 16 → menu **Remove Blue Breakpoint** → only 16 became a ghost (`ghost-needs-window`). 21/26/31 and the red remained, and the panel lost only `step_add_c`. No warning before the deliberate removal; none expected.
  -- Evidence: evidence/2026-10-12/p2a-051-bp19-after-remove-16-and-close-B.png, evidence/2026-10-12/p2a-052-bp19-after-removing-16.png
  -- Reasoning and UX: Pass for Rust. Closing B keeps intent and removal deletes exactly one site. In C#, closing B deletes intent (BP-15).

- [Y] **BP-20 — combined states** Close B while the selected Rust Power Config also excludes one saved Blue; then reopen B under a compatible config. Repeat with unsaved source edits and with two Blues sharing B. Record which reason the marker/menu shows first, whether the other reason remains discoverable, and whether fixing one condition restores only the eligible sites. A Gold border must not make a missing partner or unsaved source look like proven compile exclusion.

  -- Observed (b7d173f, four Blues sharing B): with B closed under Rust + C Threads, the Gold-bordered 16/21/31 (hover and menu) show **only** “Unreachable under this Power Config…”, and the closed-partner reason is not discoverable on them. Eligible 26 shows “⚠ Debugging window is no longer open”. Adding an unsaved edit in A made 26 show both “⚠ Debugging window is no longer open” and “Unsaved edits: Blue still uses the last saved call site. Save to revalidate it.”; the Gold sites still showed only exclusion. Undoing the edit and re-pairing via 26's menu armed only the eligible site, and all four moved to the new B.
  -- Evidence: evidence/2026-10-12/p2a-032-bp20-B-closed-c-threads.png, evidence/2026-10-12/p2a-033-bp20-menu-26.png, evidence/2026-10-12/p2a-034-bp20-dirty-A.png, evidence/2026-10-12/p2a-035-bp16-marker-menu-repair.png
  -- Reasoning and UX: Pass: the Gold border appears only on compile-excluded sites, and fixing one condition restores only eligible sites. UX friction for review: the secondary reasons (closed B, unsaved source) are hidden on Gold-bordered sites until their config is selected.

For every BP case, record selected A/B configs, source site, marker color/border/tooltip, build artifact/export evidence, launch preview, actual stop, and thread/session identity. See [Blue breakpoint reachability](../../ldi-debugging/design-blue-breakpoint-reachability.md).

### Blue breakpoint close/reopen decision worksheet

Use the BP-11–20 screenshots and results before choosing a release behavior. Separate **source-site intent**, **current partner window**, and **armed binding in a running debugger**: closing a view, changing a build, and removing a breakpoint are different actions. For each option below, write what happens after B closes, after all windows close, and after a full IDE restart. Include Rust live Native and C# LDI if their results differ.

**A. Remove Blue when B closes**

- What becomes simpler or clearer? _Write after test._
- What user work is lost (site, condition, partner choice), and how many steps restore it? _Write after test._
- Is closing B an unambiguous request to delete this breakpoint? What warning or undo would be needed? _Write after test._
- Result for Rust / C# / all-window reopen: Facts on b7d173f: closing B keeps Rust Blues (pending, re-pairable in 2 clicks) but **deletes C# Blues** (BP-15); closing every solution window and a full restart keep reds but drop all Blues (BP-17/18). Judgement: _for the UX pass._

**B. Keep Blue as an actionable marker that can reopen or re-pair B**

- What should left-click, right-click, hover, and the Debug panel offer? Can A recover without first deleting Blue? _Write after test._
- How is a closed B distinguished from a hidden B, an incompatible config, and a proven unreachable call? Today's copy: closed “Debugging window is no longer open”; hidden “Show the Native window before starting Rust Native Debugging”; dirty B “Save or discard the Native window's edits…”; incompatible “Select a Rust Debug Power Config and a CMake Library Build Power Config”; unreachable = Gold border “Unreachable under the selected Power Config…”. Secondary reasons are hidden on Gold-bordered sites (BP-14/20). Judgement: _for the UX pass._
- What should persist across all-window close and full IDE restart: source site, condition, native config, exact window instance, or none? _Write after test._
- How do we prevent duplicate B windows and stale debugger bindings? Result for Rust / C#: Facts: re-pair reused an open B and refused a hidden one with an actionable error (no duplicates seen); all saved Rust Blues move to the new B ID (BP-16); a running Rust session freezes bindings until restart. The ghost-site copy still asks to duplicate an existing B (BP-13). Design: _for the UX pass._

**C. Keep today's behavior and improve wording/discoverability**

- Does “Use Native Power Config → Open …” already recover the Blue reliably, or only appear after a non-obvious click? Facts: it recovered a closed B reliably (2 clicks, BP-13/16), only appears after left-clicking a pending/Gold Blue or right-clicking any marker, and errors instead of showing a hidden B (BP-14). Left-clicking a healthy Blue deletes it without a menu. Judgement: _for the UX pass._
- Which exact tooltip/menu/panel labels should change? Does clearer copy suffice without changing state behavior? _Write after test._
- What remains confusing after a newcomer follows the revised wording once? Result for Rust / C#: _Write after test._

**Decision after the UX pass:** Chosen behavior (including any combination of B and C): _Pending._ Evidence IDs/screenshots: _Pending._ Required implementation and migration of existing Blue state: _Pending._ Public release blocker or acceptable limitation: _Pending._

### Agent handoff after filling the boxes

Report counts of `[Y]`, `[N]`, and `[ ]` by section, then list: functional release blockers; UX friction that still needs a human decision; unrun/blocked variants and what the harness lacked; the A/B/C close-window recommendation tied to BP evidence; and the smallest repeatable retest after each proposed fix. Do not call the feature public-release ready while a required gate is blank or a failure has no verified repair. Keep any code change or fixture addition separate from this observation pass so the results describe one known build.

## 5. Rust → C/C++: one live process and one LLDB session

Open `experiments/lldb-native-thread-control/thread-control.cln` in both windows. Use A = **Rust + C Lib** or **Rust + C++ Lib**, B = **Native Libraries · Rust**. Link the windows; set Blue on the matching Rust call and red on `BREAK_RUST` and optionally `BREAK_C_LIBRARY`/`BREAK_CPP_LIBRARY`. Repeat for both languages.

- [ ] **RL-01** Gold Debug explains why it is disabled for a library-only pair. White Debug in A starts the one Rust process; Gold Stop appears while linked. B is an inspector/Stop view, not a second debuggee.

  -- Status: INCONCLUSIVE
  -- Variant C (Rust + C Threads / C Lib): Gold Debug disabled with “Rust + Native uses one LLDB session. Select the Native library in B, set Blue on the Rust call in A, then use White Debug in A. Gold Debug starts multiple processes.” White Debug in A started one process (PID 257616). A then showed Gold “Stop linked Rust debugger” (“2 linked windows · one Rust process and LLDB session…”). B had no Debug (“Debug — no debug configurations”) and showed “Rust-owned native inspection · paused”. Pass. evidence/2026-10-10/r2-044-rl01-bp01-A-at-blue.png, evidence/2026-10-10/r2-045-rl01-bp01-B-native-entry.png
  -- Variant C++: NOT RUN.
  -- Reasoning and UX: The C variant passes and the button to use is named. Blank because the C++ variant is missing.

- [ ] **RL-02** Step Rust worker 1, then 2 with ⇥. Compare `RustLinkedStep/runs/c/` or `runs/cpp/` worker counters and unselected instruction locations. A native source stop routes to B when qualified; A retains the owning LLDB thread identity.

  -- Status: INCONCLUSIVE
  -- Variant C (Rust + C Lib, red BREAK_RUST, Blue BLUE_RUST_C): ⇥ `rust linked 1` → :48, then **into `step.c:7/8/9`** (“Paused in native code · inspect the paired Native window”), back to :17, :48, :49 → `1001/0`. Worker 2 stayed at main.rs:47 throughout. ⇥ `rust linked 2` (8 steps, same native detour) → `1001/2001`, with worker 1 fixed at :50. A kept thread `#260814` as the owner throughout. evidence/2026-10-10/r2-055-rl02-A-w1.png, evidence/2026-10-10/r2-057-rl02-A-w2.png
  -- Variant C++: NOT RUN.
  -- Reasoning and UX: Isolation holds. UX friction: with Blue armed, every ⇥ over the FFI line enters C (8 ⇥ per Rust write).

- [ ] **RL-03** Step Into/Out and ⇥ around the Blue call. Red or Blue inside the library can still stop there. Record repeated native entry as expected current behavior; a separate “skip this native call” action has not been implemented.

  -- Status: INCONCLUSIVE
  -- Observed: ⇥ (Step Over) at the Blue call entered the library on **every** call (RL-02 log), as expected for current behaviour. Step Into/Out around Blue were not tried, nor was a run with Blue disabled.
  -- Evidence: RL-02.
  -- Reasoning and UX: Recorded as friction; the comparison is incomplete.

- [ ] **RL-04** Stop from A or Gold Stop in B. Confirm the original process stops once, both views clear, and neither window displays stale frames. Closing B as a view must not invent another process or thread namespace.

  -- Status: INCONCLUSIVE
  -- Variant C (Threads): Gold “Stop linked Rust debugger” clicked **in B** at a native stop → A `terminated`, B `idle`, ownership rows “not debugging / library · no process”, no frames left; PID 257616 gone. evidence/2026-10-10/r2-051-rl04-B-after-stop.png, evidence/2026-10-10/r2-052-rl04-A-after-stop.png
  -- Variant C++: NOT RUN. Closing B mid-session: see BP-12 (idle only).
  -- Reasoning and UX: The C variant passes.

For native child workers, use **Rust + C Threads** and **Rust + C++ Threads**, Blue on `BLUE_RUST_C_THREADS`/`BLUE_RUST_CPP_THREADS`, and red on `BREAK_C_PAIR_WORKER`/`BREAK_CPP_PAIR_WORKER` in B:

- [ ] **RL-05** At a native stop, A's LLDB thread dropdown lists the caller and any live native child. B shows the native source/stack when routing has a qualified origin. Record when a child lacks that Rust caller frame and remains displayed in A.

  -- Status: INCONCLUSIVE
  -- Variant C (Rust + C Threads, red BREAK_C_PAIR_WORKER): A's dropdown listed 5 threads: callers `rust linked 1 #257619`, `rust linked 2 #257620`, main, and native children **`rust linked 2 #258691`, `rust linked 1 #258692`**. B showed the native source and stack (step.c:25, `step_pair_c ← run_c_child`). evidence/2026-10-10/r2-046-rl05-A-native-worker-threads.png, evidence/2026-10-10/r2-047-rl05-B-native-worker.png, evidence/2026-10-10/r2-048-rl06-A-at-pair-worker.png
  -- Variant C++: NOT RUN.
  -- Reasoning and UX: UX friction: native children inherit their Rust parent's thread name, so A lists two `rust linked 1` and two `rust linked 2`, distinguishable only by ID.

- [ ] **RL-06** Select one native worker **in A**, ⇥ until its `RustLinkedStep/runs/native-c/` or `native-cpp/` `owner-N-worker-M.txt` changes; the sibling's file and instruction address stay fixed. Switch siblings at source frames. Repeat for owner 1 and owner 2.

  -- Status: INCONCLUSIVE
  -- Variant C: in A, ⇥ native child `#258691` (owner 2 worker 2) :25→:29 → `owner-2-worker-2.txt` `1`; sibling `#257620` stayed at :25 with no file. Switched: ⇥ `#257620` → `owner-2-worker-1.txt` `1`, while `#258691` stayed at :29. Owner 1: ⇥ child `#258692` → `owner-1-worker-2.txt` `1`, while `#257619` stayed at step.c:20. evidence/2026-10-10/r2-049-rl06-child-step.png, evidence/2026-10-10/r2-050-rl06-sibling-step.png
  -- Variant C++: NOT RUN. Owner 1's reverse switch was not done.
  -- Reasoning and UX: The C variant passes for the cases run (file and source line checked).

- [Y] **RL-07** Verify B currently has **no separate native-child dropdown** for this shared LLDB session. Record this as an open UI limit, not a failed two-session feature. Confirm no B selection silently changes A's thread target.

  -- Observed: In B during the shared LLDB session, the toolbar has Continue/↷/↓/↑ but **no thread dropdown**, and no B control changed A's thread target (A's focus stayed `rust linked 1 #257619` while B was viewed).
  -- Evidence: B toolbar capture in the run log; evidence/2026-10-10/r2-045-rl01-bp01-B-native-entry.png
  -- Reasoning and UX: Recorded as the open UI limit. Observed in the C Threads variant.
  -- Human release decision (12 Oct, after 3717e0d): B needs a visible thread picker and selected-thread ⇥ for both Rust + C Threads and Rust + C++ Threads. C# LDI already offers B controls, but Rust B shares A's single LLDB session; its picker must identify that selection also changes A's step target. The working-tree control path is pending a real two-window retest. Keep this Y as the historical observation of absence, not as release acceptance.
  -- Focused desktop retest (12 Oct, working tree): B now has the shared LLDB thread picker and ⇥ under both pairings. The old Y records what was absent at b7d173f; current behavior is in RL-09.

- [Y] **RL-09 — B native child control, focused retest** In `experiments/lldb-native-thread-control/thread-control.cln`, use A **Rust + C Threads** and then **Rust + C++ Threads**, B **Native Libraries · Rust**, Blue at main.rs:26/31, and red at the matching native worker line. Select an owner-1 native child by ID in B, use ⇥ until its counter changes, and check the owner-1 sibling counter remains unchanged. Record the source line and selected ID after every step.

  -- Observed (12 Oct, working-tree desktop build, LLDB-DAP): C child `#233663` selected in B at step.c:25, then ⇥ reached :26/:27/:28/:29; `owner-1-worker-2.txt` changed from empty to `1` while sibling `owner-1-worker-1.txt` stayed `6`. C++ child `#233228` selected in B at step.cpp:19, then ⇥ reached :20/:21/:22/:23; worker 2 changed from empty to `1` while worker 1 stayed empty. The B dropdown listed five threads and the native child source/stack appeared in B in both runs.
  -- Evidence: C B threads (local: evidence/2026-10-12/rust-c-b-native-threads.png), C after child step (local: evidence/2026-10-12/rust-c-b-native-child-step.png), C++ B threads (local: evidence/2026-10-12/rust-cpp-b-native-threads.png), C++ after child step (local: evidence/2026-10-12/rust-cpp-b-native-child-step.png), final B toolbar with selected ID (local: evidence/2026-10-12/rust-c-b-toolbar-final.png); scratch UI harness records under `test-results/ui/2026-10-12T19-32-24-817Z/`, `test-results/ui/2026-10-12T19-32-13-104Z/`, and `test-results/ui/2026-10-12T19-35-19-082Z/` (ignored, local).
  -- Reasoning and UX: The sibling counter was unchanged through this focused step sequence. C's sibling file held a value from the prior run, so its unchanged value is evidence against an additional write during this sequence, not proof of a fresh initial zero. The children inherit their Rust caller's name; show the ID in the collapsed picker to distinguish them. A/B shared-selection mirroring, sibling instruction address, reverse worker selection, C++ owner 2, and recovery paths remain open.
  -- Human follow-up (12 Oct): Rust→C/C++ separate native-child control works in B. B's thread list (local: evidence/2026-10-12/human-b-native-thread-list-no-duration.png) and the A/B comparison (local: evidence/2026-10-12/human-a-b-duration-comparison.png) expose a presentation gap: A shows “ran for” for matching IDs, while B only shows paused state. Add B duration display from the same shared LLDB snapshot; keep MT-08's interpretation.
  -- Focused desktop retest (12 Oct, working tree): after ⇥ on native child `#269168`, B (local: evidence/2026-10-12/b-native-duration-after-step.png) and A (local: evidence/2026-10-12/a-native-duration-after-step.png) both showed `ran for 28ms` for that ID. Other paused threads in both windows showed “running time unavailable” because no running interval had been established for them. This is presentation parity at one stop, not proof of CPU time or every lifecycle case.

- [ ] **RL-08** Try a child spawning/exiting during ⇥, Continue from A, and Stop from B. Check which thread resumes and that all temporary holds release; record any unmatched source, stale B view, or Output error.

  -- Status: NOT RUN
  -- Observed: Spawn/exit during ⇥ was not driven.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

## 6. C# → C/C++: managed origin and separate native reproduction

Use `experiments/netcoredbg-thread-control/thread-control.cln` in two windows: A = **C# Threads + C Threads** or **C# Threads + C++ Threads**, B = **Native Libraries · C# LDI**. Blue is `BLUE_C_CALL`/`BLUE_CPP_CALL`; managed red is `BREAK_MANAGED`; native red is `BREAK_C_ENTRY`/`BREAK_CPP_ENTRY` and `BREAK_C_WORKER`/`BREAK_CPP_WORKER`. Repeat both pairings. Installed stock netcoredbg is sufficient for the **LDI** checks; optional patched netcoredbg affects only A's ⇥ before Blue. B uses installed LLDB-DAP.

- [Y] **CL-01** Gold Debug starts the linked reproduction. At Blue, record the exact A managed origin thread and handoff token. B's LLDB session/process starts separately. The B thread dropdown must not reuse A's IDs as though they share a process.

  -- Variant C: the Gold launch plan listed Stage 1 CS1 (build, install, “hold at the blue call site”) and CS2 (“prepare library now; native debugger starts only after its blue call”). At Blue, A held `managed linked 1 #267955` with **LDI #2**, `step_add_c(1001, 0)`. B's own session `driver #268071` stopped at step.c:15. B's dropdown says “LDI #2 · B reproduces A managed linked 1 #267955”, and no A IDs appear in B's list. evidence/2026-10-10/r2-066-cl01-gold-launch-plan.png, evidence/2026-10-10/r2-068-cl01-A-held-at-blue.png, evidence/2026-10-10/r2-069-cl01-B-native-entry.png
  -- Variant C++: A held `managed linked 2 #272882`, **LDI #6**, `step_add_cpp(2001, 0)`; B `driver #272931` at step.cpp:9. evidence/2026-10-10/r2-078-cl01-cpp-A-held.png, evidence/2026-10-10/r2-079-cl01-cpp-B-entry.png
  -- Reasoning and UX: Pass in both pairings.

- [Y] **CL-02** Select another paused C# thread in A while B is active. A inspection changes; the captured origin and native-call argument do not. A stays held until B completes or the handoff is deliberately abandoned.

  -- Variant C: selected `managed linked 2` in A → locals `marker 2001, number 2`; the LDI card still reads `step_add_c(1001, 0)`; A's steps disabled (“A is held by LDI; finish B to release it”); Continue relabelled “Continue C# · stop this native reproduction”. B unchanged. evidence/2026-10-10/r2-070-cl02-A-other-thread.png
  -- Variant C++: selected `managed linked 1` → `marker 1001`; the card still reads `step_add_cpp(2001, 0)`.
  -- Reasoning and UX: Pass.

- [Y] **CL-03** At the B native worker stop, ⇥ one worker and compare `Native/runs/native-c/` or `native-cpp/` `worker-1.txt`/`worker-2.txt`; switch B workers and repeat. Check source/instruction location too. A's `LinkedCSharpStep/runs/c/` or `cpp/` files are **original-process results**, not evidence that B threads were isolated.

  -- Variant C: red BREAK_C_WORKER in B. ⇥ `#268071` :19→:24 → `Native/runs/native-c/worker-1.txt` `1`, while `#268200` stayed at :19. Then ⇥ `#268200` → `worker-2.txt` `1`, while `#268071` stayed at :24. A's `LinkedCSharpStep/runs/c` stayed `0/0`. evidence/2026-10-10/r2-072-cl03-B-w1.png, evidence/2026-10-10/r2-073-cl03-B-w2.png
  -- Variant C++: ⇥ `#272931` :15→:20 → `native-cpp/worker-1.txt` `1`, with `#273013` fixed at :15; then `#273013` → `worker-2.txt` `1`, with `#272931` fixed at :20. evidence/2026-10-10/r2-080-cl03-cpp-B-steps.png
  -- Reasoning and UX: Pass in both. The automatic-entry landing also stops at B's internal recursive/child entry calls, so reaching the worker red needs extra Continues.

- [ ] **CL-04** Finish B, then confirm A releases **once** and executes its own call. Continue, cancel, Stop, exception, and closing either window each leave a truthful state; no old B completion releases a newer A handoff.

  -- Status: INCONCLUSIVE
  -- Variant C: B finished (`native-c` 20/20) → A released once. Worker 2, already at Blue, started **LDI #3** (`2001`). Finishing #3 → A wrote its own results `1001/2001`, then **LDI #4** (`2002`). Gold Stop during #4 → A and B `terminated`, no remaining dotnet/driver processes. evidence/2026-10-10/r2-074-cl04-A-after-release.png, evidence/2026-10-10/r2-075-cl04-A-next-handoff.png, evidence/2026-10-10/r2-076-cl04-A-after-gold-stop.png, evidence/2026-10-10/r2-077-cl04-B-after-gold-stop.png
  -- Variant C++: B finished → release and new token **LDI #7** (`1001`). A's own result was not confirmed before Gold Stop (clean termination). evidence/2026-10-10/r2-081-cl04-cpp-A-next.png
  -- Reasoning and UX: Finish and Stop are truthful. Cancel, exception and closing either window were not run.
  -- Retest (b7d173f, 12 Oct): closing B during an active reproduction released A once and ran its own calls to `1040/2040`, with no stale handoff (BP-15 C# variant). Cancel, exception and closing A remain unrun.

- [ ] **CL-05** Remove/restore a prepared Blue during a run, edit its condition, and add a new Blue site after Gold launch. The prepared site follows its documented current-run rules; an unprepared site asks for Gold Restart rather than silently binding. Red on the same line remains independent.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CL-06** With a missing native library, wrong export, or failed B launch, capture the warning and verify A is not left held forever. Repeat with corrected configuration and a fresh token.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

For CL-07/08, switch both windows to the broader `workspaces/mt-lab/mt-lab.cln` solution: A **C# GUI · MT + LDI**, B **Native · LDI**. Do not run these two cases in the netcoredbg experiment `.cln`:

- [ ] **CL-07** Variant 4: A's one C# origin remains held while B reports seven native workers; selecting a B worker changes B's stack/locals only. After B completes, A's call returns `322`.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **CL-08** Variant 5: seven named C# callers reach Blue **sequentially**. For each, record its own origin and token, two B workers, and release before the next handoff. Expected final results are `207, 211, 215, 219, 223, 227, 231`. This does not test seven simultaneous reproductions.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

## 7. Cross-session, lifecycle, and failure checks

Use the solution map above for each EDGE ID. EDGE-01 uses the two independent C# LDI sessions; EDGE-05/07 need separate results for Rust live Native and C# LDI. EDGE-02–04 use `workspaces/mt-lab/mt-lab.cln`; EDGE-06 uses the LLDB experiment `.cln`.

- [ ] **EDGE-01** With two solution windows and independent debug sessions, select threads with the same numeric DAP ID if one occurs. Stack, locals, commands, and events stay with their owning window/session generation.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **EDGE-02** Rapidly switch thread selection during a delayed `stackTrace`/`scopes`/`variables` response, then Continue or restart. An old response must not overwrite the new selection or display stale locals/source.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **EDGE-03** Exit a selected worker and create another. A reused adapter ID does not inherit the exited worker's name, frame, timer, or held state. Recently completed rows remain read-only.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **EDGE-04** A partial stop (or a stop whose scope cannot be verified) never enables ⇥ just because a thread is listed as paused. Thread membership alone does not prove all-thread suspension.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **EDGE-05** Stop, debugger exit/crash, detached window, or failed launch while a hold/LDI handoff is active. Confirm cleanup, honest status in both windows, and a clean second launch. Record process PID, Output, and whether manual recovery was needed.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **EDGE-06** Repeat an all-thread stop under load with a short-lived burst, a lock wait, and a native child created after the first thread snapshot. Record any limits of the known-thread suspension model explicitly.

  -- Status: NOT RUN
  -- Observed: Not part of this pass.
  -- Evidence: None.
  -- Reasoning and UX: No verdict; run it in a later pass on the same build.

- [ ] **EDGE-07** Verify toolbar explanations: ⇥ describes one selected-thread step and its qualification; ordinary arrows state their debugger-dependent scope; Gold Debug/White Debug/Gold Stop name the right owner; Blue Gold border explains reachability rather than suggesting a breakpoint was deleted.

  -- Status: INCONCLUSIVE
  -- Observed: On 856859e, ⇥ title “Experimental: Step selected thread only”, with dropdown text “⇥ requests one native-thread Step Over on this experimental LLDB-DAP path…”. Arrows: “Step Over · may resume all threads”. Gold Debug (Rust pair) names White Debug in A. Gold Stop: “2 linked windows · one Rust process and LLDB session…”. Blue Gold border: “Unreachable under the selected Power Config: … The breakpoint stays here…”. ⇥ was wrongly offered on disassembly frames then; the later Rust repair run disabled it with a source-less notice.
  -- Evidence: toolbar captures in the run log.
  -- Reasoning and UX: The strings are recorded; wording quality needs human judgement, and C# LDI tooltips were only partly captured.

## Sign-off

- [ ] **Gate A — ordinary MT:** MT-01–08 pass per language; GUI checks pass on each installed GUI stack, or prerequisites are listed as blocked. No claim of isolated ordinary Step.

  -- Status: INCONCLUSIVE
  -- Observed: On 856859e, MT-01/02/04 passed in C#, Rust and C++, while MT-03 failed for LLDB. The 10 October repair checkpoint disabled source Step on the Rust main thread's libc frame; C/C++ source-less variants and later source-breakpoint recovery remain untested. MT-05/06, GUI and most of MT-07/08 were not run.
  -- Evidence: MT entries and repair checkpoints above.
  -- Reasoning and UX: The focused repair does not complete the per-language gate.
  -- Retest (b7d173f): MT-03 now passes in C#, Rust and C++. MT-05/06, GUI and parts of MT-07/08 remain unrun, so the gate stays open.

- [ ] **Gate B — native ⇥:** NX-01–06 pass in Craidd for Rust, C, and C++ on a recorded qualified LLDB build. Document NX-07 and other limitations with actual evidence.

  -- Status: INCONCLUSIVE
  -- Observed: On 856859e, NX-02–04 passed for Rust, C++ and C; NX-01/NX-05 failed. The 10–12 October working-tree checkpoint passed the Rust source-less control, normal worker step, and blocked-join Pause → Continue recovery. C/C++ recovery, the lock fixture, NX-06 remainder, and NX-07 were not run on the repair.
  -- Evidence: NX entries and repair checkpoints above.
  -- Reasoning and UX: Re-run the full cases on a committed build before qualifying native ⇥.
  -- Retest (b7d173f): NX-01 and NX-05 now pass for Rust, C++ and C; NX-02–04 passed earlier. NX-06 has a C-only result, and NX-07 is unrun.

- [ ] **Gate C — Blue reachability and lifecycle:** BP-01–05 pass through both Rust+native pairings with four saved Blues and a real two-window launch. BP-11–20 have desktop results, and the close/reopen worksheet records the chosen release behavior. BP-06/07 require new fixtures; BP-08 remains open until C# parity is built and tested.

  -- Status: INCONCLUSIVE
  -- Observed: BP-01 passed on 856859e; BP-02 remains partial because C++ Lib was not launched. BP-03–05, 14, 15 and 17–19 were not run. BP-16 failed on a stale partner ID in that build; the 10 October working-tree checkpoint moved all four IDs after one re-pair, but did not repeat the marker-menu and native-entry launch paths. The worksheet remains pending.
  -- Evidence: BP entries and repair checkpoint above.
  -- Reasoning and UX: Lifecycle evidence is incomplete.
  -- Retest (b7d173f): BP-03, 14, 15, 16, 19 and 20 pass. BP-13 fails (ghost copy ignores an open B). BP-17/18 record that Blue intent is not persisted. BP-02 and BP-10/11 await human judgement; BP-04/05 are unrun. The worksheet decision is still pending.

- [ ] **Gate D — linked MT:** RL-01–08 and CL-01–08 have separate desktop results. Mark current Rust B native-child UI limitation and any C# recovery gaps openly.

  -- Status: INCONCLUSIVE
  -- Observed: CL-01–03 pass for C and C++. RL-01/02/04–06 pass for the C variants only. RL-07 limit recorded. CL-04 partial; RL-03/08 and CL-05–08 not run.
  -- Evidence: RL/CL entries above.
  -- Reasoning and UX: The C++ Rust variants and the recovery paths are needed.
  -- Human release blocker (12 Oct): Rust B must select and step each C/C++ worker while its sibling's source position and counter remain fixed. Verify A mirrors the shared selection, and B never claims a separate process or thread namespace. Retest both pairings in `experiments/lldb-native-thread-control/thread-control.cln` after the working-tree control changes; do not infer a pass from the C# LDI result.
  -- Focused retest (12 Oct, working tree): RL-09 demonstrates B selection and ⇥ on one owner-1 native child for both C and C++ pairings, with unchanged sibling counters. This resolves the observed absence of B controls for these cases. Full owner/worker reversal, A mirror, sibling source position, and RL-08 recovery still gate release.

- [ ] **Gate E — release decision:** Re-run failures after fixes, attach evidence to each result, and state which debugger versions/platforms are qualified. An unchecked or blocked case is not a pass.

  -- Status: OPEN
  -- Observed: The earlier failures have focused working-tree repair checkpoints for Rust source-less frames, Rust blocked-step recovery, and Blue re-pair state. Full language, marker-menu, lifecycle, and release runs are still outstanding.
  -- Evidence: Historical pass plus 10–12 October repair checkpoints (Linux, LLDB-DAP 23.1.1, stock netcoredbg 3.2.0-1).
  -- Reasoning and UX: Not release-ready.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
