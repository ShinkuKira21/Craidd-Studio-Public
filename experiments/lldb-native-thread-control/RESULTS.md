# Direct adapter results — 9 October 2026

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
The desktop sequence in `README.md` remains to be accepted by a human user;
do not label this shipped or merge it into `master` on the direct results.
