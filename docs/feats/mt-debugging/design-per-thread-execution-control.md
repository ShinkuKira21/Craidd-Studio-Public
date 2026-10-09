# Design: Per-thread execution control

**Roadmap track:** Phase 3.x debugger investigation, after the ordinary thread
selector baseline. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Retained design investigation, 9 October 2026. No per-thread hold or
exclusive step is implemented or accepted on `master`. A local C# feasibility
prototype on `feat/mt-debugging-thread-control` is not a product dependency.
The isolated `feat/mt-debugging-rustc` branch now contains an installed-LLDB
native control experiment with direct Rust, C++, and C results. The user has
reported that its Craidd desktop thread control works for all three languages
in the lab. Broader lifecycle and wait cases remain unqualified. Ordinary
managed C# remains dependent on a capable installed debugger. No release
phase is assigned.

**Companions:** [MT implementation contract](design-multi-thread-debugging-implementation.md),
[thread debugging and LDI](../ldi-debugging/design-thread-debugging-and-ldi.md),
the [MT lab](../../../workspaces/mt-lab/README.md), and the proposed
[project-scoped toolchain manager](../configurations/design-project-scoped-toolchain-manager.md).
The archived
[conditional-breakpoint proposal](archives/design-thread-isolation.md) and
[future-directions sketch](archives/design-thread-debugging-future-directions.md)
record the earlier exploration; this plan replaces their execution-control
direction.

## Decision after the C# feasibility prototype

### Product choice, 8 October 2026

Craidd keeps ordinary thread inspection and a focused Step target for C#,
Rust, and C++. The tested stock netcoredbg and LLDB-DAP sessions resumed other
workers on Step. **Exclusive Step is not a shipped Craidd capability**, and
the patched netcoredbg experiment is not a supported debugger distribution.

Craidd may add a generic DAP `singleThread` request path. It must be gated by
the selected adapter's advertised capability, an independently qualified
adapter build and platform, and a verified all-thread stop before requesting
the step. A request acknowledgment or an unchanged stack is not proof that
other workers stayed stopped; qualification needs observable worker side
effects, thread switching, lock waits, release, and failure recovery. The
qualification fixture runs separately and by explicit user choice, never by
stepping a user's live program at session startup. An unknown or failed
adapter keeps the ordinary Step behavior and an honest scope label.
[DAP single-thread capability](https://microsoft.github.io/debug-adapter-protocol/changelog).

There is no Samsung-specific toolbar path and no in-app prompt to download or
build a patched debugger. An advanced user may select their own debugger
binary, but that does not make its exclusive stepping a Craidd-supported
configuration. CI may test stock and experimental builds for conformance;
Craidd will not publish a patched netcoredbg binary or make its upstream
acceptance a release gate. This leaves room for a future capable, installed
adapter without promising that today's C# users can isolate threads.

The separate toolchain-manager proposal may later make user-chosen tools
easier to select or acquire per project. It does not change this execution
gate or turn an optional patched debugger into a default dependency.

The local prototype showed that a modified netcoredbg can hold other managed
threads for a source-level Step. It also failed to step a selected worker whose
current frame had no source line. The desktop screenshots established selection
and stepping on both workers, but did not capture before/after counters for
each step. These are feasibility results, not product acceptance.

Craidd will **not** require users to build or download a Craidd-maintained or
vendor-specific debugger for this feature, replace their system debugger, or
silently attach a second controller. The experimental adapter and ⇥ control
remain on the preserved feature branch; they are absent from `master`. Thread
isolation is available only where a debugger the user has already chosen and
installed exposes a verified control path. Otherwise Craidd keeps ordinary
thread inspection and Step, without promising isolation.

For native Rust and C++, investigate the installed LLDB owner's
`thread step-over --run-mode this-thread` behavior directly. The installed
`lldb-dap` does not advertise DAP single-thread execution, so a direct LLDB
result alone cannot justify a Craidd toolbar control. Any transport must keep
one debugger owner and prove its stop, release, and failure semantics before
the UI offers isolation. [LLDB-DAP capabilities](https://lldb.llvm.org/use/lldbdap.html#supported-features).

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

## C# status: deferred on stock debugger capability

Craidd's installed netcoredbg does not advertise single-thread execution; its
current DAP Step resumes all workers. The modified-netcoredbg experiment is
closed as a product route. Do not add a C# desktop control unless a debugger
the user has already chosen and installed demonstrates the required behavior
and release semantics through its supported interface.

The CLR debugging API explains what the experiment investigated; it is **not**
an active Craidd implementation route or a validated stock-netcoredbg feature.
`ICorDebugController::SetAllThreadsDebugState(THREAD_SUSPEND, selectedThread)`
can suspend managed threads other than the selected one, while
`ICorDebugThread::SetDebugState` can set an individual thread to `THREAD_RUN`.
The same controller must restore `THREAD_RUN` for all affected managed threads;
the bulk API can affect threads absent from enumeration. The debugger must
drain queued callbacks before state changes. These operations belong inside
the debugger owner, not in Craidd's UI process.
[CLR bulk thread state](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugcontroller-setallthreadsdebugstate-method),
[CLR thread state and risks](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugthread-setdebugstate-method).

If an installed debugger later exposes this capability, the C# proof must
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

## Native track: Rust, then C++

Rust and C++ currently use LLDB-DAP for ordinary native debugging. LLDB's
underlying `SBThread` API exposes suspension and stepping modes that can hold
other threads, but published LLDB-DAP capabilities list
`supportsSingleThreadExecutionRequests` as unsupported. The engine API is a
feasibility lead, not a claim that Craidd's current DAP transport can use it.
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
3. Implement the session-qualified request, one-step lease, release path, and
   UI only for an installed debugger with a verified supported interface.
   Prove the native behavior in Craidd's real desktop flow before enabling it.
4. Revisit managed C# only if an installed debugger gains a supported
   single-thread capability. Apply the C# gate above before enabling it.

The acceptance record must state the adapter version, platform, exact selected
thread, stop/resume events, worker side effects, blocked-step recovery, and
cleanup outcome. Build success or a direct adapter probe is a checkpoint; the
feature is accepted only after the corresponding Craidd desktop interaction
works. Do not update the roadmap to "shipped" before those gates are recorded.

---

*Last updated: Phase 3.x, 9 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
