# Design: Per-thread execution control

**Roadmap track:** Phase 3.x debugger investigation, after the ordinary thread
selector baseline. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Bounded native and managed experiments, updated 13 October 2026.
The implementation joins the installed-LLDB native route from
`feat/mt-debugging-rustc` with the patched-netcoredbg C# route from
`dep/mt-debugging-thread-control`. Direct two-worker probes passed for Rust,
C++, C and patched C#. Focused Rust native-child desktop checks are recorded
in the [MT checklist](tests/checklist.md). The source checkout now carries an
opt-in patched Linux x64 netcoredbg build under `experiments/`; it is not the
default debugger or part of the app bundle. A fresh Craidd desktop managed C#
A/B counter check and broader lifecycle cases remain open. No general
exclusive-Step release claim is assigned.

**Companions:** [MT implementation contract](design-multi-thread-debugging-implementation.md),
[thread debugging and LDI](../ldi-debugging/design-thread-debugging-and-ldi.md),
the [MT lab](../../../workspaces/mt-lab/README.md), and the proposed
[project-scoped toolchain manager](../configurations/design-project-scoped-toolchain-manager.md).
The archived
[conditional-breakpoint proposal](archives/design-thread-isolation.md) and
[future-directions sketch](archives/design-thread-debugging-future-directions.md)
record the earlier exploration; this plan replaces their execution-control
direction.
The [future language and instruction investigations](future/README.md) extend
these evidence gates without changing the current Rust/C/C++/C# experiment.

## Decision after the C# feasibility prototype

### Product choice, 8 October 2026

Craidd keeps ordinary thread inspection and a focused Step target for C#,
Rust, and C++. The tested stock netcoredbg and LLDB-DAP sessions resumed other
workers on Step. **Exclusive Step is not a generally supported Craidd
capability**, and the patched netcoredbg experiment is not a default debugger.

The 9 October combined branch retains both bounded experiments as optional
controls. The ordinary installed C# debugger still uses ordinary Step;
native Rust/C/C++ uses an installed LLDB-DAP build with scripting enabled.
Neither route changes the default toolchain or puts a debugger in the app
bundle. The 13 October distribution update below adds one pinned experiment
build to the source checkout.

The combined branch also has a generic DAP `singleThread` request path. It is
gated by the selected adapter's advertised capability, an independently qualified
adapter build and platform, and a verified all-thread stop before requesting
the step. A request acknowledgment or an unchanged stack is not proof that
other workers stayed stopped; qualification needs observable worker side
effects, thread switching, lock waits, release, and failure recovery. The
qualification fixture runs separately and by explicit user choice, never by
stepping a user's live program at session startup. An unknown or failed
adapter keeps the ordinary Step behavior and an honest scope label.
No adapter has yet qualified this generic DAP path for a product claim.
[DAP single-thread capability](https://microsoft.github.io/debug-adapter-protocol/changelog).

There is no Samsung-specific toolbar path and no in-app prompt to download or
build a patched debugger. An advanced user may select the pinned experiment
build or another debugger binary, but that does not make its exclusive
stepping a generally supported configuration. CI may test stock and
experimental builds for conformance; upstream patch acceptance is not a
release gate. This leaves room for a future capable, installed adapter
without promising that today's stock C# debugger can isolate threads.

### Source-checkout distribution update, 13 October 2026

At the user's direction, the source repository now tracks a patched Linux x64
netcoredbg build based on Samsung release 3.2.0-1092, with its provenance and
license notices in the [C# experiment](../../../experiments/netcoredbg-thread-control/debugger/linux-x64/BUILD.md).
This supersedes the 8 October decision not to publish any patched binary.
Selecting the experiment build remains explicit in Toolchain preferences;
ordinary C# debugging and C# LDI keep the installed debugger by default.
The tracked build passed the direct worker-switch, blocked-Pause and
active-lease Stop probes. It still needs a Craidd desktop A/B counter result
and broader recovery qualification before a general support claim.

Users can already choose a debugger executable in **File → User Preferences →
Toolchain**. The separate project-scoped toolchain-manager proposal may later
make user-chosen tools easier to select or acquire per project. It does not
change this execution gate or turn an optional patched debugger into a default
dependency.

### Optional C# path from `dep/mt-debugging-thread-control`

The combined experiment carries the earlier Craidd thread selector, an
experimental ⇥ Step Over control, the C# lab solution, a patch against a
pinned Samsung netcoredbg revision, and the tracked Linux x64 experiment
build. Other architectures and local rebuilds remain user-built. Stock
adapters keep ordinary Step; ⇥ appears only when
the active adapter advertises standard DAP
`supportsSingleThreadExecutionRequests` or the experimental managed request.
The standard path sends `next` with `singleThread: true`; the patched C# path
sends `craiddExclusiveNext`. Neither path is a general promise to isolate
threads: capability claims still need independent behavior and recovery tests
on the selected build and platform. The combined desktop C# counter check is
still pending; a general support claim requires the broader gates below.

The local prototype showed that a modified netcoredbg can hold other managed
threads for a source-level Step. It also failed to step a selected worker whose
current frame had no source line. The desktop screenshots established selection
and stepping on both workers, but did not capture before/after counters for
each step. These are feasibility results, not product acceptance.

Craidd will **not** require users to select the experimental C# debugger,
replace their system debugger, or silently attach a second controller. The
user may opt into the tracked build or a local rebuild through Toolchain
preferences. Otherwise Craidd keeps ordinary thread inspection and Step,
without promising isolation.

For native Rust, C++ and C, the earlier lead was the installed LLDB owner's
`thread step-over --run-mode this-thread` behavior. The installed `lldb-dap`
does not advertise DAP single-thread execution, so that direct LLDB result
alone could not justify a Craidd toolbar control. The later same-session
suspension and release probe below provided the bounded implementation route.
[LLDB-DAP capabilities](https://lldb.llvm.org/use/lldbdap.html#supported-features).

An initial direct check with the installed LLDB 23.1.1 and the C++ MT Console
stopped both workers at `main.cpp:37`. `thread step-over -m this-thread` moved
worker 1 to line 38 while worker 2 stayed at line 37; selecting worker 2 and
repeating the command moved it to line 38 while worker 1 stayed at line 38.
This is source-position evidence in the stock LLDB CLI, not a worker-side-effect
counter result or a Craidd/LLDB-DAP integration result.

For ordinary managed C#, a Linux OS-thread stop is not a managed source Step.
The CLR debugger owner must coordinate managed thread state, queued callbacks,
and release; a separate Linux `ptrace` controller is not an approved fallback.
Craidd can enable exclusive stepping later only when an installed, maintained
debugger reports and demonstrates the required capability. Until then, retain
ordinary thread inspection and Step with its observed process-wide behavior.
[Linux `ptrace`](https://man7.org/linux/man-pages/man2/ptrace.2.html),
[CLR thread-state risks](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugthread-setdebugstate-method).

## The user problem and the boundary

Selecting a thread already chooses its stack, locals, and Step target. In the
tested netcoredbg 3.2.0-1 and LLDB-DAP 23.1.1 sessions, Step resumed other
threads too. Another worker could run, change shared state, or hit a breakpoint
first. The selector must keep reporting that observed behavior.

A thread ID identifies a thread within one debugger session. It does not grant
the IDE control over the process scheduler. A conditional breakpoint can
filter a future stop; it cannot hold other threads while one runs. Standard
DAP source breakpoints have no portable thread filter, and a DAP condition is
an adapter-evaluated expression, not a common `thread.id` language. Therefore
this plan does not add invisible breakpoints or rewrite user red conditions.
[DAP specification](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md).

**Goal:** At a debugger stop, let the user make one source-level step on a
selected thread while other threads under that debugger's control remain
stopped. The debugger owner must do the holding and stepping. Craidd supplies
the request, displays the reported result, and provides a way to release holds.

The first deliverable is **exclusive Step**, not an indefinite "run this
thread" mode. An indefinite selected-thread Continue needs separate evidence
for lock waits, thread creation, exceptions, and cancellation.

## User-visible behavior

| Control | Meaning | Availability |
| --- | --- | --- |
| Inspect thread | Show a stopped thread's frames and locals; execution does not change | Existing selector |
| Step focused thread | Target Step at the selected thread; others may resume | Existing request; report observed resume scope |
| Step this thread only | Hold the other controlled threads for one Step | Proposed; show only after a real adapter proof |
| Release all threads | Clear any debugger-owned holds and continue under normal session rules | Required alongside exclusive Step |

Inspection focus and execution policy are separate state. Selecting a row must
never silently suspend it or another thread. If the session is running, first
Pause and establish which threads are stopped before offering exclusive Step.
When a step ends in an all-thread stop, the user can select a different stopped
thread and step it next; no hidden breakpoint or rewind is involved. If the
selected thread exits, loses its source frame, or becomes uninspectable, the
control becomes unavailable with an explanation.

The UI must identify the **requested thread**, the **thread that actually
stopped**, and whether the adapter resumed one thread or the session. A
successful request alone is not evidence of exclusive execution. Keep the
existing breakpoint, exception, and LDI stop reasons visible even if they
interrupt a step.

## Control contract and ownership

One debugger owner controls each process. Craidd must not attach a second
controller to suspend threads behind netcoredbg or LLDB-DAP. The owner maps a
session-qualified DAP thread ID to its own live thread object; an OS TID, a
.NET managed ID, and a DAP ID are not interchangeable. Qualify every request
by session generation and thread incarnation so a restarted session or reused
numeric ID cannot inherit an old hold.

The provider must expose, or correctly implement through DAP, these actions:

1. Report whether exclusive Step is supported **in this running session**.
2. From a verified stop, prepare holds on all other threads within its stated
   scope, then step the selected thread. Report the resulting stop/resume scope.
3. Release every hold on explicit release, control failure, Stop, disconnect,
   session restart, owner change, or the selected thread's exit. If the owner
   is lost or release cannot be confirmed, report the state as unverified
   rather than claiming normal execution.

For standard DAP, `supportsSingleThreadExecutionRequests` permits a client to
send `singleThread: true`; Craidd must verify reported continuation scope where
the adapter provides it, and confirm behavior with independent workers. A Step
response alone does not report which threads ran. A custom adapter extension
that requires Craidd to distribute or maintain a debugger is outside this
plan. Do not infer support from the language name. [DAP execution requests](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md).

Holds are **one-step leases** in the first version: the provider clears them
when the step reaches its next stop. A new step prepares a new lease. This
limits stale holds, but it does not make a blocked step safe. If progress
stalls, first attempt Pause, then release the lease from a verified stop. If
Pause fails, attempt Stop and report whether process cleanup was confirmed.
The feature does not pass acceptance without a demonstrated recovery path for
the tested provider. A visible release action and owner-side cleanup remain
mandatory.

## C# status: optional custom build; stock debugger remains ordinary

Craidd's tested installed netcoredbg does not advertise single-thread execution;
its DAP Step resumed all workers. The experiment exposes ⇥ only for
an adapter that advertises standard DAP single-thread execution or the custom
`craiddManagedExclusiveNext` request. The latter requires an experimental
patched netcoredbg from the [C# experiment](../../../experiments/netcoredbg-thread-control/README.md).
The source checkout includes a pinned Linux x64 build, but its use remains an
opt-in experiment rather than a stock C# capability.

The CLR debugging API explains what the patch uses; it is **not** a validated
stock-netcoredbg feature.
`ICorDebugController::SetAllThreadsDebugState(THREAD_SUSPEND, selectedThread)`
can suspend managed threads other than the selected one, while
`ICorDebugThread::SetDebugState` can set an individual thread to `THREAD_RUN`.
The same controller must restore `THREAD_RUN` for all affected managed threads;
the bulk API can affect threads absent from enumeration. The debugger must
drain queued callbacks before state changes. These operations belong inside
the debugger owner, not in Craidd's UI process.
[CLR bulk thread state](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugcontroller-setallthreadsdebugstate-method),
[CLR thread state and risks](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugthread-setdebugstate-method).

Before claiming general C# support, the proof must
establish the DAP-to-CLR identity mapping, the precise managed-thread hold
scope, stepping and callback order, and reliable release.
It must test the currently selected thread, a different worker selected at the
next stop, new and exiting workers, normal Continue, exception stops, Stop,
disconnect, and adapter failure. Add a lock-wait and GC-pressure case: a held
thread can own a lock or block GC at an unsafe point. A C# thread that enters
native code through LDI also needs its existing origin-hold and release rules
preserved; managed suspension is not proof of native-thread control.

**C# gate:** In a two-worker run, Step worker A while B's observed counter
does not advance; switch at the next stop and Step B while A remains unchanged;
then Release all and observe both advance. Repeat through the desktop UI after
the direct adapter proof. If the debugger owner cannot complete and clean up
this sequence reliably, retain Step focused thread and mark exclusive Step
unsupported for that provider.

## Native track: Rust, C++ and C

Rust, C++ and C use LLDB-DAP for native debugging on this branch. LLDB's
underlying `SBThread` API exposes suspension and stepping modes that can hold
other threads, but published LLDB-DAP capabilities list
`supportsSingleThreadExecutionRequests` as unsupported. The combined branch
uses the tested LLDB-DAP session's built-in scripting path, gated separately
from the standard DAP capability and the optional managed adapter path.
[LLDB thread API](https://lldb.llvm.org/python_api/lldb.SBThread.html),
[LLDB-DAP capability table](https://lldb.llvm.org/use/lldbdap.html#supported-features).

The direct stock-LLDB source-position check above was the first native lead.
The next probe used the installed LLDB-DAP's `evaluate` REPL in the **same
debugger session**. It found that `thread step-over -m this-thread` alone did
not isolate execution: an unselected Rust worker moved from the source line
into a sleep syscall, although its output file did not change. Explicit
`SBThread.Suspend()` calls on the other currently known threads, followed by
one selected-thread Step and `SBThread.Resume()` for the recorded holds, kept
the unselected worker's instruction pointer and counter fixed. Direct
two-worker probes passed for Rust, C++, and C with LLDB-DAP 23.1.1. The
blocked C++ probe showed a mutex wait could be interrupted by Pause, although
LLDB reported that stop as `exception` and completed the interrupted step at
a later stop after release and Continue. See the isolated
[experiment and result record](../../../experiments/lldb-native-thread-control/RESULTS.md).

This is a single-owner LLDB control path through its built-in scripting API;
it does not require another debugger binary, adapter fork, or second attach.
It is still **experimental**. Published LLDB-DAP capabilities do not advertise
DAP single-thread execution, so Craidd cannot infer this route from the DAP
capability bit. The branch gates its UI to the tested LLDB-DAP version, Linux,
ordinary Rust/CMake sessions, a current all-thread stop, and a selected source
frame. It blocks concurrent control while holds are pending, releases the
recorded holds after the next qualified stop, and leaves Stop available if
release cannot be verified. A scripting-disabled build, new threads born after
the hold snapshot, non-source frames, and unusual stop ordering need further
qualification. The direct probe is not proof that the Craidd desktop flow
works; the user has since reported a working desktop lab flow for Rust, C++,
and C. Neither this experiment nor a version string is a stable general
support contract.

**Rust gate:** Use the Rust console and GUI workers to verify a one-thread
source Step, switch, release, thread exit, async-task caveat, and cleanup.
Native Rust-to-C++ inspection stays in its original LLDB session; it does not
acquire the managed LDI reproduction lifecycle.

**C++/C gate:** Reuse the native owner contract, then validate it on the C++
console and GUI workers and C pthread workers, including lock contention,
exceptions, thread creation, and a worker blocked in a native call. The direct
C fixture currently uses Craidd's CMake/C++ project route; a separate C project
model is outside this branch. Sharing LLDB does not make the desktop C++ or C
acceptance result automatic. The user has now reported working C++ and C
desktop thread control in the lab; the remaining gate cases above still need
their own evidence.

## Future arrivals

A new language or adapter, including a future Python, Go, or TypeScript
debugger, enters through the same provider contract. Before
Craidd displays Step this thread only, record its debugger owner, thread-ID
mapping, supported execution capability, hold scope, stop/continue semantics,
release path, and a real two-worker result. If any item is unknown, retain
inspection and Step focused thread without promising exclusive execution.

An async task, web request, or logical job may move between threads. Thread
control does not follow that operation; request/task correlation belongs to a
separate trace design. The current product is Linux-focused. A future OS port
must qualify its own debugger and process-control behavior against this shared
contract before claiming parity.

## Evidence and delivery order

1. Preserve the existing selector behavior and record baseline two-worker
   results for installed netcoredbg and LLDB-DAP, including `stopped` and
   `continued` scope. This is adapter evidence, not desktop acceptance.
2. Investigate stock LLDB's single-owner control path for Rust, C++, and C.
   Direct worker-side-effect and one blocked-step release checks have passed
   on the tested LLDB build; continue failure and lifecycle qualification.
3. The isolated native branch implemented the session-qualified one-step
   lease, release path and gated UI; the user reported a working desktop lab
   flow. Repeat Rust on the combined branch, then check the remaining native
   lifecycle cases.
4. The optional patched C# experiment implements a separate managed lease
   path. Repeat a two-worker desktop counter check on the combined branch,
   then check the remaining C# recovery and lifecycle cases. Stock netcoredbg
   remains on ordinary Step unless it gains a proven supported route.

The acceptance record must state the adapter version, platform, exact selected
thread, stop/resume events, worker side effects, blocked-step recovery, and
cleanup outcome. Build success or a direct adapter probe is a checkpoint; the
feature is accepted only after the corresponding Craidd desktop interaction
works. Do not update the roadmap to "shipped" before those gates are recorded.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
