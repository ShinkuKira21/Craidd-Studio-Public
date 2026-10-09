# Direct adapter results — 9 October 2026

## Cross-language extension on `feat/mt-debugging-cross-language-labs`

The `rust-c` and `rust-cpp` direct DAP probes passed with installed
LLDB-DAP 23.1.1 on 9 October. Each used a real Rust executable linked to the
corresponding C or C++ shared library. Each stepped worker 1 three times and
worker 2 three times with the other known threads suspended. The other
worker's instruction address and file counter stayed fixed; the counters
ended at `1001/2001` before Continue and `1060/2060` after. Traces are in
ignored `.runs/probes/rust-c-ihsr6elg/` and
`.runs/probes/rust-cpp-mg5sqc10/`. This proves the direct LLDB path through
these FFI calls, not Blue presentation or Craidd desktop controls.

The user reported that the Rust→C and Rust→C++ worker variants also work in
the Craidd desktop. Their screenshots showed disabled Gold Debug before the
Rust launch and the ⇥ Step Over tooltip. This is desktop feedback for the
caller/library path; native-child-thread selection was not part of that run.

The new `rust-c-threads` and `rust-cpp-threads` direct probes also passed:
selected Rust-worker steps held the other Rust worker's PC and counter fixed
while each FFI call created and joined a native child. All four native
per-owner counter files reached 12 after Continue. Traces are in ignored
`.runs/probes/rust-c-threads-fq6xx81o/` and
`.runs/probes/rust-cpp-threads-gxwz71f9/`. This does not yet establish
selected **native-child** stepping or Blue routing to B.

Direct native-child probes then passed for both languages. They stopped in a
child with a C/C++ source frame and no Rust caller frame, suspended the other
known LLDB threads, and advanced only that child's native counter. After
release, all four native counters reached 12 and both Rust counters reached
`1060/2060`. Traces are in ignored
`.runs/probes/rust-native-c-p9572g_u/` and
`.runs/probes/rust-native-cpp-0x8fwthg/`. Craidd's Blue routing and B-window
control for those child frames remain unverified.


Environment: Linux x86-64, installed `/usr/bin/lldb-dap` 23.1.1. This is a
direct DAP test, not a Craidd desktop acceptance record. The LLDB-DAP
initialize response did not advertise `supportsSingleThreadExecutionRequests`.
LLDB Python scripting was available inside the same debugger session.

| Fixture | Four selected steps | Unselected PC and counter | Release and final Continue |
| --- | --- | --- | --- |
| Rust worker 1 ×2, then worker 2 ×2 | Passed | Fixed during each step | Both reached 1012/2012 |
| C++ worker 1 ×2, then worker 2 ×2 | Passed | Fixed during each step | Both reached 1012/2012 |
| C worker 1 ×2, then worker 2 ×2 | Passed | Fixed during each step | Both reached 1012/2012 |

The test first compared LLDB's `this-thread` step mode without explicit
suspension. A Rust worker's counter stayed unchanged, but its instruction
pointer moved from the source line into a sleep syscall. That falsified the
claim that this run mode alone isolates the unselected thread. Explicit
`SBThread.Suspend()` of the other known threads kept the unselected worker's
PC and counter fixed in these fixtures. `SBThread.Resume()` released only the
recorded holds.

The blocked C++ fixture put the selected target on a mutex wait while the
held owner had the mutex. LLDB answered Pause and emitted a stopped event
with reason `exception`; it confirmed release of both recorded holds. After
Continue, LLDB emitted a later `step` stop for the interrupted step. A second
Continue let the program terminate. This proves a recovery route for that
one wait shape, not a general deadlock guarantee.

Trace directories (ignored generated data):

- `.runs/probes/rust-aw3pwths/`
- `.runs/probes/cpp-zundkuhy/`
- `.runs/probes/c-x98fayap/`
- `.runs/probes/blocked-5fk4272i/`

Craidd integration is source-present on this branch. Frontend and Rust build
checks plus focused unit checks are separate from these direct adapter probes.
The user has since reported that the desktop thread control works for Rust,
C++, and C in this lab. That report is recorded below, separately from the
direct probe evidence. This experimental branch is not a shipped feature.

## Desktop feedback, 9 October 2026

The first user screenshots showed the Rust workers paused and selectable, but
the ⇥ control was absent and the dropdown still described ordinary Step. The
frontend received the native capability during `initialize`, then cleared it
on a later `starting` status from the same LLDB launch. The branch now keeps
the session capability across that status, with a focused event-order test.
The user must restart the debug session and repeat the desktop sequence; this
record does not claim the in-app control has passed yet.

The next user report showed ⇥ present but disabled while three Rust threads
were paused. The backend thread book tracked the all-thread stop, but its
snapshot omitted `allThreadsStopped`; the frontend consequently defaulted it
to `false`. The snapshot now sends that field. A focused frontend test checks
that a paused, selected source frame can dispatch the experimental command
after the all-thread snapshot. The live desktop step still awaits retest.

The next desktop report showed that selecting Rust worker 2 and pressing ⇥
returned the inspection focus to worker 1. The direct DAP trace has the
matching sequence: for worker 2, LLDB-DAP emits `stopped(step, worker 2)` and
then `stopped(step, previous worker 1, allThreadsStopped=true)`. In the direct
probe, worker 1's file counter and instruction address did not move during
worker 2's step. The backend now ignores secondary step/breakpoint stop reports
only when that thread is in the confirmed LLDB hold set; exception reports and
new threads remain visible. It also keeps internal `CRAIDD_HOLDS` and
`CRAIDD_RELEASE` receipts out of the user Output panel. The user's live
counter result after this fix was still needed at this point in the record.

## Desktop acceptance report, 9 October 2026

After the held-thread stop filtering fix, the user reported that switching
between Rust workers and stepping the selected worker with ⇥ works in Craidd.
The user then reported that C++ thread selection, Step Over, and ⇥ all work,
followed by a successful first C debugging/build test with the same thread
control. This is user-reported desktop acceptance of the lab flow for Rust,
C++, and C on `feat/mt-debugging-rustc`. Exact desktop counter values and a
replay trace were not separately archived with those reports.

The earlier failures above are the chronological record before these fixes.
The broader gate cases in the design, including new-thread races and unusual
waits, remain unqualified. Stock netcoredbg does not provide the C# exclusive
step route used by this experiment. Nothing here claims release readiness or
acceptance on `master`.
